# High-Level Designs for Each Fix

*Review before implementation — each design is independent and deployable separately*

---

## 🎯 Fix 1.1: Razorpay `payment.captured` Webhook Handler

### Architecture
```
Razorpay Dashboard
      │
      ▼ (POST /api/webhooks/razorpay)
┌─────────────────────────────────────┐
│  verifyWebhookSignature(raw, sig)   │  ← timing-safe HMAC-SHA256
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  claimWebhookEvent('razorpay', id)  │  ← PK on (source, event_id) = idempotent
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  verifyAndConfirmPayment({          │  ← REUSES EXISTING FUNCTION
│    razorpayOrderId: entity.order_id,
│    razorpayPaymentId: entity.id,
│    razorpaySignature: webhook sig   │
│  })                                 │
└─────────────────────────────────────┘
      │
      ▼
   Returns 200 (never throws)
```

### Files Changed
| File | Change |
|------|--------|
| `app/api/webhooks/razorpay/route.ts` | Add `case 'payment.captured':` handler (≈15 lines) |
| `utils/checkout.ts` | Export `verifyAndConfirmPayment` (already exported) |

### Data Flow
1. Razorpay sends webhook with `event=payment.captured`, `payload.payment.entity`
2. Verify signature using existing `verifyWebhookSignature()`
3. Deduplicate via `claimWebhookEvent()` — duplicate webhooks become no-op
4. Call existing `verifyAndConfirmPayment()` with extracted IDs
5. That function: verifies signature again (timing-safe), checks amount via server-to-server, atomic `PENDING→CONFIRMED`, decrements stock, clears cart, queues email, pushes Shiprocket
6. Return 200 to stop Razorpay retries

