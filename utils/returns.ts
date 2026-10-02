/**
 * Return & exchange policy constants.
 *
 * Single source of truth for the customer-facing policy page AND the future
 * returns API, so the copy and the enforcement can never drift apart. Change a
 * number here and both the policy text and the validation move together.
 *
 * These values are deliberately aligned with section 3 of /terms (7-day
 * window, refunds to the original payment method). If you change one, change
 * both — a stricter page than the enforced rule is a customer-safety issue.
 */

/** Days from delivery within which a return/exchange can be raised. */
export const RETURN_WINDOW_DAYS = 7;

/** Hours from delivery within which damage/wrong-item claims must be raised. */
export const DEFECT_CLAIM_WINDOW_HOURS = 48;

/** Business days for the refund to land after QC approval. */
export const REFUND_PROCESSING_DAYS = 7;

/** Free exchanges per order — the anti-abuse lever. Each extra is paid. */
export const FREE_EXCHANGES_PER_ORDER = 1;

/** Charged to the customer for an exchange beyond the free allowance (₹). */
export const EXCHANGE_FEE = 149;

/** Charged only when a customer-side return is the fault of the customer (₹). */
export const RETURN_FEE = 149;

/**
 * Reverse-pickup failure compensation. Pickup fails far more often than brands
 * admit — PIN codes outside courier coverage, PIN codes the rider can't reach,
 * failed attempts. Paying the customer to self-ship is far cheaper than
 * refusing the return outright (which is an instant bad-review generator), so
 * these numbers exist to make the fallback cheap and fair.
 */
export const SELF_SHIP = {
  /** Flat we reimburse toward return shipping when self-shipping is forced. (₹) */
  returnReimbursement: 150,
  /** Flat we reimburse toward re-delivery shipping on an exchange. (₹) */
  exchangeReimbursement: 100,
  /** Reverse attempts before we ask the customer to self-ship. */
  maxPickupAttempts: 2,
} as const;

/** Days a store credit, once issued, remains usable. */
export const STORE_CREDIT_VALIDITY_DAYS = 365;

/**
 * Anti-abuse guardrails. These are *review triggers*, not hard blocks — a human
 * still decides, but the queue surfaces the risky accounts first.
 */
export const ABUSE_GUARDRAILS = {
  /** Returned-item value ÷ order value, over a rolling 90-day window. */
  highReturnValueRatio: 0.6,
  /** Lifetime returns per customer before an account is flagged. */
  maxReturnsPerCustomer: 8,
  /** Returned-item value ÷ order value, within the first 7 days. */
  immediateReturnRatio: 0.4,
} as const;

/** Return reasons the customer can self-select. Anything else needs support. */
export const RETURN_REASONS = [
  'Size does not fit',
  'Did not match the description',
  'Damaged on arrival',
  'Wrong item delivered',
  'Changed my mind',
  'Quality not as expected',
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number];

/** Reasons we always treat as our fault: no fee, and reverse pickup is free. */
export const CUSTOMER_FAULT_EXEMPT_REASONS: readonly ReturnReason[] = [
  'Damaged on arrival',
  'Wrong item delivered',
  'Quality not as expected',
  'Did not match the description',
];

// ---------------------------------------------------------------------------
// Eligibility
//
// Pure, synchronous and dependency-free on purpose: this is the piece that
// decides whether a customer is told yes or no, so it has to be cheap to unit
// test and impossible to drift from the constants above. The API route calls it
// server-side on every create — the client-side checks are only a hint.
//
// Nothing here touches the database. The caller supplies the order/item state
// it already read, scoped to the signed-in customer.
// ---------------------------------------------------------------------------

export type ReturnType = 'RETURN' | 'EXCHANGE';

/**
 * Reasons where the fault is ours. These get the short 48h window, a waived
 * fee, and a free reverse pickup. Kept as a Set for O(1) lookups.
 */
const OUR_FAULT = new Set<string>(CUSTOMER_FAULT_EXEMPT_REASONS);

/** Reasons that cannot be verified without photographs of the parcel. */
const PHOTO_REQUIRED = new Set<string>([
  'Damaged on arrival',
  'Wrong item delivered',
]);

