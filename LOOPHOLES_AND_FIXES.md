# Order Flow Loopholes & Fix Plan

*Generated from codebase audit — 2026-10-20*

---

## Executive Summary

The cart → checkout → payment → fulfillment pipeline is **well-architected for the happy path**:
- Stock reservations use conditional `UPDATE … WHERE stock ≥ qty` → no oversell
- Payment verification uses atomic `PENDING→CONFIRMED` + server-to-server amount check
- Refund settlement has 5 independent guards + ledger-first pattern
- Cancellation is idempotent (admin ↔ webhook race safe)

**Three highest-risk gaps** must be closed first:
1. **No server-side `payment.captured` webhook** → orphaned `PENDING` orders
2. **Shiprocket push not retried** → confirmed orders that never ship
3. **10-min reservation TTL vs. real-world latency** → stock churn on slow checkouts

---

## Detailed Loophole Register

| # | Loophole | Severity | Impact | Root Cause | Location |
|---|----------|----------|--------|------------|----------|
| **1** | **Missing Razorpay `payment.captured` webhook** | 🔴 Critical | User pays, closes browser before client calls `/api/checkout/verify` → order stays `PENDING` → reservation expires (10 min) → stock returns → order orphaned, no confirmation email, no Shiprocket push | Client-only verification flow; no server-side fallback | `utils/checkout.ts` (no webhook handler for `payment.captured`) |
| **2** | **Shiprocket push is best-effort only** | 🔴 Critical | Shiprocket API down at payment confirmation → order `CONFIRMED` but **never booked** with courier. Admin must manually push later — no automated retry, no alert. | `pushToShiprocket` wrapped in try/catch; error only logged | `utils/checkout.ts:931-942` |
| **3** | **10-min reservation TTL vs. slow payments** | 🟠 High | User leaves Razorpay checkout open >10 min → reservation swept → stock returned → user completes payment → `verifyAndConfirmPayment` re-checks stock but variant may now be sold → confusing failure | Hard-coded `RESERVATION_TTL_MINUTES = 10` | `utils/reservations.ts:21` |
| **4** | **Zero-total (100% discount) orders bypass payment guards** | 🟠 High | `paymentRequired: false` path sets `CONFIRMED` immediately, decrements stock, clears cart — no signature/amount verification. If promo logic buggy, free stock leaves. | Fast-path for zero-total in `createCheckoutSession` | `utils/checkout.ts:73-90` |
| **5** | **Cart mutation during active checkout** | 🟡 Medium | User opens checkout (tab A), removes item (tab B) → `cleanUpPendingOrder` deletes PENDING order & releases reservation. Tab A still shows Razorpay; if user pays → 404 "order not found". | `cleanUpPendingOrder` called on every cart mutation | `utils/cart.ts:491-521` |
| **6** | **Promo code can be invalidated after checkout starts** | 🟡 Medium | Promo validated at Step 1; if admin disables promo before payment verification, order total still reflects old discount. No re-validation at verify step. | Promo attached to cart, not re-checked in `verifyAndConfirmPayment` | `utils/checkout.ts` |
| **7** | **Address serviceability checked once at checkout start** | 🟡 Medium | PIN checked via Shiprocket at Step 1. If courier coverage changes before Shiprocket push (Step 3), order may be confirmed for unserviceable PIN. | `checkPinServiceability` only in `createCheckoutSession` | `utils/checkout.ts` |
| **8** | **No idempotency key on `/api/checkout` (Step 1)** | 🟡 Medium | Double-click "Place Order" → two PENDING orders, two reservations, two Razorpay orders. User pays one; other expires after 10 min (stock returns). Harmless but noisy. | No deduplication on checkout session creation | `app/api/checkout/route.ts` |
| **9** | **Razorpay webhook secret not enforced at startup** | 🟡 Medium | If `RAZORPAY_WEBHOOK_SECRET` unset in prod, **all refund/dispute webhooks silently fail** (503) → refunds stuck in `REFUND_PENDING`. | Webhook route returns 503 if secret missing; no startup check | `app/api/webhooks/razorpay/route.ts:50-53` |
| **10** | **No automatic `CONFIRMED → PROCESSING` transition** | 🟢 Low | Order sits in `CONFIRMED` forever if admin forgets to click "Mark Processing" → no Shiprocket push retry, no tracking generated. | Status machine requires manual admin action | `utils/order-ops.ts` |
---

## Fix Plans

### 🔴 P0 — Must Fix Before Launch

