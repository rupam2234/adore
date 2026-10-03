/**
 * Return/exchange persistence.
 *
 * Deliberately SEPARATE from utils/returns.ts, which stays pure and dependency
 * free so it can be unit tested without a database. This file is the only place
 * that talks to Postgres about returns.
 *
 * The rule that matters everywhere below: the client never decides what is
 * allowed. `checkReturnEligibility` is re-run here against the database's own
 * copy of the order and item, and every read is scoped by `customerId`.
 */
import { rawQuery, sql } from '@/utils/db';
import {
  checkReturnEligibility,
  RETURN_REASONS,
  type ReturnReason,
  type ReturnType,
} from './returns';
import {
  customerFacingBlockMessage,
  evaluateHardBlocks,
  scoreReturnRisk,
  type BlockVerdict,
  type RiskSignals,
} from './returns-fraud';
// The audit writer only, not the operations layer: importing returns-ops here
// would pull the Razorpay and Shiprocket adapters into the customer submit path.
import { recordEvent } from './returns-audit';

export class ReturnRequestError extends Error {
  /** Stable code for the client; `message` is safe to show to a customer. */
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Reasons that cannot be verified without photographs. */
const PHOTO_REQUIRED: readonly string[] = [
  'Damaged on arrival',
  'Wrong item delivered',
];

export type CreateReturnInput = {
  orderId: string;
  orderItemId: string;
  type: ReturnType;
  reason: string;
  qty: number;
  exchangeVariantId?: string | null;
  /** Cloudinary URLs of uploaded evidence (not raw data). */
  photos?: string[];
};

/**
 * The single intake row: order + item state for eligibility, plus the
 * customer's abuse signals. See the SELECT in `createReturnRequest`.
 */
type IntakeRow = {
  order_id: string;
  customer_id: string;
  status: string;
  delivered_at: string | null;
  order_total: string;
  order_item_id: string;
  quantity: number;
  returned_qty: number;
  unit_price: string;
  variant_id: string;
  exchanges_used: number;
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
};

/**
 * Only our own Cloudinary delivery URLs are accepted as evidence.
 *
 * The client sends URLs, so without this a caller could point `photos` at
 * anything — an external tracking pixel, a page on our own site, or a huge
 * string. Pinning the host and shape here means the column only ever holds
 * short, same-CDN strings we can actually fetch and show to an admin.
 */
const MAX_PHOTOS = 5;

function sanitisePhotos(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((url): url is string => typeof url === 'string')
    .slice(0, MAX_PHOTOS)
    .filter(url => {
      try {
        const parsed = new URL(url);
        return (
          parsed.protocol === 'https:' &&
          parsed.hostname === 'res.cloudinary.com' &&
          parsed.pathname.length < 500
        );
      } catch {
        return false;
      }
    });
}

/**
 * Build scoring signals from the row the intake query already read.
 *
 * Every field here comes from the single intake SELECT (extended with the risk
 * columns below) or is arithmetic on it. No extra round-trips: the customer's
 * history is already summarised in `customer_risk`, which is maintained by
 * `refreshCustomerRisk` on every settlement, so reading it here is a lookup on
 * an already-materialised row rather than an aggregate over the return table.
 */
function buildIntakeRiskSignals(
  row: IntakeRow,
  qty: number,
  now: Date
): RiskSignals {
  const unitPrice = Number(row.unit_price) || 0;
  const orderValue = Number(row.order_total) || 0;

  // Hours since delivery. Null when we genuinely do not know (a legacy order
  // with no delivered_at) — the scorer treats null as "no signal" rather than
  // guessing, because inventing a delivery date would manufacture suspicion.
  let hoursSinceDelivery: number | null = null;
  if (row.delivered_at) {
    const d = new Date(row.delivered_at);
    if (!Number.isNaN(d.getTime())) {
      hoursSinceDelivery = Math.max(0, (now.getTime() - d.getTime()) / 3_600_000);
    }
  }

  return {
    lifetimeRefunded: Number(row.lifetime_refunded) || 0,
    lifetimeReturns: row.lifetime_returns ?? 0,
    recentReturns: row.recent_returns ?? 0,
    recentValue: Number(row.recent_value) || 0,
    requestValue: unitPrice * qty,
    orderValue,
    hoursSinceDelivery,
    itemsReturnedFromOrder: 1,
    itemsOnOrder: 1,
    priorRejections: row.prior_rejections ?? 0,
    priorQcFailures: row.prior_qc_failures ?? 0,
    hasOpenDispute: row.open_dispute ?? false,
    chargebackCount: row.chargeback_count ?? 0,
    accountBlocked: row.account_blocked ?? false,
  };
}

/**
 * Screen a customer before we accept a request from them.
 *
 * Runs on EVERY submission, not just suspicious ones, because the signals are
 * free once the intake row is read — `customer_risk` is a materialised summary
 * maintained on every settlement, so this is a lookup rather than an aggregate.
 *
 * `orderValue` is passed in by the caller because the intake query has already
 * read the order; re-reading it would cost a second round-trip for no new
 * information.
 */
function screenCustomer(
  row: IntakeRow,
  orderValue: number
): { blocked: boolean; code: string | null } {
  const block: BlockVerdict = evaluateHardBlocks({
    hasOpenDispute: row.open_dispute ?? false,
    accountBlocked: row.account_blocked ?? false,
    accountBlockedReason: row.account_blocked_reason,
    chargebackCount: row.chargeback_count ?? 0,
    // Not inferred from the reason text. Proving an empty-box claim needs the
    // courier's delivery scan AND the customer's non-receipt claim to disagree,
    // which is adjudicated at review, not at intake.
    emptyBoxClaim: false,
    confirmedFraud: false,
    recentValueRatio:
      orderValue > 0 ? (Number(row.recent_value) || 0) / orderValue : 0,
    recentReturns: row.recent_returns ?? 0,
  });
  return { blocked: block.blocked, code: block.code };
}

/**
 * Create a return/exchange request.
 *
 * `customerId` is mandatory and every read is scoped by it, so a caller cannot
 * pass somebody else's order. Eligibility is re-checked HERE, on the server.
 */
export async function createReturnRequest(
  customerId: string,
  input: CreateReturnInput
) {
  if (!RETURN_REASONS.includes(input.reason as ReturnReason)) {
    throw new ReturnRequestError(
      'UNKNOWN_REASON',
      'Please choose one of the listed return reasons.'
    );
  }

  // ONE scoped query for everything intake needs: the order and item state for
  // eligibility, plus the customer's abuse signals. At ~124ms per Neon
  // round-trip, serialising three queries would add ~250ms to every submit —
  // and this is a customer-facing write, so latency is felt directly.
  //
  // Every field is either on the order/item, on the materialised `customer_risk`
  // summary, or a correlated EXISTS — all bounded by an index on customer_id.
  const rows = await rawQuery<IntakeRow>(sql`
    SELECT
      o.id            AS order_id,
      o.customer_id   AS customer_id,
      o.status        AS status,
      o.delivered_at  AS delivered_at,
      o.total_amount::text AS order_total,
      oi.id           AS order_item_id,
      oi.quantity     AS quantity,
      oi.returned_qty AS returned_qty,
      oi.unit_price::text AS unit_price,
      oi.variant_id   AS variant_id,
      (
        SELECT COUNT(*)::int FROM return_requests r
        WHERE r.order_id = o.id
          AND r.type = 'EXCHANGE'
          AND r.status NOT IN ('REJECTED','CANCELLED')
      ) AS exchanges_used,
      COALESCE(cr.is_blocked, false)     AS account_blocked,
      cr.blocked_reason                  AS account_blocked_reason,
      COALESCE(cr.chargeback_count, 0)   AS chargeback_count,
      COALESCE(cr.total_returns, 0)      AS lifetime_returns,
      COALESCE(cr.total_refunded, 0)::text   AS lifetime_refunded,
      COALESCE(cr.recent_returns, 0)     AS recent_returns,
      COALESCE(cr.recent_value, 0)::text     AS recent_value,
      (SELECT COUNT(*)::int FROM return_requests r3
        WHERE r3.customer_id = ${customerId} AND r3.status = 'REJECTED'
      ) AS prior_rejections,
      (SELECT COUNT(*)::int FROM return_requests r4
        WHERE r4.customer_id = ${customerId} AND r4.status = 'QC_FAILED'
      ) AS prior_qc_failures,
      EXISTS (
        SELECT 1 FROM payment_disputes d
        JOIN orders o2 ON o2.razorpay_payment_id = d.razorpay_payment_id
        WHERE o2.id = o.id AND d.status = 'OPEN'
      ) AS open_dispute
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN customer_risk cr ON cr.customer_id = o.customer_id
    WHERE o.id = ${input.orderId}
      AND o.customer_id = ${customerId}
      AND oi.id = ${input.orderItemId}
    LIMIT 1
  `);

  const row = rows[0];
  if (!row) {
    // Identical message whether the order or the item is missing, so this can't
    // be used to probe for other customers' order ids.
    throw new ReturnRequestError(
      'NOT_FOUND',
      'We could not find that item on this order.'
    );
  }

  // --- Hard abuse blocks, checked at intake -------------------------------
  // Doing this here rather than only at approval matters for two reasons: it
  // stops a blocked customer generating courier activity at all, and it means
  // the money is never promised in the first place. We still return a neutral
  // message — telling a fraudster "you are blocked because of your dispute
  // history" is free intelligence.
  const abuse = screenCustomer(row, Number(row.order_total));
  if (abuse.blocked) {
    throw new ReturnRequestError(
      abuse.code ?? 'NOT_ELIGIBLE',
      customerFacingBlockMessage()
    );
  }

  // Evidence is filtered to our own Cloudinary host before it is stored, so the
  // jsonb column can only ever hold short, trusted URLs.
  const photos = sanitisePhotos(input.photos);
  if (PHOTO_REQUIRED.includes(input.reason) && photos.length === 0) {
    throw new ReturnRequestError(
      'PHOTOS_REQUIRED',
      'Please upload at least one photo of the item and its packaging.'
    );
  }

  const verdict = checkReturnEligibility(
    { status: row.status, deliveredAt: row.delivered_at },
    {
      quantity: row.quantity,
      returnedQty: row.returned_qty ?? 0,
      unitPrice: row.unit_price,
    },
    {
      type: input.type,
      reason: input.reason,
      qty: input.qty,
      photoCount: photos.length,
    },
    { exchangesUsedOnOrder: row.exchanges_used ?? 0 }
  );

  if (!verdict.ok) {
    throw new ReturnRequestError(verdict.code, verdict.message);
  }

  // An exchange must name a real, in-stock variant — and a DIFFERENT one, or a
  // customer could "exchange" a dress for the dress they already have.
  let exchangeVariantId: string | null = null;
  if (input.type === 'EXCHANGE') {
    if (!input.exchangeVariantId) {
      throw new ReturnRequestError(
        'EXCHANGE_VARIANT_REQUIRED',
        'Please choose the size you would like to exchange for.'
      );
    }
    if (input.exchangeVariantId === row.variant_id) {
      throw new ReturnRequestError(
        'INVALID_EXCHANGE',
        'Please choose a different size to exchange for.'
      );
    }
    const variantRows = await rawQuery<{ stock_quantity: number }>(sql`
      SELECT stock_quantity FROM product_variants
      WHERE id = ${input.exchangeVariantId} AND is_active = true
      LIMIT 1
    `);
    const variant = variantRows[0];
    if (!variant || variant.stock_quantity < input.qty) {
      throw new ReturnRequestError(
        'VARIANT_UNAVAILABLE',
        'Sorry, that size is out of stock. Please choose another size.'
      );
    }
    exchangeVariantId = input.exchangeVariantId;
  }

  // The guard above is a read-then-write, so two simultaneous submits can both
  // pass it. The partial unique index on order_item_id (open requests only) is
  // what actually makes this atomic — Postgres rejects the loser. Catch that
  // violation and turn it into a customer-readable message rather than a 500.
  const returnId = crypto.randomUUID();

  // Score at intake, not at approval. The admin queue sorts on this column, and
  // a request created 20 minutes ago must already be sortable — waiting for a
  // human to open it would leave the riskiest items sitting at the bottom of a
  // chronological list in the meantime.
  const risk = scoreReturnRisk(buildIntakeRiskSignals(row, input.qty, new Date()));

  let insertedRows: Array<{
    id: string;
    type: string;
    reason: string;
    status: string;
    qty: number;
    fee: string;
    refund_amount: string;
  }>;
  try {
    insertedRows = await rawQuery<{
      id: string;
      type: string;
      reason: string;
      status: string;
      qty: number;
      fee: string;
      refund_amount: string;
    }>(sql`
    INSERT INTO return_requests (
      id, order_id, order_item_id, customer_id, type, reason, qty,
      exchange_variant_id, fee, refund_amount, photos,
      risk_score, risk_reasons
    ) VALUES (
      ${returnId},
      ${row.order_id},
      ${row.order_item_id},
      ${customerId},
      ${input.type},
      ${input.reason},
      ${input.qty},
      ${exchangeVariantId},
      ${verdict.fee.toFixed(2)},
      ${verdict.refundAmount.toFixed(2)},
      ${JSON.stringify(photos)},
      ${risk.score},
      ${JSON.stringify(risk.reasons)}
    )
    RETURNING id, type, reason, status, qty, fee, refund_amount, created_at
    `);
  } catch (error) {
    // 23505 = unique_violation: the partial index rejected a concurrent
    // request for the same line. That is the race we wanted to lose safely.
    const code =
      (error as { code?: string } | null)?.code ??
      (error as { cause?: { code?: string } } | null)?.cause?.code;
    if (code === '23505') {
      throw new ReturnRequestError(
        'DUPLICATE_REQUEST',
        'You already have a return or exchange in progress for this item.'
      );
    }
    throw error;
  }

  const inserted = insertedRows[0];
  if (!inserted) {
    throw new ReturnRequestError(
      'INSERT_FAILED',
      'We could not save your request. Please try again.'
    );
  }

  // Open the audit trail. The customer-facing timeline is built from
  // `return_events`, so without this the customer's first entry would be
  // "We approved your request" with no visible beginning.
  await recordEvent({
    returnRequestId: inserted.id,
    event: 'requested',
    toStatus: 'REQUESTED',
    actor: 'customer',
    data: {
      type: input.type,
      reason: input.reason,
      qty: input.qty,
      fee: verdict.fee,
      refundAmount: verdict.refundAmount,
      riskScore: risk.score,
      photoCount: photos.length,
    },
  });

  return {
    id: inserted.id,
    type: inserted.type as ReturnType,
    reason: inserted.reason,
    status: inserted.status,
    qty: inserted.qty,
    fee: String(inserted.fee),
    refundAmount: String(inserted.refund_amount),
    customerFaultExempt: verdict.customerFaultExempt,
  };
}

/**
 * Requests belonging to this customer, newest first.
 *
 * Extended beyond the original shape with the operational fields a customer
 * legitimately needs to see: where their parcel is, what we owe them, and what
 * they still have to do (self-ship). Internal fields — `risk_score`,
 * `is_blocked`, `blocked_reason`, `photos`, `notes` — are deliberately NOT
 * selected here. A customer must never be able to learn that they are being
 * scored, or why they were blocked; that information is for staff only.
 */
export async function listReturnRequests(customerId: string) {
  const rows = await rawQuery<{
    id: string;
    order_id: string;
    order_number: string;
    product_name: string;
    type: string;
    reason: string;
    status: string;
    qty: number;
    fee: string;
    refund_amount: string;
    net_refund: string | null;
    payout_amount: string | null;
    rejection_reason: string | null;
    created_at: string;
    updated_at: string;
    delivered_at: string | null;
    return_awb: string | null;
    self_ship: boolean;
  }>(sql`
    SELECT
      r.id, r.order_id, o.order_number, oi.product_name,
      r.type, r.reason, r.status, r.qty,
      r.fee, r.refund_amount, r.net_refund, r.payout_amount,
      r.rejection_reason, r.created_at, r.updated_at,
      o.delivered_at, r.shiprocket_return_awb AS return_awb, r.self_ship
    FROM return_requests r
    JOIN orders o ON o.id = r.order_id
    JOIN order_items oi ON oi.id = r.order_item_id
    WHERE r.customer_id = ${customerId}
    ORDER BY r.created_at DESC
  `);

  return rows.map(r => ({
    id: r.id,
    orderId: r.order_id,
    orderNumber: r.order_number,
    productName: r.product_name,
    type: r.type,
    reason: r.reason,
    status: r.status,
    qty: r.qty,
    fee: String(r.fee),
    refundAmount: String(r.refund_amount),
    // What we will actually pay, once fees and shipping are taken off. Null
    // until settlement is claimed, at which point it is authoritative.
    netRefund: r.net_refund != null ? String(r.net_refund) : null,
    payoutAmount: r.payout_amount != null ? String(r.payout_amount) : null,
    rejectionReason: r.rejection_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deliveredAt: r.delivered_at,
    returnAwb: r.return_awb,
    selfShip: r.self_ship,
  }));
}

/**
 * The customer-facing timeline for one request.
 *
 * Built from `return_events`, which means the customer sees the same history an
 * auditor does — there is no separate "friendly" narrative that could drift
 * from what actually happened.
 *
 * Event names are mapped to plain-English steps here, in ONE place. Any event
 * without a mapping is omitted rather than shown raw: a new internal event must
 * never leak internals to a customer just by being added to the audit log.
 */
const CUSTOMER_EVENT_COPY: Record<string, string> = {
  requested: 'You raised this request',
  approved: 'We approved your request',
  rejected: 'We could not approve this request',
  pickup_scheduled: 'We booked a pickup from your address',
  self_ship_offered: 'Please send the parcel to us at your convenience',
  pickup_failed: 'The pickup could not be completed',
  in_transit: 'Your parcel is on its way to us',
  received: 'Your parcel reached us',
  qc_passed: 'Your item passed inspection',
  qc_failed: 'Your item did not pass inspection',
  exchange_shipped: 'Your replacement has been dispatched',
  exchange_failed: 'We could not send the replacement',
  refunded: 'Your refund has been issued',
  refund_pending: 'Your refund is being processed',
  refund_failed: 'We could not process your refund. Our team is on it',
  cancelled: 'This request was cancelled',
  blocked: 'This request is being reviewed',
};

export async function getReturnTimeline(
  customerId: string,
  returnId: string
): Promise<
  | {
      ok: true;
      events: Array<{ label: string; at: string }>;
      currentStatus: string;
    }
  | { ok: false }
> {
  // The customer_id in the WHERE is the authorisation. A return id belonging to
  // someone else matches nothing and returns { ok: false }, identical to a
  // non-existent id.
  const owned = await rawQuery<{ status: string }>(sql`
    SELECT status FROM return_requests
    WHERE id = ${returnId} AND customer_id = ${customerId}
    LIMIT 1
  `);
  if (!owned[0]) return { ok: false };

  const events = await rawQuery<{ event: string; created_at: string }>(sql`
    SELECT e.event, e.created_at
    FROM return_events e
    JOIN return_requests r ON r.id = e.return_request_id
    WHERE e.return_request_id = ${returnId}
      AND r.customer_id = ${customerId}
    ORDER BY e.created_at ASC
  `);

  return {
    ok: true,
    currentStatus: owned[0].status,
    events: events
      // Filtered here rather than in SQL: the allow-list is a JS object literal
      // with no user input, and building an `= ANY(ARRAY[...])` from
      // Object.keys() would mean hand-rolling SQL that is both uglier and easier
      // to get subtly wrong.
      .filter(e => e.event in CUSTOMER_EVENT_COPY)
      .map(e => ({ label: CUSTOMER_EVENT_COPY[e.event], at: e.created_at })),
  };
}

/**
 * Sibling variants of the same product for the exchange size picker: active,
 * in stock, excluding the variant being returned.
 */
export async function listExchangeVariants(variantId: string) {
  const rows = await rawQuery<{
    id: string;
    size: string;
    color: string;
    stock_quantity: number;
  }>(sql`
    SELECT v.id, v.size, v.color, v.stock_quantity
    FROM product_variants v
    JOIN product_variants self ON self.id = ${variantId}
    WHERE v.product_id = self.product_id
      AND v.is_active = true
      AND v.stock_quantity > 0
      AND v.id <> ${variantId}
    ORDER BY v.color, v.size
  `);

  return rows.map(r => ({
    id: r.id,
    size: r.size,
    color: r.color,
  }));
}