/** Minimum shape the caller must read from the DB before calling. */
export type ReturnableOrder = {
  status: string;
  /** From orders.delivered_at. Null until the Shiprocket webhook sets it. */
  deliveredAt: Date | string | null;
};

export type ReturnableItem = {
  quantity: number;
  /** From order_items.returned_qty — already returned on previous requests. */
  returnedQty: number;
  /** Rupees, as a string (numeric columns come back that way from Drizzle). */
  unitPrice: string;
};

export type ReturnRequestInput = {
  type: ReturnType;
  reason: string;
  qty: number;
  /** Photographs supplied for damage/wrong-item claims. */
  photoCount?: number;
};

/** Context the caller must supply that isn't on the order or item itself. */
export type EligibilityContext = {
  /** Exchanges already approved/used on this order (for the free allowance). */
  exchangesUsedOnOrder: number;
  /** Injectable clock; defaults to `new Date()`. */
  now?: Date;
};

export type EligibilityResult =
  | {
      ok: true;
      /** Fee the customer owes, in rupees. 0 when the fault is ours. */
      fee: number;
      /** Amount to refund, in rupees, before deductions. */
      refundAmount: number;
      /** True when we waive fees and pay the reverse pickup. */
      customerFaultExempt: boolean;
      /** Human-readable deadline, shown in the UI as "return by". */
      windowClosesAt: Date;
    }
  | {
      ok: false;
      /** Stable machine code — the UI branches on this, never on the message. */
      code:
        | 'UNKNOWN_REASON'
        | 'ORDER_NOT_DELIVERED'
        | 'DELIVERY_DATE_UNKNOWN'
        | 'WINDOW_CLOSED'
        | 'CLAIM_WINDOW_CLOSED'
        | 'PHOTOS_REQUIRED'
        | 'INVALID_QTY'
        | 'QUANTITY_EXCEEDS';
      message: string;
    };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The authoritative gate for a return or exchange.
 *
 * Order of checks matters and is deliberate: cheapest/most-informative first,
 * and "is this claim still valid at all" before "is the paperwork complete", so
 * an expired claim is never misreported to the customer as a missing photo.
 */
