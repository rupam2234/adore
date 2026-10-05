/**
 * Abuse detection for the returns flow.
 *
 * Two very different jobs, deliberately kept apart:
 *
 *  1. SCORING (advisory). `scoreReturnRisk` produces a 0-100 score that reorders
 *     the admin queue. It NEVER blocks a customer. Auto-refusing a legitimate
 *     order costs far more in goodwill and chargebacks than it saves in stock,
 *     so a high score means "a human looks at this carefully", not "no".
 *
 *  2. BLOCKING (hard stops). `evaluateHardBlocks` returns the small set of
 *     conditions where refusing is correct, because continuing would actively
 *     lose money. A live chargeback, a proven counterfeit, an empty-box claim.
 *     Everything else is a judgement call for a human.
 *
 * Like utils/returns.ts, this file is PURE so it can be unit tested. The
 * persistence lives in utils/returns-ops.ts.
 */

// The explicit `.ts` extension is deliberate: the rest of the app imports these
// via the `@/utils/*` alias, and this keeps the file directly executable by node.
import { ABUSE_GUARDRAILS } from './returns.ts';

export type RiskSignals = {
  /** Lifetime value refunded to this customer (₹). */
  lifetimeRefunded: number;
  /** Lifetime count of settled returns. */
  lifetimeReturns: number;
  /** Settled returns in the last 90 days. */
  recentReturns: number;
  /** Value of those recent returns (₹). */
  recentValue: number;
  /** Total value of the order this came from (₹). */
  orderValue: number;
  /** This request's own value (₹) — unit price × qty. */
  requestValue: number;
  /**
   * Hours between delivery and this request. A return filed minutes after
   * delivery is a strong signal of a wardrobing exploit; the same item returned
   * in a week is an ordinary customer.
   */
  hoursSinceDelivery: number | null;
  /** How many of this order's items are being returned at once. */
  itemsReturnedFromOrder: number;
  /** Total items on the order. */
  itemsOnOrder: number;
  /** Prior REJECTED returns — a pattern of false claims. */
  priorRejections: number;
  /** Prior QC failures — items sent back that failed inspection. */
  priorQcFailures: number;
  /** Open payment dispute on this order. */
  hasOpenDispute: boolean;
  /** Lifetime chargebacks. */
  chargebackCount: number;
  /** True when the account is already blocked. */
  accountBlocked: boolean;
};

export type RiskAssessment = {
  /** 0-100. Higher = a human should look harder. */
  score: number;
  /** Human-readable reasons, shown only to admins. */
  reasons: string[];
  /** The band, for queue sorting and colour-coding. */
  band: 'LOW' | 'MEDIUM' | 'HIGH';
};

/**
 * Weight the signals into a score.
 *
 * Weights are chosen by expected cost, not by how "suspicious" a signal sounds:
 * a chargeback is worth 40 because it costs real money and is nearly always
 * deliberate, while "returned within 24h" is worth 8 because most fast returns
 * are legitimate impulse changes.
 */
const WEIGHTS = {
  lifetimeReturnRate: 0.12, // per return, capped at 20
  recentReturns: 6, // per return in the 90-day window
  refundToSpendRatio: 30, // scaled by (recent value ÷ order value)
  fastReturn: 8, // filed < 24h after delivery
  veryFastReturn: 6, // additional, filed < 2h
  wholeOrderReturn: 15, // every item on the order
  priorRejections: 12, // per prior false claim
  priorQcFailures: 10, // per prior QC failure
  // A dispute is the one signal strong enough to reach HIGH on its own. It is
  // also a HARD block, not just a score, so if it is only MEDIUM the queue
  // buries the single most dangerous request under ordinary volume.
  openDispute: 60,
  chargeback: 20, // per lifetime chargeback
  accountBlocked: 25, // in addition to whatever caused the block
} as const;

/** Ratio at which the money-ratio term is considered fully saturated. */
const REFUND_RATIO_SATURATION = 0.5;