### Error Handling
- **Signature invalid** → 401, log, don't process
- **Event already claimed** → 200 (idempotent)
- **Payment verification fails** → Log error, return 200 (don't retry — Razorpay will retry anyway; our conditional UPDATE prevents double-processing)
- **Never throw** — webhook must 200 to stop exponential backoff retries

### Testing
| Test | Method |
|------|--------|
| Valid webhook → order CONFIRMED | Unit: mock payload, call handler, assert DB state |
| Duplicate webhook → no double stock decrement | Unit: call handler twice, assert stock changed once |
| Invalid signature → 401 | Unit: tamper payload, assert 401 |
| Missing secret → 503 | Unit: unset env, assert 503 |

### Rollback
Revert `app/api/webhooks/razorpay/route.ts` — no DB migration, no schema change.
---

## 🎯 Fix 1.2: Shiprocket Retry Cron

### Architecture
```
Vercel Cron (*/10 * * * *)
      │
      ▼ (GET /api/cron/retry-shiprocket)
┌─────────────────────────────────────┐
│  Authorization: Bearer CRON_SECRET  │  ← only Vercel can call
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  SELECT id, orderNumber             │
│  FROM orders                        │
│  WHERE status='CONFIRMED'           │
│    AND shiprocket_order_id IS NULL  │
│    AND createdAt < now() - 5min     │
│  LIMIT 50                           │
└─────────────────────────────────────┘
      │
      ▼ (for each order)
┌─────────────────────────────────────┐
│  pushToShiprocket(order.id)         │  ← REUSES EXISTING FUNCTION
└─────────────────────────────────────┘
      │
      ▼
   Collect results → JSON response
```

### Files Changed
| File | Change |
|------|--------|
| `app/api/cron/retry-shiprocket/route.ts` | **NEW FILE** (≈40 lines) |
| `vercel.json` | Add cron entry |

### Data Flow
1. Cron triggers every 10 minutes
2. Fetches up to 50 `CONFIRMED` orders without `shiprocket_order_id` older than 5 min
3. For each, calls existing `pushToShiprocket()` (already handles auth, retries, error logging)
4. Returns summary: `{ retried: N, results: [{orderNumber, shiprocketOrderId, ok}, ...] }`
5. If any `ok: false`, existing `enqueueAndNotify` can alert ops (optional enhancement)

### Error Handling
- **Auth fail** → 401 (prevents unauthorized invocation)
- **pushToShiprocket throws** → Caught per-order, logged, `ok: false` in results — other orders continue
- **DB query fails** → 500, cron retries next cycle

### Testing
| Test | Method |
|------|--------|
| Cron finds stuck orders & retries | Integration: create CONFIRMED order without SR ID, run cron, verify SR ID populated |
| Transient SR failure → retry next cycle | Mock SR to fail once, succeed next call |
| Auth rejects non-Vercel calls | Unit: call without Bearer token → 401 |

### Rollback
Remove cron from `vercel.json` or set `CRON_SECRET` to invalid value — zero code rollback needed.
---

## 🎯 Fix 1.3: Reservation TTL + Client Heartbeat

### Architecture
```
┌─────────────────────────────────────┐
│  Server: RESERVATION_TTL_MINUTES=15 │  ← utils/reservations.ts (1 line)
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  New: extendReservation(orderId)    │  ← utils/reservations.ts (new fn)
│  UPDATE stock_reservations          │
│  SET expires_at = now() + 15min     │
│  WHERE order_id = ?                 │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  API: POST /api/checkout            │  ← app/api/checkout/route.ts
│  action: 'extendReservation'        │     new action handler (≈10 lines)
└─────────────────────────────────────┘
      ▲
      │
┌─────────────────────────────────────┐
│  Client: checkout-form.tsx          │
│  useEffect(() => {                  │
│    interval = setInterval(() =>     │
│      fetch('/api/checkout', {       │
│        action: 'extendReservation', │
│        orderId: session.razorpayId  │
│      }), 4 * 60 * 1000)             │
│  }, [session?.razorpayOrderId])     │
└─────────────────────────────────────┘
```

### Files Changed
| File | Change |
|------|--------|
| `utils/reservations.ts` | Change constant to 15, add `extendReservation()` |
| `app/api/checkout/route.ts` | Add `extendReservation` action |
| `components/checkout/checkout-form.tsx` | Add heartbeat `useEffect` |

### Data Flow
1. Checkout starts → `reserveCartItems()` creates reservations with `expires_at = now() + 15min`
2. Client opens Razorpay → heartbeat starts, calls `/api/checkout` every 4 min with `extendReservation`
3. Server extends `expires_at` by 15 min from now
4. If user completes payment → `verifyAndConfirmPayment` → `finalizeReservations()` deletes rows
5. If user abandons → reservation expires after 15 min of no heartbeat → `sweepReservations()` restocks

### Error Handling
- **Heartbeat fails** → Silent catch (best effort) — TTL still covers 15 min from last success
- **Extend fails** → Logged, heartbeat retries next interval
- **No schema change** — uses existing `expires_at` column

### Testing
| Test | Method |
|------|--------|
| TTL = 15 min in code | Unit: assert `RESERVATION_TTL_MINUTES === 15` |
---

## 🎯 Fix 2.1: Zero-Total Order Audit Log

### Architecture
```
┌─────────────────────────────────────┐
│  createCheckoutSession()            │  ← utils/checkout.ts
│  (after zero-total confirmation)    │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  INSERT INTO audit_log              │
│  (event, data, created_at)          │
│  VALUES ('zero_total_order', {...}) │
└─────────────────────────────────────┘
```

### Files Changed
| File | Change |
|------|--------|
| `utils/checkout.ts` | Add `rawQuery` insert after zero-total order confirmed (≈15 lines) |
| *Optional* | Admin dashboard widget (separate PR) |

### Data Flow
1. Zero-total order (100% promo) confirmed in `createCheckoutSession`
2. Insert audit row with: `orderNumber`, `promoCode`, `userId`, `ip`, `timestamp`
3. Admin can query `SELECT * FROM audit_log WHERE event='zero_total_order'`

### Error Handling
- **Audit insert fails** → Log error, **don't fail checkout** — best effort
- No impact on order flow

### Testing
| Test | Method |
|------|--------|
| Zero-total order creates audit row | Unit: mock 100% promo, call createCheckoutSession, query audit_log |
| Normal order → no audit row | Unit: normal checkout, assert no insert |
| Failed insert → checkout still succeeds | Unit: mock DB error, assert no throw |

### Rollback
Remove the insert statement — no schema change (assumes `audit_log` table exists; if not, add migration first).
| Heartbeat extends expires_at | Integration: create reservation, call extend, verify expires_at moved |
| Payment completes → reservations deleted | Integration: full checkout flow |
| Abandon >15 min → stock returned | Integration: create reservation, wait 16 min, run sweep, verify stock |

### Rollback
1. Revert `RESERVATION_TTL_MINUTES` to 10
2. Remove `extendReservation` function
3. Remove API action + client heartbeat — all independent, no migration
---

## 🎯 Fix 2.2: Graceful Cart-Mutation-During-Checkout UX

### Architecture
```
┌─────────────────────────────────────┐
│  cleanUpPendingOrder()              │  ← utils/cart.ts
│  (called on remove/clear cart)      │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  Throw PendingOrderCleanedUpError   │  ← new typed error class
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  checkout-form.tsx                  │  ← components/checkout/checkout-form.tsx
│  catch (e) {                        │
│    if (e.name === 'PendingOrder...')│
│      setNotice('Bag changed...')    │
│  }                                  │
└─────────────────────────────────────┘
```

### Files Changed
| File | Change |
|------|--------|
| `utils/cart.ts` | Add `PendingOrderCleanedUpError` class, throw in `cleanUpPendingOrder` |
| `components/checkout/checkout-form.tsx` | Catch error, show friendly notice, redirect to `/checkout` |

### Data Flow
1. User has PENDING order from tab A checkout
2. User removes item in tab B → `removeCartItem()` → `cleanUpPendingOrder()` finds PENDING order, deletes it, releases reservation
3. `cleanUpPendingOrder` throws `PendingOrderCleanedUpError`
4. Tab A's checkout form catches it (if user tries to pay) → shows "Your bag changed — please restart checkout" → redirects

### Error Handling
- **Cleanup fails** → Already logged silently in catch block (existing behavior)
- **Error thrown only on active PENDING order** — no-op if no PENDING order exists

### Testing
| Test | Method |
|------|--------|
| Cart mutation throws typed error | Unit: create PENDING order, call removeCartItem, assert error thrown |
| No PENDING order → no error | Unit: call removeCartItem without PENDING order, assert no throw |
| Frontend catches & shows notice | Integration: two tabs simulation (or mock fetch to throw) |

### Rollback
1. Revert `utils/cart.ts` to silent catch
2. Revert frontend catch — independent changes
---

## 🎯 Fix 2.3: Promo Re-Validation at Payment Verification

### Architecture
```
┌─────────────────────────────────────┐
│  verifyAndConfirmPayment()          │  ← utils/checkout.ts
│  (after order fetch, before sig)    │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  promo = await getAttachedPromo()   │  ← existing fn
│  if (promo && !await isPromoValid)  │
│    throw CheckoutError(409)         │
└─────────────────────────────────────┘
```

### Files Changed
| File | Change |
|------|--------|
| `utils/checkout.ts` | Add promo re-validation in `verifyAndConfirmPayment` (≈10 lines) |

### Data Flow
1. Payment verification starts
2. Fetch promo attached to order's cart
3. Check if promo still active/valid (existing `isPromoStillValid` or new check)
4. If invalid → throw `CheckoutError('Promo expired/disabled', 409)`
5. Client catches 409 → shows "Promo expired, please restart checkout"

### Error Handling
- **Promo check fails** → Log, allow (fail-open for availability) or fail-closed (stricter) — decide per policy
- **409 returned to client** → User sees actionable message

### Testing
| Test | Method |
|------|--------|
| Valid promo at verify → passes | Unit: active promo, call verifyAndConfirmPayment, assert no throw |
| Disabled promo at verify → 409 | Unit: disable promo after checkout start, call verify, assert 409 |
| No promo → passes | Unit: order without promo, assert no throw |

### Rollback
Remove the validation block — single function change
---

## 🎯 Fix 2.4: PIN Re-Check at Shiprocket Push

### Architecture
```
┌─────────────────────────────────────┐
│  pushToShiprocket(orderId)          │  ← utils/checkout.ts
│  (before createShiprocketOrder)     │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  pinCheck = await checkPinService-  │  ← REUSES EXISTING FUNCTION
│  ability(order.shippingPostalCode)  │
└─────────────────────────────────────┘
      │
      ├── serviceable=true → proceed normally
      │
      └── serviceable=false
            │
            ▼
      ┌─────────────────────────────────┐
      │  UPDATE orders                  │
      │  SET shippingIssue=true,        │
      │      shippingIssueReason='...'  │
      │  WHERE id=orderId               │
      └─────────────────────────────────┘
            │
            ▼
         return null (caller logs error)
```

### Files Changed
| File | Change |
|------|--------|
| `utils/checkout.ts` | Add PIN check in `pushToShiprocket` (≈15 lines) |
| *Schema* | Add `shippingIssue BOOLEAN DEFAULT FALSE`, `shippingIssueReason TEXT` to `orders` |

### Data Flow
1. Payment confirmed → `pushToShiprocket` called
2. Re-check PIN serviceability with current weight
3. If unserviceable: flag order, don't create Shiprocket order, return null
4. Admin sees flagged orders in ledger/dashboard

### Error Handling
- **Serviceability check fails** → Log, proceed (fail-open) or flag (fail-closed) — recommend flag
- **No order failure** — order stays `CONFIRMED`, admin handles

### Testing
---

## 🎯 Fix 2.5: Idempotency Key on Checkout Create

### Architecture
```
Client                          Server
  │                                │
  │ POST /api/checkout             │
  │ Idempotency-Key: cart-addrHash │
  ▼                                ▼
┌──────────────────────────────────┐
│  SELECT order_id FROM            │
│  idempotency_keys WHERE key=?    │
└──────────────────────────────────┘
  │                                │
  ├─ Found + PENDING → return existing session
  │
  └─ Not found
        │
        ▼
┌──────────────────────────────────┐
│  createCheckoutSession()         │
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│  INSERT INTO idempotency_keys    │
│  (key, order_id) ON CONFLICT     │
│  DO NOTHING                      │
└──────────────────────────────────┘
```

### Files Changed
| File | Change |
|------|--------|
| `app/api/checkout/route.ts` | Add idempotency check at top, insert after success (≈25 lines) |
| *Migration* | Create `idempotency_keys` table |
| `components/checkout/checkout-form.tsx` | Generate & send `Idempotency-Key` header |

### Data Flow
1. Client generates key: `${cartId}-${addressHash}` (hash of address fields)
2. Sends with `POST /api/checkout` as `Idempotency-Key` header
3. Server checks table — if exists and order is `PENDING`, returns that session
4. Otherwise creates new session, inserts key→order mapping
5. Duplicate clicks return same session

### Error Handling
- **Key missing** → Proceed without idempotency (backward compatible)
- **DB insert fails** → Log, continue (non-blocking)
---

## 🎯 Fix 3.1: Health Check Endpoint

### Architecture
```
┌─────────────────────────────────────┐
│  GET /api/health                    │  ← NEW FILE app/api/health/route.ts
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  checks = {                         │
│    database: true,                  │
│    razorpayWebhookSecret: !!env,    │
│    shiprocketWebhookToken: !!env,   │
│    shiprocketApiToken: !!env        │
│  }                                  │
│  healthy = all true                 │
│  return {healthy, checks}           │
└─────────────────────────────────────┘
```

### Files Changed
| File | Change |
|------|--------|
| `app/api/health/route.ts` | **NEW FILE** (≈25 lines) |
| *Monitoring* | Add ping to uptime monitor (Datadog, BetterUptime, etc.) |

### Data Flow
1. Monitor pings `/api/health` every 60s
2. Returns `{healthy: true, checks: {...}}` or 503 if any check false
3. Alert on `healthy: false`

### Testing
| Test | Method |
|------|--------|
| All env set → 200 healthy:true | Unit: set env, call endpoint |
| Missing secret → 503 healthy:false | Unit: unset one env, call endpoint |

---

## 🎯 Fix 3.2: Auto-Process CONFIRMED→PROCESSING

### Architecture
```
Vercel Cron (*/5 * * * *)
      │
      ▼ (GET /api/cron/auto-process)
┌─────────────────────────────────────┐
│  SELECT id FROM orders              │
│  WHERE status='CONFIRMED'           │
│    AND shiprocket_order_id IS NOT   │
│    NULL                             │
│    AND updatedAt < now() - 2min     │
│  LIMIT 100                          │
└─────────────────────────────────────┘
      │
      ▼ (for each)
┌─────────────────────────────────────┐
│  UPDATE orders                      │
│  SET status='PROCESSING',           │
│      updatedAt=now()                │
│  WHERE id=? AND status='CONFIRMED'  │
└─────────────────────────────────────┘
```

### Files Changed
| File | Change |
|------|--------|
| `app/api/cron/auto-process/route.ts` | **NEW FILE** (≈30 lines) |
| `vercel.json` | Add cron entry |

### Alternative (No Cron)
Add "Ready to Ship" section in admin showing `CONFIRMED` + `shiprocket_order_id` — admin clicks existing "Mark Processing" button.

### Testing
| Test | Method |
|------|--------|
| CONFIRMED + SR ID → PROCESSING after 2min | Integration: create order, wait, run cron, assert status |
| CONFIRMED without SR ID → skipped | Unit: mock query, assert not selected |

### Rollback
Remove cron from `vercel.json` — zero code rollback
### Rollback
Delete `app/api/health/route.ts` — zero impact
- **Key collision (different order)** → `ON CONFLICT DO NOTHING` — first wins

### Testing
| Test | Method |
---

## 📋 Implementation Order & Dependencies

| Fix | Depends On | Can Start |
|-----|------------|-----------|
| 1.1 | None | ✅ Immediately |
| 1.2 | None | ✅ Immediately |
| 1.3 | None | ✅ Immediately |
| 2.1 | `audit_log` table exists | ⚠️ Check schema first |
| 2.2 | None | ✅ Immediately |
| 2.3 | `isPromoStillValid` helper | ⚠️ May need to add |
| 2.4 | `shippingIssue` columns | ⚠️ Migration needed |
| 2.5 | `idempotency_keys` table | ⚠️ Migration needed |
| 3.1 | None | ✅ Immediately |
| 3.2 | None | ✅ Immediately |

---

## 🚦 Go/No-Go Checklist Per Fix

Before implementing each fix, confirm:
- [ ] Design reviewed and approved
- [ ] Dependencies resolved (migrations, helpers)
- [ ] Test plan written
- [ ] Rollback plan confirmed
- [ ] Owner assigned

---

*Each fix is independently deployable. Implement in priority order (P0 → P1 → P2) or parallelize across team members.*
|------|--------|
| Double POST same key → same order | Integration: two rapid POSTs, assert one PENDING order |
| Different key → different order | Integration: two keys, assert two orders |
| Expired/completed order → new session | Unit: insert key for CONFIRMED order, new POST creates new |

### Rollback
1. Remove idempotency logic from route
2. Drop `idempotency_keys` table
3. Remove header from client
| Test | Method |
|------|--------|
| Serviceable PIN → SR order created | Integration: normal flow |
| Unserviceable PIN → flag set, no SR order | Integration: mock `checkPinServiceability` to return false |
| Flag visible in admin | Manual: check ledger query includes `shippingIssue` |

### Rollback
1. Remove PIN check from `pushToShiprocket`
2. Drop columns via migration (if added)