export function checkReturnEligibility(
  order: ReturnableOrder,
  item: ReturnableItem,
  request: ReturnRequestInput,
  context: EligibilityContext
): EligibilityResult {
  const now = context.now ?? new Date();

  if (!RETURN_REASONS.includes(request.reason as ReturnReason)) {
    return {
      ok: false,
      code: 'UNKNOWN_REASON',
      message: 'Please choose one of the listed return reasons.',
    };
  }

  // Only a delivered order can be returned. PENDING/SHIPPED orders are still in
  // motion — cancelling those is a completely different flow.
  if (order.status !== 'DELIVERED') {
    return {
      ok: false,
      code: 'ORDER_NOT_DELIVERED',
      message:
        'This order has not been delivered yet, so it cannot be returned.',
    };
  }

  // Without a delivery date we cannot honestly enforce a "N days from delivery"
  // window. Failing closed would block legacy orders forever; failing open would
  // let anyone return a two-year-old purchase. So: hard stop, routed to support,
  // who can verify the real date from the courier's record.
  if (!order.deliveredAt) {
    return {
      ok: false,
      code: 'DELIVERY_DATE_UNKNOWN',
      message:
        'We could not verify the delivery date for this order. Please contact us and we will sort it out.',
    };
  }

  const deliveredAt =
    order.deliveredAt instanceof Date
      ? order.deliveredAt
      : new Date(order.deliveredAt);
  if (Number.isNaN(deliveredAt.getTime())) {
    return {
      ok: false,
      code: 'DELIVERY_DATE_UNKNOWN',
      message:
        'We could not verify the delivery date for this order. Please contact us and we will sort it out.',
    };
  }

  const ourFault = OUR_FAULT.has(request.reason);
  // Our-fault claims get 48h from delivery (the damage-reporting window we
  // publish). Change-of-mind returns get the full window.
  const windowMs = ourFault
    ? DEFECT_CLAIM_WINDOW_HOURS * 60 * 60 * 1000
    : RETURN_WINDOW_DAYS * MS_PER_DAY;
  const windowClosesAt = new Date(deliveredAt.getTime() + windowMs);

  if (now.getTime() > windowClosesAt.getTime()) {
    return ourFault
      ? {
          ok: false,
          code: 'CLAIM_WINDOW_CLOSED',
          message: `Damage or wrong-item claims must be reported within ${DEFECT_CLAIM_WINDOW_HOURS} hours of delivery.`,
        }
      : {
          ok: false,
          code: 'WINDOW_CLOSED',
          message: `Returns must be requested within ${RETURN_WINDOW_DAYS} days of delivery.`,
        };
  }

  // Damage and wrong-item claims are unverifiable without photographs. This is
  // the cheapest way to kill false damage claims, which otherwise need no
  // return at all and pay out immediately.
  if (PHOTO_REQUIRED.has(request.reason) && (request.photoCount ?? 0) < 1) {
    return {
      ok: false,
      code: 'PHOTOS_REQUIRED',
      message:
        'Please upload at least one photo of the item and its packaging so we can process this claim.',
    };
  }

  if (!Number.isInteger(request.qty) || request.qty < 1) {
    return {
      ok: false,
      code: 'INVALID_QTY',
      message: 'Please choose a valid quantity.',
    };
  }

  const alreadyReturned = Number(item.returnedQty ?? 0);
  const remaining = item.quantity - alreadyReturned;

  // Guards the "one physical item, many requests" exploit. The partial unique
  // index in the DB blocks duplicate OPEN requests across separate rows, but
  // only this check stops a single request asking for more units than were
  // ever bought.
  if (request.qty > remaining) {
    return {
      ok: false,
      code: 'QUANTITY_EXCEEDS',
      message:
        remaining <= 0
          ? 'This item has already been returned in full.'
          : `You can return up to ${remaining} of this item.`,
    };
  }

  // Fee: the first exchange on an order is free, each extra one costs the flat
  // rate. Returns cost the flat rate unless the fault is ours.
  const fee =
    request.type === 'EXCHANGE'
      ? context.exchangesUsedOnOrder >= FREE_EXCHANGES_PER_ORDER
        ? EXCHANGE_FEE
        : 0
      : ourFault
        ? 0
        : RETURN_FEE;

  // Refund base is the returned units at the price actually paid. The original
  // shipping charge is NOT netted off here — that happens at settlement so the
  // numbers stay explainable to the customer.
  const refundAmount = Number(item.unitPrice) * request.qty;

  return {
    ok: true,
    fee,
    refundAmount: Number.isFinite(refundAmount) ? refundAmount : 0,
    customerFaultExempt: ourFault,
    windowClosesAt,
  };
}

/**
 * Anti-abuse scoring for a customer. NOT a block — a flagged account still gets
 * its return processed; this only tells the admin queue to review it with more
 * care. Auto-refusing legitimate customers costs more goodwill than it saves.
 */
export type AbuseSignals = {
  /** Returned-item value ÷ order value, over the rolling window. */
  returnValueRatio: number;
  /** Approved returns in the last 90 days. */
  recentReturns: number;
  /** Returned value ÷ order value within 7 days of delivery. */
  immediateReturnRatio: number;
};

export function assessAbuseRisk(signals: AbuseSignals): {
  flagged: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (signals.returnValueRatio >= ABUSE_GUARDRAILS.highReturnValueRatio) {
    reasons.push(
      `${Math.round(signals.returnValueRatio * 100)}% of order value returned (flag at ${Math.round(ABUSE_GUARDRAILS.highReturnValueRatio * 100)}%)`
    );
  }
  if (signals.recentReturns >= ABUSE_GUARDRAILS.maxReturnsPerCustomer) {
    reasons.push(`${signals.recentReturns} returns in the last 90 days`);
  }
  if (signals.immediateReturnRatio >= ABUSE_GUARDRAILS.immediateReturnRatio) {
    reasons.push(
      `${Math.round(signals.immediateReturnRatio * 100)}% returned within 7 days of delivery`
    );
  }

  return { flagged: reasons.length > 0, reasons };
}