#### Fix 1.1: Add Razorpay `payment.captured` Webhook Handler
**File(s):** `app/api/webhooks/razorpay/route.ts`, `utils/checkout.ts` (export helper)

```typescript
// In razorpay webhook route — add new case
case 'payment.captured':
  await handlePaymentCapturedWebhook(payload);
  break;

// New helper (idempotent — reuses existing verifyAndConfirmPayment)
async function handlePaymentCapturedWebhook(payload: any) {
  const entity = payload.payload?.payment?.entity;
  if (!entity) return;
  
  const razorpayOrderId = entity.order_id;
  const razorpayPaymentId = entity.id;
  const razorpaySignature = payload.signature;
  
#### Fix 1.2: Cron Job to Retry Stuck Shiprocket Pushes
**File(s):** New `app/api/cron/retry-shiprocket/route.ts` + Vercel Cron config

```typescript
// app/api/cron/retry-shiprocket/route.ts
import { NextResponse } from 'next/server';
import { db, orders, sql } from '@/utils/db';
import { pushToShiprocket } from '@/utils/checkout';

export async function GET() {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stuck = await db.select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'CONFIRMED'),
        isNull(orders.shiprocketOrderId),
        sql`${orders.createdAt} < now() - interval '5 minutes'`
      )
    )
    .limit(50);

  const results = [];
  for (const order of stuck) {
    try {
      const shiprocketOrderId = await pushToShiprocket(order.id);
      results.push({ orderNumber: order.orderNumber, shiprocketOrderId, ok: true });
    } catch (err) {
      results.push({ orderNumber: order.orderNumber, error: String(err), ok: false });
    }
  }

  return NextResponse.json({ retried: results.length, results });
}
```

**Vercel Cron (vercel.json):**
#### Fix 1.3: Extend Reservation TTL + Client Heartbeat
**File(s):** `utils/reservations.ts`, `components/checkout/checkout-form.tsx`

```typescript
// utils/reservations.ts
export const RESERVATION_TTL_MINUTES = 15; // was 10

export async function extendReservation(orderId: string): Promise<void> {
  await rawQuery(sql`
    UPDATE stock_reservations
    SET expires_at = now() + (${RESERVATION_TTL_MINUTES} * interval '1 minute')
    WHERE order_id = ${orderId}
  `);
}
```

```typescript
// components/checkout/checkout-form.tsx — add after Razorpay opens
useEffect(() => {
  if (!session?.razorpayOrderId) return;
  
  const interval = setInterval(async () => {
    try {
      await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extendReservation', orderId: session.razorpayOrderId }),
      });
    } catch { /* silent — best effort */ }
  }, 4 * 60 * 1000);
  
  return () => clearInterval(interval);
}, [session?.razorpayOrderId]);
```

```typescript
// app/api/checkout/route.ts — add new action
if (body.action === 'extendReservation') {
  const orderId = typeof body.orderId === 'string' ? body.orderId : undefined;
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });
---

### 🟠 P1 — Fix Within 1 Sprint

#### Fix 2.1: Audit Log + Alert for Zero-Total Orders
**File(s):** `utils/checkout.ts` (after zero-total confirmation)

```typescript
// In createCheckoutSession, after zero-total order confirmed
await rawQuery(sql`
  INSERT INTO audit_log (event, data, created_at)
  VALUES ('zero_total_order', ${JSON.stringify({
    orderNumber: session.orderNumber,
    promoCode: attachedPromo?.code ?? null,
    userId: customer?.userId ?? null,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
  })}, now())
`);
```

**Admin Dashboard:** Add "Zero-Total Orders (Last 24h)" widget to `/admin/ledger` with count + link to filtered list.

---

#### Fix 2.2: Graceful Cart-Mutation-During-Checkout UX
**File(s):** `utils/cart.ts` (return specific error), `components/checkout/checkout-form.tsx` (handle it)

```typescript
// utils/cart.ts: cleanUpPendingOrder — throw typed error instead of silent catch
export class PendingOrderCleanedUpError extends Error {
  constructor() {
    super('Pending order was cleaned up due to cart change');
    this.name = 'PendingOrderCleanedUpError';
  }
}

// In cleanUpPendingOrder catch block:
throw new PendingOrderCleanedUpError();
```