export function scoreReturnRisk(s: RiskSignals): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;

  // --- Volume -------------------------------------------------------------
  if (s.recentReturns > 0) {
    score += Math.min(30, s.recentReturns * WEIGHTS.recentReturns);
    if (s.recentReturns >= ABUSE_GUARDRAILS.maxReturnsPerCustomer) {
      reasons.push(
        `${s.recentReturns} returns in the last 90 days (flag at ${ABUSE_GUARDRAILS.maxReturnsPerCustomer})`
      );
    }
  }

  if (s.lifetimeReturns > 0) {
    score += Math.min(20, s.lifetimeReturns * WEIGHTS.lifetimeReturnRate);
  }

  // --- Money --------------------------------------------------------------
  // Measured against the order being returned. We deliberately have no
  // "lifetime spend" column on customer_risk (it would need its own
  // aggregation), so recent refunded value ÷ this order's value is the honest
  // proxy we can compute in a single query.
  if (s.orderValue > 0 && s.recentValue > 0) {
    const ratio = s.recentValue / s.orderValue;
    if (ratio >= ABUSE_GUARDRAILS.highReturnValueRatio) {
      score += WEIGHTS.refundToSpendRatio;
      reasons.push(
        `Returned value is ${Math.round(ratio * 100)}% of order value (flag at ${Math.round(
          ABUSE_GUARDRAILS.highReturnValueRatio * 100
        )}%)`
      );
    } else {
      // Below the flag line, still award partial credit — a 45% ratio is not
      // innocent, it is just not yet actionable.
      score +=
        WEIGHTS.refundToSpendRatio * (ratio / REFUND_RATIO_SATURATION) * 0.4;
    }
  }

  if (s.lifetimeRefunded > 0 && s.lifetimeReturns >= 3) {
    reasons.push(`₹${Math.round(s.lifetimeRefunded)} refunded across the account`);
  }

  // --- Timing -------------------------------------------------------------
  // A return filed 90 minutes after delivery means the customer never tried the
  // item on. That is legal and common; it is only a signal in aggregate.
  if (s.hoursSinceDelivery !== null) {
    if (s.hoursSinceDelivery < 2) {
      score += WEIGHTS.veryFastReturn + WEIGHTS.fastReturn;
      reasons.push(
        `Raised ${formatHours(s.hoursSinceDelivery)} after delivery — item was never tried on`
      );
    } else if (s.hoursSinceDelivery < 24) {
      score += WEIGHTS.fastReturn;
      reasons.push(
        `Raised within ${Math.round(s.hoursSinceDelivery)}h of delivery`
      );
    }
  }

  // --- Scope of the claim -------------------------------------------------
  if (s.itemsOnOrder > 0 && s.itemsReturnedFromOrder >= s.itemsOnOrder) {
    score += WEIGHTS.wholeOrderReturn;
    reasons.push('Every item on the order is being returned');
  }
  // One line out of a multi-item order is the *opposite* of suspicious and is
  // very common. No penalty — noted so the absence is deliberate, not an
  // oversight, and so nobody "fixes" it later by adding one.

  // --- History of bad claims ---------------------------------------------
  if (s.priorRejections > 0) {
    score += Math.min(36, s.priorRejections * WEIGHTS.priorRejections);
    reasons.push(`${s.priorRejections} previously rejected claim(s)`);
  }
  if (s.priorQcFailures > 0) {
    score += Math.min(30, s.priorQcFailures * WEIGHTS.priorQcFailures);
    reasons.push(
      `${s.priorQcFailures} item(s) previously failed quality inspection`
    );
  }

  // --- Money-back twice ---------------------------------------------------
  if (s.hasOpenDispute) {
    score += WEIGHTS.openDispute;
    reasons.push('An open payment dispute exists on this order');
  }
  if (s.chargebackCount > 0) {
    score += Math.min(40, s.chargebackCount * WEIGHTS.chargeback);
    reasons.push(`${s.chargebackCount} chargeback(s) on the account`);
  }
  if (s.accountBlocked) {
    score += WEIGHTS.accountBlocked;
    reasons.push('Account is already blocked for abuse');
  }

  const final = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: final,
    reasons,
    band: final >= 60 ? 'HIGH' : final >= 30 ? 'MEDIUM' : 'LOW',
  };
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes`;
  const rounded = Math.round(h * 10) / 10;
  return `${rounded} hour${rounded < 2 ? '' : 's'}`;
}

export type BlockContext = {
  hasOpenDispute: boolean;
  accountBlocked: boolean;
  accountBlockedReason?: string | null;
  chargebackCount: number;
  /**
   * The courier says delivered, but the customer reports the item never
   * arrived. The classic empty-box / mail-rail claim.
   */
  emptyBoxClaim: boolean;
  /** Prior confirmed counterfeit/fraud findings on this account. */
  confirmedFraud: boolean;
  /** Rolling-90-day returned value ÷ this order's value. */
  recentValueRatio: number;
  /** Rolling-90-day return count. */
  recentReturns: number;
};

export type BlockVerdict = {
  blocked: boolean;
  /** Populated only when blocked. Shown to admins; customers get a neutral line. */
  reason: string | null;
  /** Stable code for the audit log. */
  code: string | null;
};

/**
 * Conditions where refusing is unambiguously correct.
 *
 * Note what is NOT here: a high score, many returns, a fast return. Those are
 * judgement calls and belong to a human. Every entry below is a case where
 * proceeding has a known, direct cost — money paid twice, or stock a fraudster
 * has already consumed.
 */
export function evaluateHardBlocks(ctx: BlockContext): BlockVerdict {
  // The most valuable signal in the system. A live chargeback means the bank
  // may already return the money; refunding again pays the customer twice for
  // one item.
  if (ctx.hasOpenDispute) {
    return {
      blocked: true,
      code: 'OPEN_DISPUTE',
      reason:
        'A payment dispute is already open on this order. Refunding now risks paying twice.',
    };
  }

  if (ctx.confirmedFraud) {
    return {
      blocked: true,
      code: 'CONFIRMED_FRAUD',
      reason: 'This account has a confirmed counterfeit or fraud finding.',
    };
  }

  // Not blocked on the customer's word alone — the courier scan is the evidence,
  // and disputes are adjudicated by the bank, not by us.
  if (ctx.emptyBoxClaim) {
    return {
      blocked: true,
      code: 'EMPTY_BOX_CLAIM',
      reason:
        'Courier tracking shows this order delivered, but the customer reports it was not received.',
    };
  }

  if (ctx.accountBlocked) {
    return {
      blocked: true,
      code: 'ACCOUNT_BLOCKED',
      reason:
        ctx.accountBlockedReason ??
        'This account is blocked from returns pending review.',
    };
  }

  // The only volume-based block, and deliberately conservative: it needs BOTH a
  // high value ratio AND many returns before it fires, because either alone is
  // common among honest customers.
  if (
    ctx.recentValueRatio >= ABUSE_GUARDRAILS.highReturnValueRatio &&
    ctx.recentReturns >= ABUSE_GUARDRAILS.maxReturnsPerCustomer
  ) {
    return {
      blocked: true,
      code: 'PATTERN_ABUSE',
      reason: `${Math.round(
        ctx.recentValueRatio * 100
      )}% of order value returned across ${ctx.recentReturns} returns in 90 days.`,
    };
  }

  return { blocked: false, reason: null, code: null };
}

/**
 * What the CUSTOMER is told when we refuse.
 *
 * Never includes the reason. Telling a fraudster "we blocked you because of
 * your dispute history" is free intelligence; a neutral line that routes to
 * support costs nothing, because support will not disclose it either.
 */
export function customerFacingBlockMessage(): string {
  return 'We are unable to process a return for this order. Please contact support and we will review it with you.';
}
