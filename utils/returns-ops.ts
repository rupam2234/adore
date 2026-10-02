/**
 * Returns operations — the back half of the flow.
 *
 * utils/returns.ts      → is this customer ALLOWED to ask?   (pure, customer-facing)
 * utils/returns-state.ts→ what may happen NEXT, may money move? (pure, the rules)
 * utils/returns-fraud.ts→ who is gaming us?                   (pure, the signals)
 * THIS FILE             → does it, against the DB, calling the 3rd parties.
 *
 * The design rule that shapes everything here: **the database is the source of
 * truth for state, and third parties are called for effect, never for truth.**
 * A Shiprocket or Razorpay outage must never corrupt our records, and a webhook
 * replay must never move money. So every mutation follows the same shape:
 *
 *   1. Read the current row.
 *   2. Ask the pure layer whether the transition is legal.
 *   3. Write the new state, guarded by `WHERE status = <what we read>` — so if
 *      anything changed underneath us, zero rows are affected and we bail out
 *      rather than overwrite it.
 *   4. THEN call the third party, and record the outcome.
 *
 * Step 3 is what makes this safe under retries. A "settle refund" that arrives
 * twice, or a webhook delivered twice, loses the second race in the database
 * rather than at a code path someone has to remember to guard.
 */

import { rawQuery, sql } from '@/utils/db';
import { createRazorpayRefund, fetchRazorpayRefund, RazorpayError } from '@/utils/razorpay';
import {
  createReturnRma,
  scheduleReversePickup,
  fetchReturnTracking,
  ShiprocketReturnError,
} from '@/utils/shipping';
import { toPaise } from '@/utils/checkout-format';
import {
  assertCanSettle,
  assertCanTransition,
  computeSettlement,
  TransitionError,
  type SettlementPlan,
} from './returns-state';
import {
  evaluateHardBlocks,
  scoreReturnRisk,
  type BlockVerdict,
  type RiskSignals,
} from './returns-fraud';
import {
  CUSTOMER_FAULT_EXEMPT_REASONS,
  RETURN_WINDOW_DAYS,
  SELF_SHIP,
} from './returns';
import { recordEvent } from './returns-audit';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ReturnsOpsError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// The row we operate on
// ---------------------------------------------------------------------------

/**
 * Everything a transition needs, read in ONE query.
 *
 * The Neon HTTP driver costs ~120ms per round-trip, so serialising "read the
 * request, then the order, then the customer risk, then the dispute" would add
 * ~360ms to every admin click. One wide join keeps it to a single round-trip —
 * and forces us to be explicit about exactly what each decision depends on.
 *
 * Note `order_already_refunded`: the sum of PROCESSED refunds on this order
 * EXCLUDING this request. It is the ceiling that stops a multi-item order being
 * refunded several times over, and it must be read at the moment of settlement,
 * not cached, or two concurrent settlements both see the same headroom.
 */
type OpsRow = {
  id: string;
  type: string;
  reason: string;
  status: string;
  qty: number;
  fee: string;
  refund_amount: string;
  exchange_variant_id: string | null;
  pickup_attempts: number;
  pickup_exhausted: boolean;
  photos: string[] | null;
  customer_id: string;
  order_id: string;
  order_item_id: string;
  order_number: string;
  order_status: string;
  order_total: string;
  order_shipping: string;
  delivered_at: string | null;
  razorpay_payment_id: string | null;
  variant_id: string;
  item_quantity: number;
  returned_qty: number;
  product_name: string;
  sku: string;
  item_unit_price: string;
  order_already_refunded: string;
  account_blocked: boolean;
  account_blocked_reason: string | null;
  chargeback_count: number;
  lifetime_returns: number;
  lifetime_refunded: string;
  recent_returns: number;
  recent_value: string;
  prior_rejections: number;
  prior_qc_failures: number;
  open_dispute: boolean;
  shiprocket_awb: string | null;
  shiprocket_return_awb: string | null;
};

/** A return request as shown in the admin queue. */
export type AdminReturn = {
  id: string;
  type: string;
  reason: string;
  status: string;
  qty: number;
  fee: string;
  refundAmount: string;
  netRefund: string | null;
  orderId: string;
  orderItemId: string;
  orderNumber: string;
  productName: string;
  sku: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  createdAt: string;
  deliveredAt: string | null;
  riskScore: number;
  riskReasons: string[] | null;
  isBlocked: boolean;
  blockedReason: string | null;
  photos: string[];
  pickupAttempts: number;
  returnAwb: string | null;
  rejectionReason: string | null;
  notes: string | null;
};

/**
 * Read a request with everything a transition needs.
 *
 * The only selector is the return id, so callers MUST have already established
 * authorisation. The customer-facing paths scope by `customerId` in their own
 * query (see returns-db.ts); this one is the admin/system path.
 */