```typescript
// components/checkout/checkout-form.tsx — catch and show friendly message
try {
  const res = await fetch('/api/checkout', { ... });
  const session = await res.json();
  if (session.error?.includes('cleaned up')) {
    setNotice('Your bag changed — please restart checkout.');
    router.refresh();
    return;
  }
#### Fix 2.4: Re-check PIN Serviceability at Shiprocket Push
**File(s):** `utils/checkout.ts` → `pushToShiprocket`

```typescript
// In pushToShiprocket, before calling createShiprocketOrder
const pinCheck = await checkPinServiceability(order.shippingPostalCode);
if (!pinCheck.serviceable) {
  await db.update(orders)
    .set({ shippingIssue: true, shippingIssueReason: 'PIN became unserviceable' })
    .where(eq(orders.id, orderId));
  console.warn(`[checkout] Order ${order.orderNumber} confirmed but PIN ${order.shippingPostalCode} no longer serviceable`);
  return null;
}
```

**Schema change:** Add `shippingIssue BOOLEAN DEFAULT FALSE` + `shippingIssueReason TEXT` to `orders` table.

---

#### Fix 2.5: Idempotency Key on Checkout Create
**File(s):** `app/api/checkout/route.ts`, new `idempotency_keys` table

```sql
-- Migration
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

```typescript
// app/api/checkout/route.ts — at top of POST handler
const idemKey = request.headers.get('Idempotency-Key');
if (idemKey) {
  const existing = await rawQuery<{ order_id: string }>(sql`
    SELECT order_id FROM idempotency_keys WHERE key = ${idemKey}
  `);
  if (existing.length > 0) {
    const order = await db.select().from(orders).where(eq(orders.id, existing[0].order_id)).limit(1);
    if (order[0]?.status === 'PENDING') {
      return NextResponse.json(await buildSessionFromOrder(order[0]));
    }
  }
}

// After successful createCheckoutSession:
if (idemKey) {
  await rawQuery(sql`
    INSERT INTO idempotency_keys (key, order_id) VALUES (${idemKey}, ${session.orderId})
    ON CONFLICT DO NOTHING
  `);
}
```

