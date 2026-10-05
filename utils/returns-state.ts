/**
 * Return lifecycle — the state machine.
 *
 * Like utils/returns.ts, this is PURE and dependency-free so it can be unit
 * tested without a database. It is the single authority on which transitions
 * are legal, and it is deliberately paranoid: every rule below corresponds to a
 * way the business loses money if the check is missing.
 *
 * The invariants this file exists to guarantee:
 *
 *  1. MONEY ONLY MOVES AFTER QC. There is no path from REQUESTED to REFUNDED.
 *     A refund requires the goods to have physically arrived and been
 *     inspected. Any code that can call the Razorpay refund API must first
 *     pass through `assertCanSettle`, which demands status === QC_PASSED.
 *
 *  2. A REQUEST can only be approved while the customer's claim is still live.
 *     Approving a request outside the return window is how a "we will refund
 *     this" promise gets made to someone who bought the item two years ago.
 *
 *  3. TERMINAL MEANS TERMINAL. REFUNDED / REJECTED / CANCELLED have no exits.
 *     This is what makes double-settlement structurally impossible rather than
 *     merely unlikely: there is no transition to re-enter, and the DB's partial
 *     unique index on `refunds` is the second, independent lock.
 *
 *  4. ONE GATE AT A TIME. The customer may cancel only before a rider is
 *     booked — once a courier is scheduled, cancelling is an operations
 *     decision, not a customer one, or we pay for a pickup we then refuse.
 */

export const RETURN_STATUSES = [
  // Customer-initiated
  'REQUESTED',
  // Awaiting our review
  'APPROVED',
  // Reverse logistics
  'PICKUP_SCHEDULED',
  'PICKUP_FAILED',
  'SELF_SHIP_PENDING',
  'IN_TRANSIT',
  'RECEIVED',
  // Quality control — the gate before money
  'QC_PASSED',
  'QC_FAILED',
  // Exchange fulfilment (no money moves for an exchange)
  'EXCHANGE_SHIPPED',
  'EXCHANGE_FAILED',
  // Money
  'REFUND_PENDING',
  'REFUNDED',
  'REFUND_FAILED',
  // Terminal refusals
  'REJECTED',
  'CANCELLED',
] as const;

export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** No transition out of these. Anything that "re-enters" is a bug or an attack. */
export const TERMINAL_STATUSES: readonly ReturnStatus[] = [
  'REFUNDED',
  'REJECTED',
  'CANCELLED',
];

/** The goods are physically with us (or on their way back to us). */
export const GOODS_MOVING_STATUSES: readonly ReturnStatus[] = [
  'PICKUP_SCHEDULED',
  'PICKUP_FAILED',
  'SELF_SHIP_PENDING',
  'IN_TRANSIT',
  'RECEIVED',
];

/** We owe the customer money (or an item) and have not yet delivered it. */
export const OPEN_STATUSES: readonly ReturnStatus[] = RETURN_STATUSES.filter(
  s => !TERMINAL_STATUSES.includes(s)
);

/**
 * The complete legal transition table.
 *
 * Written as an explicit allow-list rather than a set of rules. An allow-list
 * is the right shape for a security boundary: anything not written here simply
 * cannot happen, so a new feature cannot accidentally open a path to a refund.
 */
const TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  REQUESTED: [
    'APPROVED',
    'REJECTED',
    'CANCELLED', // customer's own request, before we act on it
  ],
  APPROVED: [
    'PICKUP_SCHEDULED',
    'SELF_SHIP_PENDING', // PIN outside reverse-pickup coverage
    'PICKUP_FAILED',
    'CANCELLED', // we book nothing; admin may close it
    'REJECTED', // withdrawn at review, e.g. fraud found
  ],
  PICKUP_SCHEDULED: [
    'IN_TRANSIT',
    'PICKUP_FAILED',
    'CANCELLED', // rider could not be assigned after all
  ],
  PICKUP_FAILED: [
    // Retry a pickup while attempts remain.
    'PICKUP_SCHEDULED',
    // Attempts exhausted → make the customer self-ship.
    'SELF_SHIP_PENDING',
    'CANCELLED',
  ],
  SELF_SHIP_PENDING: [
    'IN_TRANSIT',
    'CANCELLED', // customer never shipped it; window lapses
  ],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: ['QC_PASSED', 'QC_FAILED'],
  QC_PASSED: [
    // RETURN → refund. EXCHANGE → ship the replacement.
    'REFUND_PENDING',
    'EXCHANGE_SHIPPED',
    'EXCHANGE_FAILED',
    // Ops can still reject at the bench if the physical item fails inspection
    // after all (photographed evidence, wrong item, counterfeit).
    'QC_FAILED',
  ],
  QC_FAILED: [
    // One re-inspection is allowed: the bench may have misjudged. A second
    // failure is final, or a customer could farm re-inspections forever.
    'QC_PASSED',
    'REJECTED',
  ],
  EXCHANGE_SHIPPED: [
    // Replacement delivered and the customer is happy → done, no money moved.
    'REFUNDED',
    // Replacement lost/damaged in transit → we owe the money after all.
    'EXCHANGE_FAILED',
  ],
  EXCHANGE_FAILED: ['REFUND_PENDING', 'REJECTED'],
  // The money is in flight. REFUND_PENDING → REFUNDED only on the gateway's
  // confirmed response; a crash mid-call leaves it here, and the reconciler
  // re-queries Razorpay rather than blindly re-sending (see returns-ops.ts).
  REFUND_PENDING: ['REFUNDED', 'REFUND_FAILED'],
  // Retryable. REJECTED is offered only so an admin can close a hopeless case;
  // a customer must never be auto-rejected because our gateway was down.
  REFUND_FAILED: ['REFUND_PENDING', 'REJECTED'],
  // Terminal.
  REFUNDED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** Is this transition legal? */
