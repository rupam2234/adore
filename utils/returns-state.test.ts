/**
 * Unit tests for the returns OPERATIONS layer.
 *
 * Run: node --test utils/returns-state.test.ts
 *
 * Same convention as returns.test.ts — node:test, no framework, no database.
 *
 * These tests exist because this is the layer where a mistake costs real money.
 * Every case below is a specific way the business could be exploited, asserted
 * so a well-meaning refactor that removes a guard fails loudly rather than in
 * production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  allowedTransitions,
  assertCanSettle,
  assertCanTransition,
  canTransition,
  computeSettlement,
  isTerminal,
  RETURN_STATUSES,
  TransitionError,
} from './returns-state.ts';
import {
  customerFacingBlockMessage,
  evaluateHardBlocks,
  scoreReturnRisk,
  type BlockContext,
  type RiskSignals,
} from './returns-fraud.ts';

const actor = { actor: 'admin@test' };

// ---------------------------------------------------------------------------
// The graph itself
// ---------------------------------------------------------------------------

test('no path exists from REQUESTED to REFUNDED', () => {
  // The single most important property in the system. A refund must be
  // unreachable without passing through receipt and inspection.
  assert.equal(canTransition('REQUESTED', 'REFUNDED'), false);
  assert.equal(canTransition('APPROVED', 'REFUNDED'), false);
  assert.equal(canTransition('IN_TRANSIT', 'REFUNDED'), false);
  assert.equal(canTransition('RECEIVED', 'REFUNDED'), false);
});

test('money can only be claimed from QC_PASSED', () => {
  assert.equal(canTransition('QC_PASSED', 'REFUND_PENDING'), true);
  // Every other route into REFUND_PENDING is closed.
  for (const from of [
    'REQUESTED',
    'APPROVED',
    'PICKUP_SCHEDULED',
    'IN_TRANSIT',
    'RECEIVED',
    'QC_FAILED',
  ]) {
    assert.equal(
      canTransition(from, 'REFUND_PENDING'),
      false,
      `${from} must not reach REFUND_PENDING`
    );
  }
});

test('terminal states have no exits at all', () => {
  for (const terminal of ['REFUNDED', 'REJECTED', 'CANCELLED']) {
    assert.equal(isTerminal(terminal), true);
    assert.deepEqual(
      allowedTransitions(terminal),
      [],
      `${terminal} must be a dead end`
    );
    // And specifically: nothing can re-open a settled return.
    for (const to of RETURN_STATUSES) {
      assert.equal(
        canTransition(terminal, to),
        false,
        `${terminal} -> ${to} must be impossible`
      );
    }
  }
});

test('an unknown state is never treated as a valid source', () => {
  assert.equal(canTransition('MADE_UP_STATE', 'APPROVED'), false);
  assert.deepEqual(allowedTransitions('MADE_UP_STATE'), []);
});

test('every declared status has a transition entry', () => {
  // Guards against a status being added to the list but not to the table, which
  // would silently make it a dead end.
  for (const status of RETURN_STATUSES) {
    assert.ok(
      Array.isArray(allowedTransitions(status)),
      `${status} is missing from the transition table`
    );
  }
});

// ---------------------------------------------------------------------------
// Transition guards — the anti-exploit checks
// ---------------------------------------------------------------------------

test('a terminal state throws TERMINAL_STATE, not a generic error', () => {
  // This code is what distinguishes a replayed webhook from a logic bug in
  // alerting and in the audit log.
  try {
    assertCanTransition('REFUNDED', 'QC_PASSED', actor);
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof TransitionError);
    assert.equal(error.code, 'TERMINAL_STATE');
  }
});

test('an open dispute blocks approval, and outranks the window check', () => {
  // Ordering matters: telling a fraudster "your window closed" when the real
  // reason is an open dispute confirms their return is otherwise legitimate.
  try {
    assertCanTransition('REQUESTED', 'APPROVED', {
      ...actor,
      hasOpenDispute: true,
      windowClosed: true,
    });
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof TransitionError);
    assert.equal(error.code, 'DISPUTE_OPEN');
  }
});

test('a blocked account cannot be approved', () => {
  try {
    assertCanTransition('REQUESTED', 'APPROVED', {
      ...actor,
      accountBlocked: true,
    });
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof TransitionError);
    assert.equal(error.code, 'ACCOUNT_BLOCKED');
  }
});

test('an expired window blocks approval', () => {
  try {
    assertCanTransition('REQUESTED', 'APPROVED', { ...actor, windowClosed: true });
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof TransitionError);
    assert.equal(error.code, 'WINDOW_CLOSED');
  }
});

test('a clean approval is allowed', () => {
  assert.doesNotThrow(() =>
    assertCanTransition('REQUESTED', 'APPROVED', {
      ...actor,
      windowClosed: false,
      hasOpenDispute: false,
      accountBlocked: false,
    })
  );
});

test('pickup retries are capped by the attempt budget', () => {
  // Re-booking forever is a cost leak AND a way to keep a claim alive past its
  // window by never letting the request close.
  try {
    assertCanTransition('PICKUP_FAILED', 'PICKUP_SCHEDULED', {
      ...actor,
      pickupAttemptsExhausted: true,
    });
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof TransitionError);
    assert.equal(error.code, 'PICKUP_ATTEMPTS_EXHAUSTED');
  }
  // With budget left, a retry is fine.
  assert.doesNotThrow(() =>
    assertCanTransition('PICKUP_FAILED', 'PICKUP_SCHEDULED', {
      ...actor,
      pickupAttemptsExhausted: false,
    })
  );
});

test('QC can be re-inspected once, then it is final', () => {
  // QC_FAILED -> QC_PASSED (re-inspection) is allowed, but a second failure is
  // terminal — otherwise a customer could farm re-inspections indefinitely.
  assert.equal(canTransition('QC_FAILED', 'QC_PASSED'), true);
  assert.equal(canTransition('QC_FAILED', 'REJECTED'), true);
  assert.equal(canTransition('REJECTED', 'QC_PASSED'), false);
});

// ---------------------------------------------------------------------------
// Settlement maths — where the money actually goes
// ---------------------------------------------------------------------------

const baseSettlement = {
  refundAmount: 2000,
  fee: 149,
  shippingAmount: 0,
  orderTotal: 2000,
  alreadyRefundedOnOrder: 0,
};

test('a straightforward return pays gross minus fee', () => {
  const plan = computeSettlement(baseSettlement);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.payout, 1851);
  assert.equal(plan.refundable, true);
});

test('outbound shipping is not refunded', () => {
  // A return is a second shipment we paid for. Refunding the outbound freight
  // would make returns free money for a serial returner.
  const plan = computeSettlement({ ...baseSettlement, shippingAmount: 99 });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.payout, 2000 - 149 - 99);
});

test('payout can never exceed what the customer actually paid', () => {
  // THE invariant. Without the order-level ceiling, three Rs 1,000 returns on a
  // Rs 1,200 order would pay out Rs 3,000.
  const plan = computeSettlement({
    refundAmount: 2000,
    fee: 0,
    orderTotal: 1200,
    alreadyRefundedOnOrder: 0,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.payout, 1200, 'clamped to the order total');
});

test('partial refunds accumulate correctly against the order ceiling', () => {
  const first = computeSettlement({
    refundAmount: 1000,
    fee: 0,
    orderTotal: 1200,
    alreadyRefundedOnOrder: 0,
  });
  assert.equal(first.ok && first.payout, 1000);

  // The second return may only pay the remaining Rs 200.
  const second = computeSettlement({
    refundAmount: 1000,
    fee: 0,
    orderTotal: 1200,
    alreadyRefundedOnOrder: 1000,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.payout, 200);
  assert.ok(
    second.waivedFee >= 0,
    'the clamped remainder is reported so support can explain it'
  );
});

test('an order already refunded in full pays nothing more', () => {
  const plan = computeSettlement({
    refundAmount: 500,
    fee: 0,
    orderTotal: 1000,
    alreadyRefundedOnOrder: 1000,
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.code, 'ORDER_ALREADY_REFUNDED');
});

test('a fee larger than the item produces zero, not a negative payout', () => {
  const plan = computeSettlement({
    refundAmount: 100,
    fee: 149,
    orderTotal: 5000,
    alreadyRefundedOnOrder: 0,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.payout, 0, 'never negative — we do not pay the customer');
  assert.equal(plan.refundable, false);
});

test('a zero or negative refund snapshot is refused outright', () => {
  for (const refundAmount of [0, -50]) {
    const plan = computeSettlement({ ...baseSettlement, refundAmount });
    assert.equal(plan.ok, false);
    if (plan.ok) continue;
    assert.equal(plan.code, 'NOTHING_TO_REFUND');
  }
});

test('payout maths stays exact to the paisa', () => {
  // Floating point drift on money is how a 1-rupee discrepancy becomes a
  // reconciliation argument every month.
  const plan = computeSettlement({
    refundAmount: 1999.99,
    fee: 149.5,
    orderTotal: 5000,
    alreadyRefundedOnOrder: 0,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.payout, 1850.49);
  assert.equal(Math.round(plan.payout * 100), plan.payout * 100);
});

// ---------------------------------------------------------------------------
// The settlement gate
// ---------------------------------------------------------------------------

test('settlement is refused unless the status is REFUND_PENDING', () => {
  const plan = computeSettlement(baseSettlement);
  for (const status of ['REQUESTED', 'QC_PASSED', 'RECEIVED', 'REFUNDED']) {
    try {
      assertCanSettle(status, 'RETURN', plan);
      assert.fail(`should have thrown for ${status}`);
    } catch (error) {
      assert.ok(error instanceof TransitionError);
      assert.equal(error.code, 'NOT_SETTLEABLE');
    }
  }
});

test('a zero payout is refused rather than marked settled', () => {
  const plan = computeSettlement({
    refundAmount: 100,
    fee: 149,
    orderTotal: 5000,
    alreadyRefundedOnOrder: 0,
  });
  try {
    assertCanSettle('REFUND_PENDING', 'RETURN', plan);
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof TransitionError);
    assert.equal(error.code, 'ZERO_PAYOUT');
  }
});

test('an unknown return type is refused', () => {
  const plan = computeSettlement(baseSettlement);
  try {
    assertCanSettle('REFUND_PENDING', 'GIFT', plan);
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof TransitionError);
    assert.equal(error.code, 'UNKNOWN_TYPE');
  }
});

// ---------------------------------------------------------------------------
// Fraud scoring — advisory only
// ---------------------------------------------------------------------------

const cleanSignals: RiskSignals = {
  lifetimeRefunded: 0,
  lifetimeReturns: 0,
  recentReturns: 0,
  recentValue: 0,
  requestValue: 1500,
  orderValue: 3000,
  hoursSinceDelivery: 72,
  // One line out of a TWO-item order. Using 1-of-1 here would (correctly)
  // trigger the "whole order" signal, which is not what a clean fixture means.
  itemsReturnedFromOrder: 1,
  itemsOnOrder: 2,
  priorRejections: 0,
  priorQcFailures: 0,
  hasOpenDispute: false,
  chargebackCount: 0,
  accountBlocked: false,
};

test('an ordinary return scores LOW and raises no flags', () => {
  const risk = scoreReturnRisk(cleanSignals);
  assert.equal(risk.band, 'LOW');
  assert.deepEqual(risk.reasons, []);
});

test('scoring never blocks — it only ever advises', () => {
  // RiskAssessment has no `blocked` field at all, so a caller cannot
  // accidentally treat a high score as a refusal.
  const worst = scoreReturnRisk({
    ...cleanSignals,
    lifetimeReturns: 50,
    recentReturns: 50,
    recentValue: 999_999,
    priorRejections: 20,
    priorQcFailures: 20,
    chargebackCount: 10,
    accountBlocked: true,
    hasOpenDispute: true,
    itemsReturnedFromOrder: 5,
    itemsOnOrder: 5,
    hoursSinceDelivery: 0.2,
  });
  assert.equal(worst.band, 'HIGH');
  assert.equal(worst.score, 100, 'clamped to the maximum');
  assert.ok(worst.reasons.length > 0);
});

test('a single fast return is NOT treated as suspicious', () => {
  // Most fast returns are ordinary impulse changes. Flagging them would train
  // staff to ignore the flag.
  const risk = scoreReturnRisk({ ...cleanSignals, hoursSinceDelivery: 3 });
  assert.equal(risk.band, 'LOW');
});

test('an open dispute dominates the score', () => {
  const risk = scoreReturnRisk({ ...cleanSignals, hasOpenDispute: true });
  assert.ok(risk.score >= 60, `expected >= 60, got ${risk.score}`);
  // It must reach HIGH on its own — a dispute is a hard block, so burying it in
  // MEDIUM would put the most dangerous request mid-queue.
  assert.equal(risk.band, 'HIGH');
});

test('returning an entire order is flagged', () => {
  const risk = scoreReturnRisk({
    ...cleanSignals,
    itemsReturnedFromOrder: 4,
    itemsOnOrder: 4,
  });
  assert.ok(risk.reasons.some(r => r.includes('Every item')));
});

test('an unknown delivery date produces no timing signal', () => {
  // Legacy orders have no delivered_at. Guessing a date would manufacture
  // suspicion out of missing data.
  const risk = scoreReturnRisk({ ...cleanSignals, hoursSinceDelivery: null });
  assert.equal(risk.band, 'LOW');
  assert.equal(risk.reasons.filter(r => r.includes('delivery')).length, 0);
});

// ---------------------------------------------------------------------------
// Hard blocks — the only things that actually refuse
// ---------------------------------------------------------------------------

const cleanBlock: BlockContext = {
  hasOpenDispute: false,
  accountBlocked: false,
  chargebackCount: 0,
  emptyBoxClaim: false,
  confirmedFraud: false,
  recentValueRatio: 0,
  recentReturns: 0,
};

test('a clean account is not blocked', () => {
  assert.equal(evaluateHardBlocks(cleanBlock).blocked, false);
});

test('an open dispute is a hard block', () => {
  const verdict = evaluateHardBlocks({ ...cleanBlock, hasOpenDispute: true });
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.code, 'OPEN_DISPUTE');
});

test('an empty-box claim is a hard block', () => {
  const verdict = evaluateHardBlocks({ ...cleanBlock, emptyBoxClaim: true });
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.code, 'EMPTY_BOX_CLAIM');
});

test('volume alone does NOT block — it needs both signals', () => {
  // Either on its own is common among honest customers. This is the difference
  // between a fraud guardrail and a customer-hostile policy.
  const highValueOnly = evaluateHardBlocks({
    ...cleanBlock,
    recentValueRatio: 0.95,
    recentReturns: 1,
  });
  assert.equal(highValueOnly.blocked, false, 'high ratio alone must not block');

  const manyOnly = evaluateHardBlocks({
    ...cleanBlock,
    recentValueRatio: 0.05,
    recentReturns: 20,
  });
  assert.equal(manyOnly.blocked, false, 'many small returns must not block');

  // Both together, and only then.
  const both = evaluateHardBlocks({
    ...cleanBlock,
    recentValueRatio: 0.95,
    recentReturns: 20,
  });
  assert.equal(both.blocked, true);
  assert.equal(both.code, 'PATTERN_ABUSE');
});

test('the customer-facing refusal never leaks the reason', () => {
  // A fraudster who learns "we blocked you for a chargeback" learns that the
  // signal works. The support path discloses nothing either.
  const message = customerFacingBlockMessage();
  for (const leak of [
    'dispute',
    'chargeback',
    'blocked',
    'fraud',
    'score',
    'risk',
  ]) {
    assert.ok(
      !message.toLowerCase().includes(leak),
      `refusal message must not mention "${leak}"`
    );
  }
});