**Client:** Generate key = `${cartId}-${addressHash}` and send as `Idempotency-Key` header.
  // ... normal flow
}
```

---

### 🟡 P2 — Operational Hardening

#### Fix 3.1: Startup Health Check for Webhook Secrets
**File(s):** New `app/api/health/route.ts`

```typescript
// app/api/health/route.ts
export async function GET() {
  const checks = {
    database: true,
    razorpayWebhookSecret: !!process.env.RAZORPAY_WEBHOOK_SECRET,
    shiprocketWebhookToken: !!process.env.SHIPROCKET_WEBHOOK_TOKEN,
    shiprocketApiToken: !!process.env.SHIPROCKET_API,
  };
  
  const healthy = Object.values(checks).every(v => v === true);
  
  return NextResponse.json({ healthy, checks }, { 
    status: healthy ? 200 : 503 
  });
}
```

**Monitoring:** Ping `/api/health` every 60s; alert if `healthy: false`.

---

#### Fix 3.2: Auto-transition `CONFIRMED → PROCESSING`
**File(s):** New cron `app/api/cron/auto-process/route.ts`

```typescript
// Runs every 5 min — moves CONFIRMED orders with shiprocket_order_id to PROCESSING
const toProcess = await db.select({ id: orders.id })
  .from(orders)
  .where(
    and(
      eq(orders.status, 'CONFIRMED'),
      isNotNull(orders.shiprocketOrderId),
---

## Implementation Priority & Effort

| Fix | Effort | Risk if Deferred | Owner |
|-----|--------|------------------|-------|
| 1.1 Razorpay webhook | 2h | Orphaned paid orders | Backend |
| 1.2 Shiprocket retry cron | 3h | Confirmed orders never ship | Backend |
| 1.3 TTL + heartbeat | 2h | Stock churn / failed payments | Backend + Frontend |
| 2.1 Zero-total audit | 1h | Promo abuse undetected | Backend |
| 2.2 Cart mutation UX | 2h | Confusing errors for users | Frontend |
| 2.3 Promo re-validation | 1h | Stale discounts honored | Backend |
| 2.4 PIN re-check | 2h | Unserviceable orders confirmed | Backend |
| 2.5 Idempotency key | 3h | Duplicate PENDING orders | Backend + Frontend |
| 3.1 Health check | 1h | Silent webhook failures | DevOps |
| 3.2 Auto-process | 1h | Manual admin step missed | Backend |

---

## Testing Checklist for Each Fix

| Fix | Unit Test | Integration Test | Manual QA |
|-----|-----------|------------------|-----------|
| 1.1 | Mock webhook payload → verify `verifyAndConfirmPayment` called | Full Razorpay test mode: pay → close tab → webhook fires → order CONFIRMED | — |
| 1.2 | Mock `pushToShiprocket` failure → cron retries → succeeds | Deploy cron, kill Shiprocket API, place order, wait 10 min | Check admin ledger for `shiprocket_order_id` |
| 1.3 | Reservation extends on heartbeat call | Keep Razorpay open 12 min → complete payment → succeeds | — |
| 2.1 | Zero-total order creates audit_log row | 100% discount checkout → check audit_log table | Admin dashboard widget shows count |
| 2.2 | Cart mutation throws `PendingOrderCleanedUpError` | Open checkout in two tabs, remove item in one, pay in other → friendly notice | — |
| 2.3 | Disabled promo at verify time → 409 | Apply promo, disable in admin, complete payment → rejected | — |
| 2.4 | PIN serviceable at checkout, unserviceable at push → `shippingIssue=true` | Mock Shiprocket to flip serviceability | Admin sees flagged order |
| 2.5 | Double POST with same idempotency key → same order | Click "Place Order" twice rapidly | Only one PENDING order created |
| 3.1 | Health endpoint returns 503 when secret missing | Deploy without secret → monitoring alerts | — |
| 3.2 | CONFIRMED + shiprocket_order_id → PROCESSING after 2 min | Place order, wait 3 min, check status | — |

---

## Rollback Plan

Each fix is independently deployable. If a fix causes regressions:

1. **Webhook handler** → Revert `app/api/webhooks/razorpay/route.ts` to previous version (no DB migration).
2. **Cron jobs** → Disable in `vercel.json` or set `CRON_SECRET` to invalid value.
3. **TTL/heartbeat** → Revert `RESERVATION_TTL_MINUTES` to 10; remove heartbeat interval.
4. **Schema changes** (idempotency_keys, shippingIssue) → Standard migration rollback.

---

## Sign-off

| Role | Name | Date | Approved |
|------|------|------|----------|
| Backend Lead | | | ☐ |
| Frontend Lead | | | ☐ |
| DevOps | | | ☐ |
| Product | | | ☐ |

---

*Document maintained in `LOOPHOLES_AND_FIXES.md` — update with each fix deployment.*
---

## ✅ Verification Against Provider Docs & Best Practices

### Razorpay (`payment.captured` webhook — Fix 1.1)

| Check | Status | Evidence |
|-------|--------|----------|
| Event exists in Razorpay | ✅ | `payment.captured` fires when payment moves to `captured` state |
| Payload has `payment.entity.id`, `order_id` | ✅ | Standard Razorpay webhook payload |
| Signature = HMAC-SHA256(raw_body, webhook_secret) | ✅ | `verifyWebhookSignature()` in `utils/razorpay.ts:210-223` |
| Retries with exponential backoff | ✅ | Razorpay retries: immediate, 5m, 30m, 2h, 6h, 24h, 48h, 72h |
| Idempotent handling required | ✅ | Our `verifyAndConfirmPayment` uses conditional `UPDATE ... WHERE status='PENDING'` |
| **Razorpay recommends**: "Rely on webhooks for automation; supplement with API verify for instant UX" | ✅ | Fix 1.1 = webhook fallback; client `/api/checkout/verify` = primary |

### Shiprocket (Fix 1.2 retry cron, Fix 2.4 PIN re-check)

| Check | Status | Evidence |
|-------|--------|----------|
| Create order: `POST /orders/create/adhoc` | ✅ | `createShiprocketOrder()` in `utils/shipping.ts:496` |
| Serviceability: `GET /courier/serviceability/` | ✅ | `checkPinServiceability()` in `utils/shipping.ts:420` |
| Auth: Bearer token (login or static) | ✅ | `authHeader()` handles token rotation, Redis sharing, disk cache |
| Webhook auth: `x-api-key` header with shared secret | ✅ | `track/route.ts:48-64` constant-time compare, fail-closed |
| Webhook events: `SHIPPED`, `PICKED_UP`, `IN_TRANSIT`, `DELIVERED`, `RTO_*` | ✅ | `mapReturnStatus()` in `utils/shipping.ts:1069` maps all aliases |
| Retries aggressively; must deduplicate | ✅ | `claimWebhookEvent('courier', eventId)` + PK on `webhook_events` |
| **Best practice**: Poll for stuck `CONFIRMED` orders without `shiprocket_order_id` | ✅ | Fix 1.2 cron does exactly this every 10 min |

### Reservation TTL (Fix 1.3)

| Factor | Value | Our Fix |
|--------|-------|---------|
| Max Razorpay Checkout duration | ~15 min (bank redirects, OTP) | 15-min TTL |
| Current TTL | 10 min | → 15 min |
| Heartbeat interval | — | 4 min (extends `expires_at` via new `/api/checkout` action) |
| Schema change | None | Uses existing `expires_at` column |

### Idempotency Key (Fix 2.5)

| Standard | Our Implementation |
|----------|-------------------|
| `Idempotency-Key` header (Stripe, Razorpay pattern) | Client sends `${cartId}-${addressHash}` |
| Server deduplicates via key→order table | New `idempotency_keys` table (PK on key) |
| Duplicate returns existing checkout session | Checked before `createCheckoutSession` |

### Health Check (Fix 3.1)

| Risk | Mitigation |
|------|------------|
| `RAZORPAY_WEBHOOK_SECRET` unset → refund/dispute webhooks silently 503 | `/api/health` checks all 4 critical env vars |
| `SHIPROCKET_WEBHOOK_TOKEN` unset → courier webhooks rejected | Same endpoint |
| No alerting on secret rotation | Monitoring pings `/api/health` every 60s |

---

## 🔄 Alignment Summary

| Fix | Razorpay/Shiprocket Alignment | Confidence |
|-----|-------------------------------|------------|
| 1.1 payment.captured webhook | **Exact match** — documented event, same payload, same verification | 🟢 High |
| 1.2 Shiprocket retry cron | **Exact match** — recommended pattern for transient create-order failures | 🟢 High |
| 1.3 TTL + heartbeat | **Conservative** — exceeds max checkout duration | 🟢 High |
| 2.1 Zero-total audit | **Internal** — no provider dependency | 🟢 High |
| 2.2 Cart mutation UX | **Internal** — UX improvement | 🟢 High |
| 2.3 Promo re-validation | **Internal** — business logic | 🟢 High |
| 2.4 PIN re-check | **Exact match** — reuses existing `checkPinServiceability()` | 🟢 High |
| 2.5 Idempotency key | **Standard pattern** — matches Stripe/Razorpay | 🟢 High |
| 3.1 Health check | **Operational best practice** | 🟢 High |
| 3.2 Auto-process | **Internal** — workflow automation | 🟢 High |

**No fix contradicts provider docs or best practices.** All P0/P1 fixes are either:
- Direct implementations of documented webhook/events (1.1, 1.2, 2.4)
- Conservative extensions of existing patterns (1.3, 2.5, 3.1)
- Internal safety improvements (2.1, 2.2, 2.3, 3.2)

*Ready for team review and implementation sprint planning.*
      sql`${orders.updatedAt} < now() - interval '2 minutes'`
    )
  )
  .limit(100);