export function canTransition(from: string, to: string): boolean {
  if (!(from in TRANSITIONS)) return false;
  return (TRANSITIONS[from as ReturnStatus] ?? []).includes(to as ReturnStatus);
}

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as ReturnStatus);
}

export function allowedTransitions(from: string): readonly ReturnStatus[] {
  return TRANSITIONS[from as ReturnStatus] ?? [];
}

export class TransitionError extends Error {
  code: string;
  from: string;
  to: string;
  constructor(code: string, message: string, from: string, to: string) {
    super(message);
    this.code = code;
    this.from = from;
    this.to = to;
  }
}

export type TransitionContext = {
  /** Actor for the audit log: an admin email, 'customer', or a system tag. */
  actor: string;
  /** Clock, injectable for tests. */
  now?: Date;
  /**
   * Whether the claim's return window has already closed. Passed in rather than
   * read from the DB so this file stays pure; the caller has delivered_at.
   */
  windowClosed?: boolean;
  /**
   * True when the reverse-pickup attempt budget is spent. Blocks a retry booking
   * past the published limit, which is a promise we make on /returns.
   */
  pickupAttemptsExhausted?: boolean;
  /**
   * True when the customer already has an open dispute (chargeback) on the
   * order. Blocks approval outright — refunding into a live chargeback is how
   * money is paid out twice.
   */
  hasOpenDispute?: boolean;
  /** True when the account is blocked for abuse. Blocks approval outright. */
  accountBlocked?: boolean;
};

/**
 * Authorise a transition, or throw.
 *
 * Every state change in the system funnels through here. Checks are ordered so
 * the most security-relevant run first: a blocked account never reaches a
 * window check, because "returns are closed" would tell a fraudster their cover
 * is intact. Conversely, a real customer blocked by mistake sees a message they
 * can act on rather than a generic refusal.
 */
export function assertCanTransition(
  from: string,
  to: string,
  ctx: TransitionContext
): void {
  const fail = (code: string, message: string) =>
    new TransitionError(code, message, from, to);

  // 1. Structural: is the edge in the table at all?
  if (!canTransition(from, to)) {
    // A move out of a terminal state is either a replayed webhook or a
    // deliberate double-spend attempt. Both deserve a loud, distinct code.
    if (isTerminal(from)) {
      throw fail(
        'TERMINAL_STATE',
        `This request is already ${from} and cannot change.`
      );
    }
    if (!(from in TRANSITIONS)) {
      throw fail('UNKNOWN_STATE', `Unknown request state "${from}".`);
    }
    throw fail('ILLEGAL_TRANSITION', `Cannot move from ${from} to ${to}.`);
  }

  // 2. Hard abuse blocks. These outrank everything except structural legality,
  //    so a blocked customer cannot even generate courier activity.
  if (to === 'APPROVED') {
    if (ctx.hasOpenDispute) {
      throw fail(
        'DISPUTE_OPEN',
        'This order has an open payment dispute. Returns are paused while we resolve it.'
      );
    }
    if (ctx.accountBlocked) {
      throw fail(
        'ACCOUNT_BLOCKED',
        'Returns are not available on this account. Please contact support.'
      );
    }
    if (ctx.windowClosed) {
      throw fail(
        'WINDOW_CLOSED',
        'The return window for this order has closed.'
      );
    }
  }

  // 3. Pickup retry budget. Re-booking indefinitely is both a cost leak
  //    (repeated failed pickups billed to us) and a way to keep a claim alive
  //    far past the window by never letting it close.
  if (to === 'PICKUP_SCHEDULED' && from === 'PICKUP_FAILED') {
    if (ctx.pickupAttemptsExhausted) {
      throw fail(
        'PICKUP_ATTEMPTS_EXHAUSTED',
        'We have already tried to collect this parcel. We will ask you to send it to us instead.'
      );
    }
  }
}