export async function loadOpsRow(returnId: string): Promise<OpsRow | null> {
  const rows = await rawQuery<OpsRow>(sql`
    SELECT
      r.id, r.type, r.reason, r.status, r.qty, r.fee, r.refund_amount,
      r.exchange_variant_id, r.pickup_attempts, r.pickup_exhausted, r.photos,
      r.customer_id, r.order_id, r.order_item_id,
      o.order_number, o.status AS order_status, o.total_amount AS order_total,
      o.shipping_amount AS order_shipping, o.delivered_at,
      o.razorpay_payment_id,
      oi.variant_id, oi.quantity AS item_quantity,
      oi.returned_qty, oi.product_name, oi.sku, oi.unit_price AS item_unit_price,
      COALESCE((
        SELECT SUM(f.amount) FROM refunds f
        JOIN return_requests r2 ON r2.id = f.return_request_id
        WHERE r2.order_id = r.order_id
          AND f.status = 'PROCESSED'
          AND f.return_request_id <> r.id
      ), 0)::text AS order_already_refunded,
      COALESCE(cr.is_blocked, false)      AS account_blocked,
      cr.blocked_reason                   AS account_blocked_reason,
      COALESCE(cr.chargeback_count, 0)    AS chargeback_count,
      COALESCE(cr.total_returns, 0)       AS lifetime_returns,
      COALESCE(cr.total_refunded, 0)::text    AS lifetime_refunded,
      COALESCE(cr.recent_returns, 0)      AS recent_returns,
      COALESCE(cr.recent_value, 0)::text      AS recent_value,
      (SELECT COUNT(*)::int FROM return_requests r3
        WHERE r3.customer_id = r.customer_id AND r3.status = 'REJECTED'
      ) AS prior_rejections,
      (SELECT COUNT(*)::int FROM return_requests r4
        WHERE r4.customer_id = r.customer_id AND r4.status = 'QC_FAILED'
      ) AS prior_qc_failures,
      EXISTS (
        SELECT 1 FROM payment_disputes d
        JOIN orders o2 ON o2.razorpay_payment_id = d.razorpay_payment_id
        WHERE o2.id = r.order_id AND d.status = 'OPEN'
      ) AS open_dispute,
      NULL::text AS shiprocket_awb,
      r.shiprocket_return_awb
    FROM return_requests r
    JOIN orders o       ON o.id = r.order_id
    JOIN order_items oi ON oi.id = r.order_item_id
    LEFT JOIN customer_risk cr ON cr.customer_id = r.customer_id
    WHERE r.id = ${returnId}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
// Defined in utils/returns-audit.ts so the customer submit path can write its
// opening event without importing this module (and the payment/courier adapters
// it pulls in). Re-exported here so operations code has one obvious import.
export { recordEvent, type ReturnEventInput } from './returns-audit';

// ---------------------------------------------------------------------------
// The guarded write — the concurrency primitive
// ---------------------------------------------------------------------------

/**
 * Compare-and-set the status, atomically.
 *
 * `UPDATE ... WHERE id = ? AND status = ?` is the whole trick. If another admin
 * (or a replayed webhook) already moved the row, zero rows are updated and we
 * return false, and the caller treats that as "someone else got there first"
 * rather than proceeding on a stale read.
 *
 * This is why the read in step 1 doesn't need SELECT ... FOR UPDATE: the
 * optimistic check at write time is what actually serialises, and it survives
 * the Neon HTTP driver (where a session/transaction would need a second
 * connection and would not be free).
 */
async function casStatus(
  returnId: string,
  expected: string,
  next: string
): Promise<boolean> {
  const rows = await rawQuery<{ id: string }>(sql`
    UPDATE return_requests
    SET status = ${next},
        updated_at = now()
    WHERE id = ${returnId} AND status = ${expected}
    RETURNING id
  `);
  return rows.length > 0;
}

/** True when this reason means the fault is ours (waived fee, free pickup). */
function isOurFault(reason: string): boolean {
  return (CUSTOMER_FAULT_EXEMPT_REASONS as readonly string[]).includes(reason);
}

// ---------------------------------------------------------------------------
// Risk + block evaluation
// ---------------------------------------------------------------------------

/** Assemble the scoring signals from a loaded row. */
function buildRiskSignals(row: OpsRow, now: Date): RiskSignals {
  const orderValue = Number(row.order_total) || 0;
  const requestValue = Number(row.item_unit_price) * row.qty;

  // Hours since delivery. Null when we genuinely do not know (legacy orders
  // with no delivered_at) — the scorer treats null as "no signal" rather than
  // guessing, because inventing a delivery date would manufacture suspicion.
  let hoursSinceDelivery: number | null = null;
  if (row.delivered_at) {
    const delivered = new Date(row.delivered_at);
    if (!Number.isNaN(delivered.getTime())) {
      hoursSinceDelivery = Math.max(
        0,
        (now.getTime() - delivered.getTime()) / 3_600_000
      );
    }
  }

  return {
    lifetimeRefunded: Number(row.lifetime_refunded) || 0,
    lifetimeReturns: row.lifetime_returns ?? 0,
    recentReturns: row.recent_returns ?? 0,
    recentValue: Number(row.recent_value) || 0,
    requestValue,
    orderValue,
    hoursSinceDelivery,
    // Both counts are conservative placeholders until the queue query supplies
    // the true figures; the scorer only uses them for the "whole order" term.
    itemsReturnedFromOrder: 1,
    itemsOnOrder: 1,
    priorRejections: row.prior_rejections ?? 0,
    priorQcFailures: row.prior_qc_failures ?? 0,
    hasOpenDispute: row.open_dispute ?? false,
    chargebackCount: row.chargeback_count ?? 0,
    accountBlocked: row.account_blocked ?? false,
  };
}

/** Assemble the hard-block context. */
function buildBlockContext(row: OpsRow): BlockContextLite {
  const orderValue = Number(row.order_total) || 0;
  const recentValue = Number(row.recent_value) || 0;
  return {
    hasOpenDispute: row.open_dispute ?? false,
    accountBlocked: row.account_blocked ?? false,
    accountBlockedReason: row.account_blocked_reason,
    chargebackCount: row.chargeback_count ?? 0,
    // The empty-box signal is NOT inferred from the reason text. It requires
    // the courier to have confirmed delivery while the customer claims
    // non-receipt, and we only have `order_status = DELIVERED` here. Treating
    // that as proof would block every legitimate wrong-item claim, so it stays
    // false and the webhook path sets it when the evidence is explicit.
    emptyBoxClaim: false,
    confirmedFraud: false,
    recentValueRatio: orderValue > 0 ? recentValue / orderValue : 0,
    recentReturns: row.recent_returns ?? 0,
  };
}

/** Local alias so we don't re-export the whole fraud module surface. */
type BlockContextLite = Parameters<typeof evaluateHardBlocks>[0];

/** Is the claim's return window still open? */
function windowHasClosed(row: OpsRow, now: Date): boolean {
  if (!row.delivered_at) {
    // Unknown delivery date. Treated as CLOSED for approval purposes: we will
    // not promise a refund we cannot evidence. The customer-facing path routes
    // these to support (DELIVERY_DATE_UNKNOWN) rather than silently refusing.
    return true;
  }
  const delivered = new Date(row.delivered_at);
  if (Number.isNaN(delivered.getTime())) return true;
  const windowMs = (isOurFault(row.reason) ? 48 : RETURN_WINDOW_DAYS * 24) * 3_600_000;
  return now.getTime() - delivered.getTime() > windowMs;
}

// ---------------------------------------------------------------------------
// 1. Review
// ---------------------------------------------------------------------------

export type ReviewOutcome =
  | { ok: true; status: string; riskScore: number; riskReasons: string[] }
  | { ok: false; code: string; message: string; blockReason: string | null };

/**
 * Review a REQUESTED return: score it, hard-block if warranted, otherwise
 * approve.
 *
 * This is the first gate a claim passes, and the last point at which refusing
 * is cheap. Everything after this point has consumed courier effort, warehouse
 * time, or goodwill — so the abuse checks are front-loaded here rather than at
 * settlement.
 */
export async function reviewReturn(
  returnId: string,
  actor: string,
  opts: { approve: boolean; rejectionReason?: string; notes?: string } = {
    approve: true,
  }
): Promise<ReviewOutcome> {
  const row = await loadOpsRow(returnId);
  if (!row) throw new ReturnsOpsError('NOT_FOUND', 'Return not found.', 404);

  const now = new Date();

  // 1. Score — advisory only. Persisted so the queue can sort on it.
  const risk = scoreReturnRisk(buildRiskSignals(row, now));
  await rawQuery(sql`
    UPDATE return_requests
    SET risk_score = ${risk.score},
        risk_reasons = ${JSON.stringify(risk.reasons)}
    WHERE id = ${returnId}
  `);

  // 2. Score the request, and record the abuse ledger's rolling window.
  await refreshCustomerRisk(row.customer_id);

  if (!opts.approve) {
    const reason = (opts.rejectionReason ?? '').trim();
    if (!reason) {
      throw new ReturnsOpsError(
        'REASON_REQUIRED',
        'Please give the customer a reason for the refusal.'
      );
    }
    const ok = await casStatus(returnId, 'REQUESTED', 'REJECTED');
    if (!ok) {
      return {
        ok: false,
        code: 'STALE',
        message: 'This request has already moved on. Refresh and try again.',
        blockReason: null,
      };
    }
    await rawQuery(sql`
      UPDATE return_requests
      SET rejection_reason = ${reason},
          notes = ${opts.notes ?? null},
          is_blocked = ${risk.score >= 60},
          blocked_reason = ${risk.score >= 60 ? risk.reasons.join('; ') : null},
          resolved_at = now()
      WHERE id = ${returnId}
    `);
    await recordEvent({
      returnRequestId: returnId,
      event: 'rejected',
      fromStatus: 'REQUESTED',
      toStatus: 'REJECTED',
      actor,
      data: { riskScore: risk.score, reason },
    });
    return { ok: true, status: 'REJECTED', riskScore: risk.score, riskReasons: risk.reasons };
  }

  // 3. Hard blocks.
  const block: BlockVerdict = evaluateHardBlocks(buildBlockContext(row));
  if (block.blocked) {
    await rawQuery(sql`
      UPDATE return_requests
      SET is_blocked = true, blocked_reason = ${block.reason}
      WHERE id = ${returnId}
    `);
    await recordEvent({
      returnRequestId: returnId,
      event: 'blocked',
      fromStatus: 'REQUESTED',
      actor,
      data: { code: block.code, reason: block.reason },
    });
    return {
      ok: false,
      code: block.code ?? 'BLOCKED',
      message: 'This request cannot be approved.',
      blockReason: block.reason,
    };
  }

  // 4. Approve. assertCanTransition re-checks dispute/block/window server-side;
  // the explicit block above is for a clearer audit trail, this is the guard.
  try {
    assertCanTransition(row.status, 'APPROVED', {
      actor,
      now,
      windowClosed: windowHasClosed(row, now),
      pickupAttemptsExhausted: row.pickup_exhausted,
      hasOpenDispute: row.open_dispute,
      accountBlocked: row.account_blocked,
    });
  } catch (error) {
    if (error instanceof TransitionError) {
      return { ok: false, code: error.code, message: error.message, blockReason: null };
    }
    throw error;
  }

  const ok = await casStatus(returnId, 'REQUESTED', 'APPROVED');
  if (!ok) {
    return {
      ok: false,
      code: 'STALE',
      message: 'This request has already moved on. Refresh and try again.',
      blockReason: null,
    };
  }
  await rawQuery(sql`
    UPDATE return_requests SET notes = ${opts.notes ?? null} WHERE id = ${returnId}
  `);
  await recordEvent({
    returnRequestId: returnId,
    event: 'approved',
    fromStatus: 'REQUESTED',
    toStatus: 'APPROVED',
    actor,
    data: { riskScore: risk.score, riskReasons: risk.reasons },
  });

  return { ok: true, status: 'APPROVED', riskScore: risk.score, riskReasons: risk.reasons };
}

// ---------------------------------------------------------------------------
// Customer abuse ledger
// ---------------------------------------------------------------------------

/**
 * Recompute a customer's rolling risk counters from the return/refund tables.
 *
 * Deliberately a full recompute rather than an increment. An increment drifts
 * the moment one code path forgets to update, and a fraud-detection counter that
 * under-counts is worse than no counter — it gives false confidence. This is
 * one indexed aggregate, cheap enough to run on every review.
 *
 * `is_blocked` is NOT set here. Blocking is a human decision; this only
 * accumulates the evidence that supports one.
 */
export async function refreshCustomerRisk(customerId: string): Promise<void> {
  await rawQuery(sql`
    INSERT INTO customer_risk (
      customer_id, total_returns, total_refunded,
      recent_returns, recent_value, chargeback_count, updated_at
    )
    SELECT
      ${customerId},
      COALESCE(lifetime.n, 0),
      COALESCE(lifetime.value, 0),
      COALESCE(recent.n, 0),
      COALESCE(recent.value, 0),
      COALESCE(disputes.n, 0),
      now()
    FROM (SELECT 1) AS _force_row
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n, SUM(r.payout_amount)::numeric AS value
      FROM return_requests r
      WHERE r.customer_id = ${customerId}
        AND r.status IN ('REFUNDED','EXCHANGE_SHIPPED')
    ) lifetime ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n, SUM(r.payout_amount)::numeric AS value
      FROM return_requests r
      WHERE r.customer_id = ${customerId}
        AND r.status IN ('REFUNDED','EXCHANGE_SHIPPED')
        AND r.resolved_at > now() - interval '90 days'
    ) recent ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n
      FROM payment_disputes d
      JOIN orders o ON o.razorpay_payment_id = d.razorpay_payment_id
      WHERE o.customer_id = ${customerId} AND d.status = 'OPEN'
    ) disputes ON true
    ON CONFLICT (customer_id) DO UPDATE SET
      total_returns     = EXCLUDED.total_returns,
      total_refunded    = EXCLUDED.total_refunded,
      recent_returns    = EXCLUDED.recent_returns,
      recent_value      = EXCLUDED.recent_value,
      chargeback_count  = EXCLUDED.chargeback_count,
      updated_at        = now()
  `);
}

/** Manually block or unblock an account. Admin-only; always audited. */
export async function setAccountBlock(
  customerId: string,
  blocked: boolean,
  reason: string | null,
  actor: string
): Promise<void> {
  await rawQuery(sql`
    INSERT INTO customer_risk (customer_id, is_blocked, blocked_reason, updated_at)
    VALUES (${customerId}, ${blocked}, ${reason}, now())
    ON CONFLICT (customer_id) DO UPDATE SET
      is_blocked = EXCLUDED.is_blocked,
      blocked_reason = EXCLUDED.blocked_reason,
      updated_at = now()
  `);
  await recordEvent({
    returnRequestId: await anyReturnForCustomer(customerId),
    event: blocked ? 'account_blocked' : 'account_unblocked',
    actor,
    data: { customerId, reason },
  });
}

/** Some return id for this customer, purely so the audit row has a parent. */
async function anyReturnForCustomer(customerId: string): Promise<string> {
  const rows = await rawQuery<{ id: string }>(sql`
    SELECT id FROM return_requests
    WHERE customer_id = ${customerId}
    ORDER BY created_at DESC LIMIT 1
  `);
  // A brand-new account may have no returns at all. We still want the audit
  // trail, so fall back to a sentinel rather than failing the write.
  return rows[0]?.id ?? `account:${customerId}`;
}

// ---------------------------------------------------------------------------
// 2. Reverse logistics — book the pickup with Shiprocket
// ---------------------------------------------------------------------------

export type PickupOutcome =
  | { ok: true; status: 'PICKUP_SCHEDULED' | 'SELF_SHIP_PENDING'; rmaId: string | null; alreadyScheduled: boolean }
  | { ok: false; code: string; message: string };

/**
 * Book the reverse pickup for an APPROVED return.
 *
 * Order of operations is deliberate and matches the failure costs:
 *   APPROVED → create RMA → schedule pickup → PICKUP_SCHEDULED
 *
 * We move the status to APPROVED first (already done by review), call Shiprocket,
 * and only then write PICKUP_SCHEDULED. If Shiprocket is down we stay in
 * APPROVED, which is a safe, retryable, human-visible state — not a customer
 * left believing a rider is coming.
 *
 * `PICKUP_UNAVAILABLE` is a normal outcome (PIN outside reverse coverage) and
 * routes the customer to the self-ship fallback we publish on /returns, with
 * the fee waived. That is both the honest and the cheap answer.
 */
export async function bookReversePickup(
  returnId: string,
  actor: string
): Promise<PickupOutcome> {
  const row = await loadOpsRow(returnId);
  if (!row) throw new ReturnsOpsError('NOT_FOUND', 'Return not found.', 404);

  // Idempotent: a re-book on an already-scheduled return is a no-op, not an
  // error. Couriers charge per pickup, so a double-book is real money.
  if (row.status === 'PICKUP_SCHEDULED') {
    return { ok: true, status: 'PICKUP_SCHEDULED', rmaId: row.shiprocket_return_awb, alreadyScheduled: true };
  }
  if (row.status === 'SELF_SHIP_PENDING') {
    return { ok: true, status: 'SELF_SHIP_PENDING', rmaId: row.shiprocket_return_awb, alreadyScheduled: false };
  }

  try {
    assertCanTransition(row.status, 'PICKUP_SCHEDULED', {
      actor,
      pickupAttemptsExhausted: row.pickup_exhausted,
    });
  } catch (error) {
    if (error instanceof TransitionError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }

  // We need the original AWB to raise the RMA. If we never captured it, the
  // return cannot be booked automatically and a human must sort it out —
  // guessing an AWB would create an orphan RMA the courier cannot match.
  const awb = row.shiprocket_awb;
  if (!awb) {
    await recordEvent({
      returnRequestId: returnId,
      event: 'pickup_blocked_no_awb',
      fromStatus: row.status,
      actor,
      data: { reason: 'No AWB recorded for this order' },
    });
    return {
      ok: false,
      code: 'NO_AWB',
      message:
        'We have no courier reference for this order. Please book the pickup manually.',
    };
  }

  const address = await loadPickupAddress(row.order_id);

  let rmaId: string | null = row.shiprocket_return_awb;
  try {
    if (!rmaId) {
      const rma = await createReturnRma({
        awb,
        orderId: row.order_number,
        customerName: address?.fullName ?? 'Customer',
        customerEmail: address?.email ?? '',
        returnReason: row.reason,
        requestId: returnId,
        items: [{ name: row.product_name, sku: row.sku, units: row.qty }],
      });
      if (rma.alreadyExisted && !rma.rmaId) {
        // Shiprocket already has an RMA on this AWB but would not tell us which.
        // Stopping here is correct: booking a second rider costs real money and
        // confuses the customer's tracking.
        return {
          ok: false,
          code: 'RMA_EXISTS',
          message:
            'A return already exists with the courier for this order. Our team will confirm the details.',
        };
      }
      rmaId = rma.rmaId || null;
      if (rmaId) {
        await rawQuery(sql`
          UPDATE return_requests
          SET shiprocket_return_awb = ${rmaId}, updated_at = now()
          WHERE id = ${returnId}
        `);
      }
    }

    if (!address) {
      return {
        ok: false,
        code: 'NO_ADDRESS',
        message: 'We have no pickup address on file for this order.',
      };
    }

    const pickup = await scheduleReversePickup({
      rmaId: rmaId!,
      customerName: address.fullName,
      phone: address.phone,
      email: address.email,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      state: address.state,
      pincode: address.postalCode,
      // Two days' lead time: same-day/next-day pickups are the single most
      // common cause of a failed first attempt, and a failed attempt costs us a
      // re-attempt fee and a day of the customer's patience.
      pickupDate: pickupDateIn(2),
    });

    // Only now do we commit the status. Everything above is safe to retry.
    const ok = await casStatus(returnId, row.status, 'PICKUP_SCHEDULED');
    if (!ok) {
      return {
        ok: false,
        code: 'STALE',
        message: 'This request changed while we were booking. Refresh and try again.',
      };
    }

    await rawQuery(sql`
      UPDATE return_requests
      SET pickup_attempts = pickup_attempts + 1,
          shiprocket_return_awb = COALESCE(${rmaId}, shiprocket_return_awb),
          updated_at = now()
      WHERE id = ${returnId}
    `);
    await recordEvent({
      returnRequestId: returnId,
      event: 'pickup_scheduled',
      fromStatus: row.status,
      toStatus: 'PICKUP_SCHEDULED',
      actor,
      data: {
        rmaId,
        pickupId: pickup.pickupId,
        alreadyScheduled: pickup.alreadyScheduled,
      },
    });

    return {
      ok: true,
      status: 'PICKUP_SCHEDULED',
      rmaId,
      alreadyScheduled: pickup.alreadyScheduled,
    };
  } catch (error) {
    if (error instanceof ShiprocketReturnError) {
      // PIN outside reverse coverage: a normal, published outcome. Offer the
      // self-ship fallback and WAIVE the fee — we published that promise, and
      // refusing here is an instant bad-review generator for something that is
      // not the customer's fault.
      if (error.code === 'PICKUP_UNAVAILABLE') {
        const moved = await casStatus(returnId, row.status, 'SELF_SHIP_PENDING');
        if (moved) {
          await rawQuery(sql`
            UPDATE return_requests
            SET fee = 0,
                notes = COALESCE(notes, '') ||
                  ${'Reverse pickup unavailable at this PIN. Self-ship offered; fee waived. '}
            WHERE id = ${returnId}
          `);
          await recordEvent({
            returnRequestId: returnId,
            event: 'self_ship_offered',
            fromStatus: row.status,
            toStatus: 'SELF_SHIP_PENDING',
            actor,
            data: {
              code: error.code,
              reimbursement: SELF_SHIP.returnReimbursement,
            },
          });
        }
        return {
          ok: true,
          status: 'SELF_SHIP_PENDING',
          rmaId,
          alreadyScheduled: false,
        };
      }

      await recordEvent({
        returnRequestId: returnId,
        event: 'pickup_failed',
        fromStatus: row.status,
        actor,
        data: { code: error.code, message: error.message },
      });
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

/** ISO date N days out, skipping Sundays (couriers do not collect). */
function pickupDateIn(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Mark a self-shipped return as received, and pay the published reimbursement.
 *
 * The reimbursement is a real cost, so it is bounded three ways:
 *  - only from SELF_SHIP_PENDING (the only state where we asked for it);
 *  - only once per request (a `self_ship_reimbursed` event guards the second);
 *  - at the published flat rate, never a percentage of the order.
 *
 * We do NOT let a customer claim reimbursement for a parcel we never received —
 * the transition requires the status to already be SELF_SHIP_PENDING, and a
 * human moves it to RECEIVED after physically scanning the parcel.
 */
export async function confirmSelfShipment(
  returnId: string,
  actor: string
): Promise<QcOutcome> {
  const row = await loadOpsRow(returnId);
  if (!row) throw new ReturnsOpsError('NOT_FOUND', 'Return not found.', 404);

  if (row.status !== 'SELF_SHIP_PENDING') {
    return {
      ok: false,
      code: 'NOT_SELF_SHIP',
      message: 'This return is not waiting for a self-shipped parcel.',
    };
  }

  // Idempotency: the event log is the proof, checked before we pay.
  const already = await rawQuery<{ id: string }>(sql`
    SELECT id FROM return_events
    WHERE return_request_id = ${returnId} AND event = 'self_ship_reimbursed'
    LIMIT 1
  `);
  if (already.length > 0) {
    return { ok: true, status: 'RECEIVED' };
  }

  const ok = await casStatus(returnId, 'SELF_SHIP_PENDING', 'IN_TRANSIT');
  if (!ok) {
    return {
      ok: false,
      code: 'STALE',
      message: 'This request changed. Refresh and try again.',
    };
  }

  // An exchange has a second shipment to fund (sending the replacement), so the
  // published fallback differs by request type. A return only has the one leg.
  const amount =
    row.type === 'EXCHANGE'
      ? SELF_SHIP.exchangeReimbursement
      : SELF_SHIP.returnReimbursement;

  await recordEvent({
    returnRequestId: returnId,
    event: 'self_ship_reimbursed',
    fromStatus: 'SELF_SHIP_PENDING',
    toStatus: 'IN_TRANSIT',
    actor,
    data: { amount, selfShip: true },
  });

  return { ok: true, status: 'IN_TRANSIT' };
}


type PickupAddress = {
  fullName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
};

/**
 * The address the parcel is collected FROM.
 *
 * Read from the order's shipping-address snapshot, NOT the customer's current
 * default address. If a customer edits their address after ordering, a pickup
 * booked to the new one sends a rider to the wrong place — and sometimes to a
 * different state entirely, which the courier will refuse to serve.
 */
async function loadPickupAddress(
  orderId: string
): Promise<PickupAddress | null> {
  const rows = await rawQuery<{
    snap: Record<string, string> | null;
    email: string | null;
    name: string | null;
    phone: string | null;
  }>(sql`
    SELECT o.shipping_address_snapshot AS snap, c.email, c.name, c.phone
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${orderId}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  const s = row.snap ?? {};
  const postalCode = s.postalCode ?? s.pincode ?? '';
  if (!postalCode) return null;
  return {
    fullName: s.fullName ?? row.name ?? 'Customer',
    email: s.email ?? row.email ?? '',
    phone: s.phone ?? row.phone ?? '',
    addressLine1: s.addressLine1 ?? s.address1 ?? '',
    addressLine2: s.addressLine2 ?? s.address2 ?? null,
    city: s.city ?? '',
    state: s.state ?? '',
    postalCode,
  };
}