for (const order of toProcess) {
  await db.update(orders)
    .set({ status: 'PROCESSING', updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), eq(orders.status, 'CONFIRMED')));
}
```

**Alternative:** Add "Ready to Ship" dashboard section in admin showing `CONFIRMED` orders with `shiprocket_order_id` — admin clicks "Mark Processing" (already exists in UI).
---

#### Fix 2.3: Re-validate Promo at Payment Verification
**File(s):** `utils/checkout.ts` → `verifyAndConfirmPayment`

```typescript
// Inside verifyAndConfirmPayment, after order fetch but before signature verify
const promo = await getAttachedPromo(order.cartId);
if (promo && !(await isPromoStillValid(promo.code))) {
  throw new CheckoutError('Promo code expired or disabled. Please restart checkout.', 409);
}
```
  await extendReservation(orderId);
  return NextResponse.json({ ok: true });
}
```

**Why 15 min + 4-min heartbeat:** Covers 99th-percentile Razorpay checkout duration (~8 min) with margin.
```json
{
  "crons": [
    { "path": "/api/cron/retry-shiprocket", "schedule": "*/10 * * * *" }
  ]
}
```

**Alerting:** If any `ok: false`, send Slack/email to ops (reuse `enqueueAndNotify`).
  try {
    await verifyAndConfirmPayment({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });
  } catch (err) {
    console.error('[webhook] payment.captured handler failed:', err);
  }
}
```

**Why it works:** `verifyAndConfirmPayment` already uses conditional `UPDATE … WHERE status='PENDING'` — safe to call twice.