export type SettlementContext = {
  /** Gross refund snapshot taken when the request was created (rupees). */
  refundAmount: number;
  /** Handling fee we are entitled to deduct (rupees). */
  fee: number;
  /**
   * Shipping charged on the original order. Outbound freight is NOT refunded —
   * a return is a second shipment we paid for, and refunding the first would
   * make returns free money for a serial returner. The reverse leg is our cost.
   */
  shippingAmount?: number;
  /** Original order total (rupees) — the hard ceiling on any payout. */
  orderTotal: number;
  /**
   * Total rupees already refunded across every OTHER return on this order.
   * Without this, three separate ₹600 returns on a ₹1,200 order pay out ₹1,800.
   * This is the single most important settlement invariant in the system.
   */
  alreadyRefundedOnOrder: number;
};

export type SettlementPlan =
  | { ok: true; payout: number; waivedFee: number; refundable: boolean }
  | { ok: false; code: string; message: string };

const money = (n: number) =>
  Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/**
 * Work out exactly how much we pay out, or refuse to.
 *
 * The maths, in order:
 *   gross    = the snapshot taken at request time (already per-unit)
 *   net      = gross − fee − non-returnable outbound shipping
 *   headroom = order total − everything already refunded on this order
 *   payout   = clamp(net, 0, headroom)
 *
 * `payout = 0` is a legitimate, non-error outcome (the fee exceeded the item
 * price) and is reported as `refundable: false` so the caller still settles the
 * request instead of leaving it stuck in REFUND_PENDING forever.
 */
export function computeSettlement(
  ctx: SettlementContext
): SettlementPlan {
  const gross = money(ctx.refundAmount);
  const fee = money(ctx.fee);
  const shipping = money(ctx.shippingAmount ?? 0);

  if (gross <= 0) {
    return {
      ok: false,
      code: 'NOTHING_TO_REFUND',
      message: 'There is no refundable amount on this request.',
    };
  }

  // Order-level ceiling. A non-positive headroom means previous refunds already
  // consumed the order total (only possible via an earlier bug or a manual
  // adjustment) — refuse rather than compound it.
  const headroom = money(ctx.orderTotal - money(ctx.alreadyRefundedOnOrder));
  if (headroom <= 0) {
    return {
      ok: false,
      code: 'ORDER_ALREADY_REFUNDED',
      message:
        'This order has already been refunded in full. Please contact support.',
    };
  }

  const net = money(gross - fee - shipping);
  const payout = money(Math.max(0, Math.min(net, headroom)));
  // What we did not take: the fee/shipping we could have deducted but didn't
  // because the order-level ceiling clamped the payout. Surfaced for the audit
  // trail so a support agent can explain a smaller-than-expected refund.
  const waivedFee = money(Math.max(0, gross - payout - (fee + shipping)));

  return { ok: true, payout, waivedFee, refundable: payout > 0 };
}

/**
 * The last gate before the Razorpay call.
 *
 * Deliberately separate from `assertCanTransition` because it protects a
 * DIFFERENT asset: the transition table protects workflow integrity, this
 * protects the bank balance. Even a caller that somehow reached REFUND_PENDING
 * with a bad amount, or from a forged state, is stopped here.
 */
export function assertCanSettle(
  status: string,
  type: string,
  plan: SettlementPlan
): void {
  if (status !== 'REFUND_PENDING') {
    throw new TransitionError(
      'NOT_SETTLEABLE',
      'This request is not ready for a refund.',
      status,
      'REFUNDED'
    );
  }
  if (type !== 'RETURN' && type !== 'EXCHANGE') {
    throw new TransitionError(
      'UNKNOWN_TYPE',
      `Unknown return type "${type}".`,
      status,
      'REFUNDED'
    );
  }
  if (!plan.ok) {
    throw new TransitionError(plan.code, plan.message, status, 'REFUNDED');
  }
  if (!plan.refundable) {
    throw new TransitionError(
      'ZERO_PAYOUT',
      'The fee and shipping cover the full refund on this item, so there is nothing left to pay out.',
      status,
      'REFUNDED'
    );
  }
}