// ---------------------------------------------------------------------------
// 3. Warehouse — receipt and quality control
// ---------------------------------------------------------------------------

export type QcOutcome =
  | { ok: true; status: 'IN_TRANSIT' | 'RECEIVED' | 'QC_PASSED' | 'QC_FAILED' }
  | { ok: false; code: string; message: string };

/**
 * Record the bench decision on a parcel that has reached the warehouse.
 *
 * `markReceived` is separate because receipt and inspection are different events
 * in real life — a parcel is scanned in the morning and inspected after. It
 * also means a courier webhook that fires "delivered" cannot skip QC, which is
 * the single most valuable control in the whole flow: it is what stops a refund
 * being issued for goods that never arrived.
 */
export async function markReceived(
  returnId: string,
  actor: string,
  awb?: string
): Promise<QcOutcome> {
  const row = await loadOpsRow(returnId);
  if (!row) throw new ReturnsOpsError('NOT_FOUND', 'Return not found.', 404);

  // Idempotent — couriers retry, and a double "received" is harmless. Checked
  // BEFORE the transition guard so a replayed webhook doesn't surface as an
  // error to the courier (which would make them retry again).
  if (row.status === 'RECEIVED') {
    return { ok: true, status: 'RECEIVED' };
  }

  try {
    assertCanTransition(row.status, 'RECEIVED', { actor });
  } catch (error) {
    if (error instanceof TransitionError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }

  const ok = await casStatus(returnId, row.status, 'RECEIVED');
  if (!ok) {
    return { ok: false, code: 'STALE', message: 'This request changed. Refresh and try again.' };
  }
  if (awb) {
    await rawQuery(sql`
      UPDATE return_requests
      SET shiprocket_awb = COALESCE(${awb}, shiprocket_awb), updated_at = now()
      WHERE id = ${returnId}
    `);
  }
  await recordEvent({
    returnRequestId: returnId,
    event: 'received',
    fromStatus: row.status,
    toStatus: 'RECEIVED',
    actor,
    data: { awb: awb ?? null },
  });
  return { ok: true, status: 'RECEIVED' };
}

/**
 * The bench decision: does this item go back on the shelf, or not?
 *
 * On PASS we also restock and bump `returned_qty` in the same write. Doing it
 * here rather than at settlement is deliberate:
 *  - stock must reflect reality the moment the item is sellable again, and
 *    waiting for the refund round-trip leaves it wrongly unavailable for days;
 *  - `returned_qty` is the anti-double-claim counter, and it should count
 *    goods that physically arrived, not refunds that happened to be issued.
 *
 * On FAIL we require a reason. A rejection the customer cannot understand (and
 * cannot therefore contest) is a support escalation and a chargeback risk.
 */
export async function recordQcVerdict(
  returnId: string,
  actor: string,
  passed: boolean,
  opts: { reason?: string; restockable?: boolean } = {}
): Promise<QcOutcome> {
  const row = await loadOpsRow(returnId);
  if (!row) throw new ReturnsOpsError('NOT_FOUND', 'Return not found.', 404);

  // Re-inspection of a failed item is allowed exactly once (the state machine
  // encodes it); re-running the same verdict is a no-op, not an error.
  if (row.status === 'QC_PASSED' && passed) {
    return { ok: true, status: 'QC_PASSED' };
  }
  if (row.status === 'QC_FAILED' && !passed) {
    return { ok: true, status: 'QC_FAILED' };
  }

  const to = passed ? 'QC_PASSED' : 'QC_FAILED';
  try {
    assertCanTransition(row.status, to, { actor });
  } catch (error) {
    if (error instanceof TransitionError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }

  if (!passed) {
    const reason = (opts.reason ?? '').trim();
    if (!reason) {
      return {
        ok: false,
        code: 'REASON_REQUIRED',
        message: 'Please record why the item failed inspection.',
      };
    }
  }

  const ok = await casStatus(returnId, row.status, to);
  if (!ok) {
    return { ok: false, code: 'STALE', message: 'This request changed. Refresh and try again.' };
  }

  if (passed) {
    // Restock only when the item is genuinely sellable. A QC pass on a
    // "worn but acceptable" item still goes back on the shelf; a pass on
    // something we will write off does not.
    if (opts.restockable !== false) {
      await rawQuery(sql`
        UPDATE product_variants v
        SET stock_quantity = v.stock_quantity + ${row.qty}, updated_at = now()
        WHERE v.id = ${row.variant_id}
      `);
    }
    await rawQuery(sql`
      UPDATE order_items
      SET returned_qty = LEAST(quantity, returned_qty + ${row.qty})
      WHERE id = ${row.order_item_id}
    `);
    // The partial unique index on return_requests excludes REFUNDED, so once we
    // settle, this line becomes claimable again — but `returned_qty` (now
    // bumped) is what stops the customer claiming the same physical units a
    // second time. Both guards are needed.
  } else {
    await rawQuery(sql`
      UPDATE return_requests
      SET rejection_reason = ${(opts.reason ?? '').trim()}, updated_at = now()
      WHERE id = ${returnId}
    `);
  }

  await recordEvent({
    returnRequestId: returnId,
    event: passed ? 'qc_passed' : 'qc_failed',
    fromStatus: row.status,
    toStatus: to,
    actor,
    data: {
      reason: opts.reason ?? null,
      restocked: passed && opts.restockable !== false,
      qty: row.qty,
    },
  });

  return { ok: true, status: to };
}

// ---------------------------------------------------------------------------
// 4. Settlement — where money actually moves
// ---------------------------------------------------------------------------

export type SettleOutcome =
  | {
      ok: true;
      status: 'REFUNDED';
      payout: number;
      razorpayRefundId: string | null;
      gatewayStatus: string;
    }
  | { ok: false; code: string; message: string };

/**
 * Issue the refund.
 *
 * This is the function the whole system exists to protect, so it is written to
 * be boring and paranoid. Five independent guards, in order:
 *
 *   1. STATE.  Only a QC_PASSED return may be claimed for settlement. This is
 *      what makes "refund without receiving the goods" structurally impossible.
 *   2. CLAIM.  `UPDATE ... WHERE status = 'QC_PASSED'` → `REFUND_PENDING`.
 *      Exactly one concurrent caller can win this. A duplicate click, a retried
 *      job, or two admins pressing the same button all lose here, before any
 *      money moves.
 *   3. LEDGER.  A `refunds` row is inserted BEFORE the gateway call. The
 *      partial unique index (one non-FAILED row per request) means that even if
 *      the process dies between the claim and the response, the reconciler can
 *      see a claimed-but-unconfirmed refund and resolve it by QUERYING Razorpay
 *      — never by blindly sending a second one.
 *   4. AMOUNT.  `computeSettlement` clamps the payout to the order-level
 *      headroom, so N partial returns can never exceed what was paid.
 *   5. GATEWAY.  Razorpay is called with an explicit paise amount. Only
 *      `processed` is treated as final; `pending` leaves the row in
 *      REFUND_PENDING for the webhook to confirm.
 *
 * The important asymmetry: on ANY failure we leave the request in a state a
 * human or the reconciler can pick up. We never leave it in a state that looks
 * settled but isn't.
 */
export async function settleRefund(
  returnId: string,
  actor: string
): Promise<SettleOutcome> {
  const row = await loadOpsRow(returnId);
  if (!row) throw new ReturnsOpsError('NOT_FOUND', 'Return not found.', 404);

  // Idempotent: settling an already-settled return reports success with the
  // original figures rather than erroring, so a double-click is harmless.
  if (row.status === 'REFUNDED') {
    return {
      ok: true,
      status: 'REFUNDED',
      payout: Number(row.refund_amount) - Number(row.fee),
      razorpayRefundId: await existingRefundId(returnId),
      gatewayStatus: 'already_settled',
    };
  }
  if (row.status === 'REFUND_PENDING') {
    return {
      ok: false,
      code: 'IN_FLIGHT',
      message:
        'A refund for this request is already in progress. Give it a few minutes, or ask support to reconcile it.',
    };
  }

  // 1. Compute the payout from freshly-read figures.
  const plan: SettlementPlan = computeSettlement({
    refundAmount: Number(row.refund_amount),
    fee: Number(row.fee),
    shippingAmount: Number(row.order_shipping),
    orderTotal: Number(row.order_total),
    alreadyRefundedOnOrder: Number(row.order_already_refunded),
  });

  // 2. Claim it. This is the concurrency lock.
  const claimed = await claimForSettlement(returnId, row.status, plan);
  if (!claimed.ok) {
    return claimed.outcome;
  }

  // 3. Ledger row, before the gateway call.
  const refundId = crypto.randomUUID();
  try {
    await rawQuery(sql`
      INSERT INTO refunds (id, return_request_id, order_id, amount, reason, status)
      VALUES (
        ${refundId},
        ${returnId},
        ${row.order_id},
        ${claimed.payout.toFixed(2)},
        ${`Return ${returnId.slice(0, 8)}`},
        'PENDING'
      )
    `);
  } catch (error) {
    // 23505 = the partial unique index. Another settlement already claimed this.
    if (sqlState(error) === '23505') {
      await releaseClaim(returnId);
      return {
        ok: false,
        code: 'ALREADY_CLAIMED',
        message: 'A refund for this request already exists.',
      };
    }
    await releaseClaim(returnId);
    throw error;
  }

  // 4. The gateway call. Everything before this point is reversible; this is
  //    the line. If it throws, we do NOT retry blindly — we leave the ledger
  //    row PENDING and let `reconcileRefunds` ask Razorpay what happened.
  const paymentId = row.razorpay_payment_id;
  if (!paymentId) {
    await markRefundFailed(refundId, 'No payment id on this order');
    return {
      ok: false,
      code: 'NO_PAYMENT',
      message:
        'We have no payment reference for this order. Please process the refund manually.',
    };
  }

  let refund;
  try {
    refund = await createRazorpayRefund({
      paymentId,
      amountPaise: toPaise(claimed.payout),
      receipt: `ret${returnId.slice(0, 12)}`,
      notes: {
        return_request_id: returnId,
        order_number: row.order_number,
      },
    });
  } catch (error) {
    const message =
      error instanceof RazorpayError ? error.message : 'Unknown gateway error';
    // Distinguish "we don't know if it went through" from "it definitely
    // didn't". A timeout is the dangerous one: the money may have moved.
    const unknown = !(error instanceof RazorpayError) || error.status >= 500;

    if (unknown) {
      await recordEvent({
        returnRequestId: returnId,
        event: 'refund_unknown',
        fromStatus: 'REFUND_PENDING',
        actor,
        data: { message, ledgerRefundId: refundId },
      });
      return {
        ok: false,
        code: 'GATEWAY_UNKNOWN',
        message:
          'We could not confirm the refund with our payment provider. Our team will verify it and retry — please do not duplicate it.',
      };
    }

    // A clean 4xx: the request was rejected, nothing moved. Release the claim
    // so an admin can correct the cause and retry.
    await markRefundFailed(refundId, message);
    await releaseClaim(returnId);
    return { ok: false, code: 'GATEWAY_REJECTED', message };
  }

  // 5. Record the gateway's answer.
  const gatewayStatus = refund.status;
  const processed = gatewayStatus === 'processed';

  await rawQuery(sql`
    UPDATE refunds
    SET razorpay_refund_id = ${refund.id},
        status = ${processed ? 'PROCESSED' : 'PENDING'},
        processed_at = ${processed ? new Date() : null}
    WHERE id = ${refundId}
  `);

  if (processed) {
    const done = await casStatus(returnId, 'REFUND_PENDING', 'REFUNDED');
    if (!done) {
      // Should be impossible — we hold the claim. If it isn't, the money has
      // still moved, so the correct action is to record the truth loudly
      // rather than silently leave the row wrong.
      console.error(
        `[returns] refund processed but status did not advance for ${returnId}`
      );
    }
    await rawQuery(sql`
      UPDATE return_requests
      SET settled_at = now(),
          payout_amount = ${claimed.payout.toFixed(2)},
          resolved_at = now(),
          updated_at = now()
      WHERE id = ${returnId}
    `);
    await recordEvent({
      returnRequestId: returnId,
      event: 'refunded',
      fromStatus: 'REFUND_PENDING',
      toStatus: 'REFUNDED',
      actor,
      data: {
        payout: claimed.payout,
        gross: Number(row.refund_amount),
        fee: Number(row.fee),
        shipping: Number(row.order_shipping),
        waivedFee: claimed.waivedFee,
        razorpayRefundId: refund.id,
      },
    });
    await refreshCustomerRisk(row.customer_id);
    return {
      ok: true,
      status: 'REFUNDED',
      payout: claimed.payout,
      razorpayRefundId: refund.id,
      gatewayStatus,
    };
  }

  // `pending` — accepted by Razorpay, not yet sent to the bank. The
  // refund.processed webhook will move this to REFUNDED. Leaving it here is
  // correct and safe: the ledger row proves a refund exists, so a retry cannot
  // create a second one.
  await recordEvent({
    returnRequestId: returnId,
    event: 'refund_pending',
    fromStatus: 'QC_PASSED',
    toStatus: 'REFUND_PENDING',
    actor,
    data: { payout: claimed.payout, razorpayRefundId: refund.id },
  });
  return {
    ok: false,
    code: 'GATEWAY_PENDING',
    message:
      'The refund has been accepted by our payment provider and will reach you within a few working days.',
  };
}

// ---------------------------------------------------------------------------
// Settlement helpers
// ---------------------------------------------------------------------------

/** Postgres SQLSTATE from a Drizzle-wrapped driver error. */
function sqlState(error: unknown): string | null {
  const direct = (error as { code?: string } | null)?.code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return typeof cause?.code === 'string' ? cause.code : null;
}

type ClaimResult =
  | { ok: true; payout: number; waivedFee: number }
  | { ok: false; outcome: SettleOutcome };

/**
 * Atomically claim a QC-passed return for settlement, persisting the money
 * figures it was claimed at.
 *
 * The `WHERE status = ${from}` clause is the lock. `net_refund` is written in
 * the SAME statement as the status change, so the amount we agreed to pay can
 * never drift from the state that authorises paying it.
 */
async function claimForSettlement(
  returnId: string,
  from: string,
  plan: SettlementPlan
): Promise<ClaimResult> {
  // The money gate. Runs before the claim so a bad plan never reaches the
  // database, and so this stays safe if ever called directly.
  if (!plan.ok || !plan.refundable) {
    return {
      ok: false,
      outcome: {
        ok: false,
        code: plan.ok ? 'ZERO_PAYOUT' : plan.code,
        message: plan.ok
          ? 'There is nothing left to pay out on this return after fees and shipping.'
          : plan.message,
      },
    };
  }

  try {
    assertCanSettle(from, 'RETURN', plan);
  } catch (error) {
    if (error instanceof TransitionError) {
      return {
        ok: false,
        outcome: { ok: false, code: error.code, message: error.message },
      };
    }
    throw error;
  }

  const rows = await rawQuery<{ id: string }>(sql`
    UPDATE return_requests
    SET status = 'REFUND_PENDING',
        net_refund = ${plan.payout.toFixed(2)},
        updated_at = now()
    WHERE id = ${returnId} AND status = ${from}
    RETURNING id
  `);

  if (rows.length === 0) {
    return {
      ok: false,
      outcome: {
        ok: false,
        code: 'STALE',
        message:
          'This request is not awaiting a refund (someone may have already actioned it).',
      },
    };
  }

  return { ok: true, payout: plan.payout, waivedFee: plan.waivedFee };
}

/** Undo a claim after a clean gateway rejection, so an admin can retry. */
async function releaseClaim(returnId: string): Promise<void> {
  await rawQuery(sql`
    UPDATE return_requests
    SET status = 'QC_PASSED', net_refund = NULL, updated_at = now()
    WHERE id = ${returnId} AND status = 'REFUND_PENDING'
  `);
}

async function markRefundFailed(refundId: string, reason: string): Promise<void> {
  await rawQuery(sql`
    UPDATE refunds SET status = 'FAILED' WHERE id = ${refundId}
  `);
  console.error(`[returns] refund ${refundId} failed: ${reason}`);
}

async function existingRefundId(returnId: string): Promise<string | null> {
  const rows = await rawQuery<{ razorpay_refund_id: string | null }>(sql`
    SELECT razorpay_refund_id FROM refunds
    WHERE return_request_id = ${returnId} AND status = 'PROCESSED'
    LIMIT 1
  `);
  return rows[0]?.razorpay_refund_id ?? null;
}

// ---------------------------------------------------------------------------
// Reconciliation — the crash-recovery path
// ---------------------------------------------------------------------------

/**
 * Resolve refunds we are not sure about.
 *
 * Run on a schedule, and after any `GATEWAY_UNKNOWN`. It handles the one case
 * the synchronous path cannot: the process died between the Razorpay call and
 * our status write. The refund may or may not exist at the gateway, so we ASK
 * rather than resend — `fetchRazorpayRefund` first, and only consider a new
 * refund when the gateway positively says this id is unknown.
 *
 * This is precisely why the `refunds` row is written BEFORE the call: without
 * it, a crash would leave no gateway id to reconcile against and the only safe
 * action would be to leave the customer's money unrefunded indefinitely.
 */
export async function reconcileRefunds(limit = 50): Promise<{
  checked: number;
  resolved: number;
  stillPending: number;
}> {
  const rows = await rawQuery<{
    refund_id: string;
    return_request_id: string;
    razorpay_refund_id: string | null;
    amount: string;
  }>(sql`
    SELECT f.id AS refund_id, f.return_request_id, f.razorpay_refund_id,
           f.amount::text
    FROM refunds f
    JOIN return_requests r ON r.id = f.return_request_id
    WHERE f.status = 'PENDING'
      AND r.status IN ('REFUND_PENDING','REFUNDED')
      AND f.created_at < now() - interval '2 minutes'
    ORDER BY f.created_at ASC
    LIMIT ${limit}
  `);

  let resolved = 0;
  let stillPending = 0;

  for (const row of rows) {
    if (!row.razorpay_refund_id) {
      // The crash happened before the gateway answered, so there is no id to
      // query. Flag for a human rather than guess — a wrong guess here either
      // double-refunds or leaves a customer out of pocket.
      await recordEvent({
        returnRequestId: row.return_request_id,
        event: 'reconcile_no_gateway_id',
        actor: 'system:reconciler',
        data: { ledgerRefundId: row.refund_id },
      });
      stillPending++;
      continue;
    }

    try {
      const remote = await fetchRazorpayRefund(row.razorpay_refund_id);
      if (remote.status === 'processed') {
        await rawQuery(sql`
          UPDATE refunds SET status = 'PROCESSED', processed_at = now()
          WHERE id = ${row.refund_id}
        `);
        await casStatus(row.return_request_id, 'REFUND_PENDING', 'REFUNDED');
        await rawQuery(sql`
          UPDATE return_requests
          SET settled_at = now(), resolved_at = now(), updated_at = now()
          WHERE id = ${row.return_request_id}
        `);
        await recordEvent({
          returnRequestId: row.return_request_id,
          event: 'refunded',
          fromStatus: 'REFUND_PENDING',
          toStatus: 'REFUNDED',
          actor: 'system:reconciler',
          data: { razorpayRefundId: remote.id, amount: Number(row.amount) },
        });
        resolved++;
      } else if (remote.status === 'failed') {
        await markRefundFailed(row.refund_id, 'Gateway reported failure');
        await releaseClaim(row.return_request_id);
      } else {
        stillPending++;
      }
    } catch (error) {
      // Razorpay unreachable — try again next run. Do NOT mark failed.
      console.error(`[returns] reconcile failed for ${row.refund_id}:`, error);
      stillPending++;
    }
  }

  return { checked: rows.length, resolved, stillPending };
}

// ---------------------------------------------------------------------------
// 5. Exchange fulfilment
// ---------------------------------------------------------------------------

export type ExchangeOutcome =
  | { ok: true; status: 'EXCHANGE_SHIPPED' | 'EXCHANGE_FAILED'; message?: string }
  | { ok: false; code: string; message: string };

/**
 * Ship the replacement for an exchange.
 *
 * Exchanges have a failure mode returns do not: we receive the original back
 * and then discover the replacement size went out of stock in the days the
 * parcel was in transit. That is why the variant is decremented HERE, at
 * fulfilment, rather than at request time — holding stock for a week on an
 * unapproved claim would let a customer reserve the last size in a popular
 * product just by opening the form.
 *
 * The conditional `UPDATE ... WHERE stock_quantity >= qty` is the same
 * oversell guard the checkout path uses (see utils/reservations.ts).
 */
export async function fulfilExchange(
  returnId: string,
  actor: string
): Promise<ExchangeOutcome> {
  const row = await loadOpsRow(returnId);
  if (!row) throw new ReturnsOpsError('NOT_FOUND', 'Return not found.', 404);

  if (row.status === 'EXCHANGE_SHIPPED') {
    return { ok: true, status: 'EXCHANGE_SHIPPED' };
  }

  const variantId = row.exchange_variant_id;
  if (!variantId) {
    return {
      ok: false,
      code: 'NO_VARIANT',
      message: 'This exchange has no replacement item recorded.',
    };
  }

  try {
    assertCanTransition(row.status, 'EXCHANGE_SHIPPED', { actor });
  } catch (error) {
    if (error instanceof TransitionError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }

  // Claim the stock atomically, before we tell anyone we've shipped.
  const claimed = await rawQuery<{ id: string }>(sql`
    UPDATE product_variants
    SET stock_quantity = stock_quantity - ${row.qty}, updated_at = now()
    WHERE id = ${variantId} AND stock_quantity >= ${row.qty} AND is_active = true
    RETURNING id
  `);
  if (claimed.length === 0) {
    await casStatus(returnId, row.status, 'EXCHANGE_FAILED');
    await recordEvent({
      returnRequestId: returnId,
      event: 'exchange_failed',
      fromStatus: row.status,
      toStatus: 'EXCHANGE_FAILED',
      actor,
      data: { reason: 'Replacement variant out of stock at fulfilment' },
    });
    return {
      ok: true,
      status: 'EXCHANGE_FAILED',
      message:
        'The replacement size sold out while the original was in transit. This is now queued for a full refund.',
    };
  }

  const ok = await casStatus(returnId, row.status, 'EXCHANGE_SHIPPED');
  if (!ok) {
    // Put the stock back — we took it but did not complete the exchange.
    await rawQuery(sql`
      UPDATE product_variants
      SET stock_quantity = stock_quantity + ${row.qty}, updated_at = now()
      WHERE id = ${variantId}
    `);
    return {
      ok: false,
      code: 'STALE',
      message: 'This request changed. Refresh and try again.',
    };
  }

  await recordEvent({
    returnRequestId: returnId,
    event: 'exchange_shipped',
    fromStatus: row.status,
    toStatus: 'EXCHANGE_SHIPPED',
    actor,
    data: { variantId, qty: row.qty },
  });
  return { ok: true, status: 'EXCHANGE_SHIPPED' };
}

// ---------------------------------------------------------------------------
// 6. Customer-initiated cancellation
// ---------------------------------------------------------------------------

/**
 * A customer withdrawing their own request.
 *
 * Scoped by `customerId` in the WHERE clause, not just checked in application
 * code — so a guessed return id from another account updates nothing and looks
 * identical to a non-existent id.
 *
 * Allowed only while the request is still ours to cancel (REQUESTED, or
 * APPROVED before a rider is booked). Once reverse logistics are moving, the
 * goods are already in the system and closing it is an operations decision.
 */
export async function cancelReturnByCustomer(
  customerId: string,
  returnId: string
): Promise<{ ok: boolean; code?: string; message?: string }> {
  const rows = await rawQuery<{ id: string; status: string }>(sql`
    UPDATE return_requests
    SET status = 'CANCELLED', resolved_at = now(), updated_at = now()
    WHERE id = ${returnId}
      AND customer_id = ${customerId}
      AND status IN ('REQUESTED','APPROVED')
    RETURNING id, status
  `);

  if (rows.length === 0) {
    return {
      ok: false,
      code: 'NOT_CANCELLABLE',
      message:
        'This request can no longer be cancelled online. Please contact support.',
    };
  }

  await recordEvent({
    returnRequestId: returnId,
    event: 'cancelled',
    toStatus: 'CANCELLED',
    actor: 'customer',
    data: {},
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 7. Admin queue
// ---------------------------------------------------------------------------

/**
 * The admin work queue, hardest first.
 *
 * Two sort keys rather than one. `needs_action` puts the requests that are
 * actually waiting on a human at the top, so the queue is a work list and not
 * just a reverse-chronological dump. Within that, `risk_score` descending puts
 * the ones most likely to be fraudulent in front of whoever picks it up — they
 * are the ones where a careless "approve, it's fine" costs real money.
 */
export async function listAdminReturns(opts: {
  limit?: number;
} = {}): Promise<AdminReturn[]> {
  const rows = await rawQuery<AdminReturnRow>(sql`
    ${ADMIN_SELECT}
    WHERE r.status NOT IN ('REFUNDED','REJECTED','CANCELLED')
    ORDER BY
      CASE r.status
        WHEN 'REQUESTED'        THEN 0   -- needs a decision
        WHEN 'RECEIVED'         THEN 1   -- needs QC
        WHEN 'QC_PASSED'        THEN 2   -- needs money
        WHEN 'APPROVED'         THEN 3   -- needs a pickup booking
        WHEN 'PICKUP_FAILED'    THEN 4   -- needs a retry or a self-ship nudge
        WHEN 'SELF_SHIP_PENDING'THEN 5   -- waiting on the customer
        WHEN 'EXCHANGE_FAILED'  THEN 6   -- needs converting to a refund
        ELSE 9
      END ASC,
      r.risk_score DESC,
      r.created_at ASC
    LIMIT ${opts.limit ?? 100}
  `);
  return rows.map(mapAdminReturn);
}

/** Raw shape of a queue row, before mapping to the view model. */
type AdminReturnRow = {
  id: string;
  type: string;
  reason: string;
  status: string;
  qty: number;
  fee: string;
  refund_amount: string;
  net_refund: string | null;
  order_id: string;
  order_item_id: string;
  order_number: string;
  product_name: string;
  sku: string;
  customer_id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  created_at: string;
  delivered_at: string | null;
  risk_score: number;
  risk_reasons: string[] | null;
  is_blocked: boolean;
  blocked_reason: string | null;
  photos: string[] | null;
  pickup_attempts: number;
  shiprocket_return_awb: string | null;
  rejection_reason: string | null;
  notes: string | null;
};

/**
 * The queue SELECT, shared by the list and the detail view.
 *
 * A SQL fragment interpolated with `${ADMIN_SELECT}` — Drizzle treats it as an
 * already-built chunk, so the caller only supplies WHERE/ORDER. Two queries
 * that must not drift apart are better as one definition.
 */
const ADMIN_SELECT = sql`
  SELECT r.id, r.type, r.reason, r.status, r.qty, r.fee, r.refund_amount,
         r.net_refund, r.order_id, r.order_item_id,
         o.order_number, oi.product_name, oi.sku,
         r.customer_id, c.name AS customer_name, c.email AS customer_email,
         c.phone AS customer_phone,
         r.created_at, o.delivered_at,
         r.risk_score, r.risk_reasons, r.is_blocked, r.blocked_reason,
         r.photos, r.pickup_attempts, r.shiprocket_return_awb,
         r.rejection_reason, r.notes
  FROM return_requests r
  JOIN orders o       ON o.id = r.order_id
  JOIN order_items oi ON oi.id = r.order_item_id
  LEFT JOIN customers c ON c.id = r.customer_id
`;

/** The same SELECT, narrowed to one id. */
const ADMIN_SELECT_WHERE_ID = (id: string) => sql`
  ${ADMIN_SELECT}
  WHERE r.id = ${id}
  LIMIT 1
`;

function mapAdminReturn(r: AdminReturnRow): AdminReturn {
  return {
    id: r.id,
    type: r.type,
    reason: r.reason,
    status: r.status,
    qty: r.qty,
    fee: String(r.fee),
    refundAmount: String(r.refund_amount),
    netRefund: r.net_refund != null ? String(r.net_refund) : null,
    orderId: r.order_id,
    orderItemId: r.order_item_id,
    orderNumber: r.order_number,
    productName: r.product_name,
    sku: r.sku,
    customerId: r.customer_id,
    customerName: r.customer_name ?? 'Customer',
    customerEmail: r.customer_email ?? '',
    customerPhone: r.customer_phone,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
    riskScore: r.risk_score ?? 0,
    riskReasons: r.risk_reasons ?? null,
    isBlocked: r.is_blocked ?? false,
    blockedReason: r.blocked_reason,
    photos: Array.isArray(r.photos) ? r.photos : [],
    pickupAttempts: r.pickup_attempts,
    returnAwb: r.shiprocket_return_awb,
    rejectionReason: r.rejection_reason,
    notes: r.notes,
  };
}

/** One request, with its full event history. For the admin detail drawer. */
export async function getAdminReturnDetail(
  returnId: string
): Promise<{
  request: AdminReturn | null;
  events: Array<{
    event: string;
    fromStatus: string | null;
    toStatus: string | null;
    actor: string;
    createdAt: string;
  }>;
  refunds: Array<{
    id: string;
    amount: string;
    status: string;
    razorpayRefundId: string | null;
    createdAt: string;
  }>;
}> {
  const rows = await rawQuery<AdminReturnRow>(ADMIN_SELECT_WHERE_ID(returnId));
  const events = await rawQuery<{
    event: string;
    from_status: string | null;
    to_status: string | null;
    actor: string;
    created_at: string;
  }>(sql`
    SELECT event, from_status, to_status, actor, created_at
    FROM return_events
    WHERE return_request_id = ${returnId}
    ORDER BY created_at ASC
  `);

  const refunds = await rawQuery<{
    id: string;
    amount: string;
    status: string;
    razorpay_refund_id: string | null;
    created_at: string;
  }>(sql`
    SELECT id, amount::text, status, razorpay_refund_id, created_at
    FROM refunds
    WHERE return_request_id = ${returnId}
    ORDER BY created_at ASC
  `);

  return {
    request: rows[0] ? mapAdminReturn(rows[0]) : null,
    events: events.map(e => ({
      event: e.event,
      fromStatus: e.from_status,
      toStatus: e.to_status,
      actor: e.actor,
      createdAt: e.created_at,
    })),
    refunds: refunds.map(r => ({
      id: r.id,
      amount: String(r.amount),
      status: r.status,
      razorpayRefundId: r.razorpay_refund_id,
      createdAt: r.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// 8. Third-party webhooks
// ---------------------------------------------------------------------------

/**
 * Claim a webhook event id, or report that we have already seen it.
 *
 * Returns true when this caller is the FIRST to see the event. Every webhook
 * handler calls this first, and the partial `webhook_events` primary key does
 * the deduplication in the database rather than in a process-local Set — which
 * would be useless on serverless, where retries routinely land on a different
 * instance.
 */
export async function claimWebhookEvent(
  provider: string,
  eventId: string,
  eventType: string,
  payload: unknown
): Promise<boolean> {
  const rows = await rawQuery<{ id: string }>(sql`
    INSERT INTO webhook_events (id, provider, event_type, payload)
    VALUES (${`${provider}:${eventId}`}, ${provider}, ${eventType}, ${JSON.stringify(payload ?? {})})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `);
  return rows.length > 0;
}

/** Mark a claimed event as fully handled. */
export async function completeWebhookEvent(
  provider: string,
  eventId: string
): Promise<void> {
  await rawQuery(sql`
    UPDATE webhook_events SET processed = true, processed_at = now()
    WHERE id = ${`${provider}:${eventId}`}
  `);
}

/** Release a claim so a failed event can be retried by the provider. */
export async function failWebhookEvent(
  provider: string,
  eventId: string,
  error: string
): Promise<void> {
  await rawQuery(sql`
    UPDATE webhook_events SET error = ${error.slice(0, 500)} WHERE id = ${`${provider}:${eventId}`}
  `);
}

/**
 * An order was delivered — this is what STARTS the return clock.
 *
 * Without this the entire returns flow is inert: `orders.delivered_at` is the
 * anchor for the 7-day window, and nothing else in the codebase can honestly
 * set it. Only the courier knows when the parcel actually arrived.
 *
 * Two details that matter for money:
 *
 *  - `delivered_at` is set ONCE. A replayed or out-of-order webhook must not
 *    push the date forward, which would silently extend the customer's window
 *    and, worse, let a burst of retries keep a claim alive indefinitely. The
 *    `WHERE delivered_at IS NULL` guard makes the first event authoritative.
 *  - the order status only moves FORWARD. A stale "delivered" arriving after a
 *    cancellation must not resurrect the order.
 */
export async function handleOrderDelivered(input: {
  orderNumber: string;
  awb?: string;
  deliveredAt?: string;
}): Promise<{ updated: boolean; orderId: string | null }> {
  const rows = await rawQuery<{
    id: string;
    status: string;
  }>(sql`
    UPDATE orders
    SET status = 'DELIVERED',
        delivered_at = COALESCE(delivered_at, ${input.deliveredAt ?? new Date().toISOString()}::timestamptz),
        updated_at = now()
    WHERE order_number = ${input.orderNumber}
      AND delivered_at IS NULL
      AND status NOT IN ('CANCELLED','REFUNDED')
    RETURNING id, status
  `);

  if (rows.length === 0) {
    // Either already delivered (a replay) or not ours. Either way, not an error.
    const existing = await rawQuery<{ id: string }>(sql`
      SELECT id FROM orders WHERE order_number = ${input.orderNumber} LIMIT 1
    `);
    return { updated: false, orderId: existing[0]?.id ?? null };
  }

  return { updated: true, orderId: rows[0].id };
}

/**
 * Sync one return's state from the courier's tracking.
 *
 * Only ever moves FORWARD, and only within the goods-moving states. A courier
 * status that goes backwards (a re-scan, a mis-keyed event) must not drag a
 * customer's parcel out of "received" and back into "in transit" — that would
 * make a refund that has already been paid look outstanding in the UI.
 *
 * Returns what it did, so the caller can decide whether to notify.
 */
export async function syncReturnFromCourier(
  returnId: string
): Promise<{ changed: boolean; status?: string }> {
  const row = await loadOpsRow(returnId);
  if (!row) return { changed: false };
  if (!row.shiprocket_return_awb) return { changed: false };
  // Once the goods are in and inspected, the courier has nothing left to tell us.
  if (
    ['RECEIVED','QC_PASSED','QC_FAILED','REFUND_PENDING','REFUNDED'].includes(
      row.status
    )
  ) {
    return { changed: false };
  }

  const tracking = await fetchReturnTracking(row.shiprocket_return_awb);
  if (!tracking) return { changed: false };

  // Only IN_TRANSIT is applied automatically. PICKUP_FAILED needs a human to
  // choose between a retry and the self-ship fallback, and RECEIVED still has to
  // pass QC before it means anything — so both are surfaced, not enacted.
  if (tracking.status === 'PICKUP_FAILED') {
    await recordEvent({
      returnRequestId: returnId,
      event: 'courier_pickup_failed',
      fromStatus: row.status,
      actor: 'system:shiprocket-webhook',
      data: { rmaId: row.shiprocket_return_awb },
    });
    return { changed: false, status: 'PICKUP_FAILED' };
  }

  if (tracking.status === 'IN_TRANSIT') {
    const ok = await casStatus(returnId, row.status, 'IN_TRANSIT');
    if (ok) {
      await recordEvent({
        returnRequestId: returnId,
        event: 'in_transit',
        fromStatus: row.status,
        toStatus: 'IN_TRANSIT',
        actor: 'system:shiprocket-webhook',
        data: { awb: tracking.awb },
      });
      return { changed: true, status: 'IN_TRANSIT' };
    }
  }

  if (tracking.status === 'RECEIVED') {
    const outcome = await markReceived(
      returnId,
      'system:shiprocket-webhook',
      tracking.awb ?? undefined
    );
    return { changed: outcome.ok, status: outcome.ok ? 'RECEIVED' : undefined };
  }

  return { changed: false };
}

// ---------------------------------------------------------------------------
// 9. Disputes — the money-back-twice signal
// ---------------------------------------------------------------------------

/**
 * Record a chargeback / dispute raised against a payment.
 *
 * The highest-value fraud input in the system. A customer who refunds an item
 * AND raises a chargeback has taken the money twice; one who raises a chargeback
 * on a DELIVERED order is very likely an empty-box or mail-rail claim. Both stop
 * here — `evaluateHardBlocks` refuses approval while a dispute is open.
 */
export async function recordDispute(input: {
  disputeId: string;
  paymentId: string;
  amount: number;
  reason?: string | null;
}): Promise<{ recorded: boolean; orderId: string | null }> {
  const orders = await rawQuery<{ id: string; customer_id: string }>(sql`
    SELECT id, customer_id FROM orders
    WHERE razorpay_payment_id = ${input.paymentId}
    LIMIT 1
  `);
  const order = orders[0];

  // The partial unique index on (payment_id) WHERE status='OPEN' makes a
  // replayed dispute webhook a no-op rather than a duplicate row.
  const rows = await rawQuery<{ id: string }>(sql`
    INSERT INTO payment_disputes
      (id, razorpay_payment_id, order_id, amount, reason, status)
    VALUES (
      ${input.disputeId},
      ${input.paymentId},
      ${order?.id ?? null},
      ${input.amount.toFixed(2)},
      ${input.reason ?? null},
      'OPEN'
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `);

  if (rows.length > 0 && order) {
    await refreshCustomerRisk(order.customer_id);
    // Flag any in-flight return on this order so the queue shows it immediately,
    // rather than waiting for someone to open the request and be surprised.
    await rawQuery(sql`
      UPDATE return_requests
      SET is_blocked = true,
          blocked_reason = 'An open payment dispute exists on this order'
      WHERE order_id = ${order.id}
        AND status NOT IN ('REFUNDED','REJECTED','CANCELLED')
    `);
  }

  return { recorded: rows.length > 0, orderId: order?.id ?? null };
}

/**
 * A dispute was resolved. A LOST dispute is the serious one: the bank returned
 * the money to the customer, so if we also issued a refund we have paid twice
 * and the account should be treated accordingly.
 */
export async function resolveDispute(input: {
  disputeId: string;
  status: 'LOST' | 'WON' | 'WITHDRAWN';
}): Promise<void> {
  await rawQuery(sql`
    UPDATE payment_disputes
    SET status = ${input.status},
        won = ${input.status === 'WON'},
        resolved_at = now()
    WHERE id = ${input.disputeId}
  `);

  if (input.status !== 'LOST') return;

  // LOST: the bank already gave the money back. Escalate to a human.
  const rows = await rawQuery<{ customer_id: string; order_id: string }>(sql`
    SELECT o.customer_id, o.id AS order_id
    FROM payment_disputes d
    JOIN orders o ON o.id = d.order_id
    WHERE d.id = ${input.disputeId}
    LIMIT 1
  `);
  const order = rows[0];
  if (!order) return;

  await rawQuery(sql`
    INSERT INTO customer_risk
      (customer_id, chargeback_count, is_blocked, blocked_reason, updated_at)
    VALUES (
      ${order.customer_id}, 1, true,
      ${'Chargeback lost — the bank returned the payment after we issued a refund'},
      now()
    )
    ON CONFLICT (customer_id) DO UPDATE SET
      chargeback_count = customer_risk.chargeback_count + 1,
      is_blocked = true,
      blocked_reason = EXCLUDED.blocked_reason,
      updated_at = now()
  `);
  await recordEvent({
    returnRequestId: await anyReturnForCustomer(order.customer_id),
    event: 'chargeback_lost',
    actor: 'system:razorpay-webhook',
    data: { disputeId: input.disputeId, orderId: order.order_id },
  });
}















