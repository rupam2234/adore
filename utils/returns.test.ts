/**
 * Unit tests for the returns eligibility gate.
 *
 * Run: node --test utils/returns.test.ts
 *
 * No test framework is installed in this repo, so this uses Node's built-in
 * `node:test` runner. Node 24 strips the types natively, so the .ts file runs
 * directly with no build step and no new dependency.
 *
 * These are the promises the /returns page makes to customers, asserted here so
 * a constant change that breaks the published policy fails loudly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rateLimit } from './rate-limit.ts';

import {
  assessAbuseRisk,
  checkReturnEligibility,
  DEFECT_CLAIM_WINDOW_HOURS,
  EXCHANGE_FEE,
  FREE_EXCHANGES_PER_ORDER,
  RETURN_FEE,
  RETURN_WINDOW_DAYS,
  type EligibilityResult,
  type ReturnableItem,
  type ReturnableOrder,
} from './returns.ts';

test('allows requests up to the limit', () => {
  const opts = { limit: 3, windowMs: 60_000 };
  assert.equal(rateLimit('a', opts).allowed, true);
  assert.equal(rateLimit('a', opts).allowed, true);
  assert.equal(rateLimit('a', opts).allowed, true);
});

test('blocks once the limit is exceeded', () => {
  const opts = { limit: 2, windowMs: 60_000 };
  rateLimit('b', opts);
  rateLimit('b', opts);
  const blocked = rateLimit('b', opts);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
});

test('keys are independent', () => {
  const opts = { limit: 1, windowMs: 60_000 };
  assert.equal(rateLimit('user-1', opts).allowed, true);
  // A different customer must not inherit user-1's usage.
  assert.equal(rateLimit('user-2', opts).allowed, true);
});

test('reports remaining headroom', () => {
  const opts = { limit: 3, windowMs: 60_000 };
  assert.equal(rateLimit('c', opts).remaining, 2);
  assert.equal(rateLimit('c', opts).remaining, 1);
  assert.equal(rateLimit('c', opts).remaining, 0);
});

test('a blocked request reports a positive retry delay', () => {
  const opts = { limit: 1, windowMs: 60_000 };
  rateLimit('d', opts);
  const blocked = rateLimit('d', opts);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  assert.ok(blocked.retryAfterSeconds <= 60);
});

test('the window slides — old hits expire', async () => {
  const opts = { limit: 1, windowMs: 5 };
  assert.equal(rateLimit('e', opts).allowed, true);
  // Same-millisecond calls would be flaky against a 1ms window, so wait past it.
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(rateLimit('e', opts).allowed, true);
});

const NOW = new Date('2026-10-02T12:00:00.000Z');

/** Delivered `days` before NOW. */
function deliveredDaysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Delivered `hours` before NOW. */
function deliveredHoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

// Annotated: DELIVERED alone would infer { deliveredAt: Date }, which then
// rejects the null/string cases the tests deliberately exercise.
const DELIVERED: ReturnableOrder = {
  status: 'DELIVERED',
  deliveredAt: deliveredDaysAgo(2),
};
const ITEM: ReturnableItem = {
  quantity: 2,
  returnedQty: 0,
  unitPrice: '1500.00',
};

function eligible(
  order = DELIVERED,
  item = ITEM,
  request: Partial<Parameters<typeof checkReturnEligibility>[2]> = {},
  context: Partial<Parameters<typeof checkReturnEligibility>[3]> = {}
): EligibilityResult {
  return checkReturnEligibility(
    order,
    item,
    { type: 'RETURN', reason: 'Size does not fit', qty: 1, ...request },
    { exchangesUsedOnOrder: 0, now: NOW, ...context }
  );
}

/** Assert a rejection and return its code, so tests read as one line. */
function expectCode(result: EligibilityResult, code: string) {
  assert.equal(result.ok, false, `expected rejection with code ${code}`);
  assert.equal(result.ok === false ? result.code : '', code);
}

// --- the happy path -------------------------------------------------------

test('accepts a change-of-mind return inside the window', () => {
  const result = eligible();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fee, RETURN_FEE);
  assert.equal(result.refundAmount, 1500);
  assert.equal(result.customerFaultExempt, false);
});

test('refund amount scales with quantity, at the price actually paid', () => {
  const result = eligible(DELIVERED, ITEM, { qty: 2 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.refundAmount, 3000);
});

test('a return on the last day of the window is still accepted', () => {
  const result = eligible({
    status: 'DELIVERED',
    deliveredAt: deliveredDaysAgo(RETURN_WINDOW_DAYS),
  });
  assert.equal(result.ok, true);
});

test('window deadline is measured from delivery, not from order date', () => {
  const result = eligible({
    status: 'DELIVERED',
    deliveredAt: deliveredDaysAgo(1),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const expected =
    deliveredDaysAgo(1).getTime() + RETURN_WINDOW_DAYS * 86_400_000;
  assert.equal(result.windowClosesAt.getTime(), expected);
});

// --- the window -----------------------------------------------------------

test('rejects a return after the window closes', () => {
  expectCode(
    eligible({
      status: 'DELIVERED',
      deliveredAt: deliveredDaysAgo(RETURN_WINDOW_DAYS + 1),
    }),
    'WINDOW_CLOSED'
  );
});

test('order must be DELIVERED', () => {
  for (const status of [
    'PENDING',
    'CONFIRMED',
    'PROCESSING',
    'SHIPPED',
    'CANCELLED',
    'REFUNDED',
  ]) {
    expectCode(
      eligible({ status, deliveredAt: deliveredDaysAgo(2) }),
      'ORDER_NOT_DELIVERED'
    );
  }
});

test('refuses to guess when the delivery date is unknown', () => {
  // Failing open would let anyone return an ancient order; failing closed would
  // block legacy orders forever. Neither: route to a human.
  expectCode(
    eligible({ status: 'DELIVERED', deliveredAt: null }),
    'DELIVERY_DATE_UNKNOWN'
  );
  expectCode(
    eligible({ status: 'DELIVERED', deliveredAt: 'not-a-date' }),
    'DELIVERY_DATE_UNKNOWN'
  );
});

// --- fault claims (the 48h window) ----------------------------------------

test('damage claim inside 48h is accepted and the fee is waived', () => {
  const result = eligible(
    { status: 'DELIVERED', deliveredAt: deliveredHoursAgo(10) },
    ITEM,
    { reason: 'Damaged on arrival', photoCount: 2 }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fee, 0);
  assert.equal(result.customerFaultExempt, true);
});

test('damage claim after 48h is rejected even though the return window is open', () => {
  // The whole point of the short window: a "damaged" claim raised next week is
  // unverifiable, and it pays out without the customer returning anything.
  expectCode(
    eligible(
      {
        status: 'DELIVERED',
        deliveredAt: deliveredHoursAgo(DEFECT_CLAIM_WINDOW_HOURS + 1),
      },
      ITEM,
      { reason: 'Damaged on arrival', photoCount: 3 }
    ),
    'CLAIM_WINDOW_CLOSED'
  );
});

test('damage and wrong-item claims require photographs', () => {
  for (const reason of ['Damaged on arrival', 'Wrong item delivered']) {
    expectCode(
      eligible(
        { status: 'DELIVERED', deliveredAt: deliveredHoursAgo(5) },
        ITEM,
        { reason }
      ),
      'PHOTOS_REQUIRED'
    );
  }
});

test('change-of-mind returns do not require photographs', () => {
  const result = eligible(DELIVERED, ITEM, { reason: 'Changed my mind' });
  assert.equal(result.ok, true);
});

test('quality and description mismatches are treated as our fault', () => {
  for (const reason of [
    'Quality not as expected',
    'Did not match the description',
  ]) {
    const result = eligible(
      { status: 'DELIVERED', deliveredAt: deliveredHoursAgo(20) },
      ITEM,
      { reason }
    );
    assert.equal(result.ok, true, `${reason} should be accepted`);
    if (result.ok)
      assert.equal(result.fee, 0, `${reason} should waive the fee`);
  }
});

// --- exchange fees (the anti-abuse lever) ---------------------------------

test('the first exchange on an order is free', () => {
  const result = eligible(DELIVERED, ITEM, { type: 'EXCHANGE' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fee, 0);
});

test('every exchange beyond the free allowance is charged', () => {
  const result = eligible(
    DELIVERED,
    ITEM,
    { type: 'EXCHANGE' },
    { exchangesUsedOnOrder: 1 }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fee, EXCHANGE_FEE);
  assert.equal(FREE_EXCHANGES_PER_ORDER, 1);
});

test('a third exchange is still just the flat fee, never escalating', () => {
  const result = eligible(
    DELIVERED,
    ITEM,
    { type: 'EXCHANGE' },
    { exchangesUsedOnOrder: 5 }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fee, EXCHANGE_FEE);
});

// --- quantity limits ------------------------------------------------------

test('cannot return more units than were bought', () => {
  expectCode(eligible(DELIVERED, ITEM, { qty: 3 }), 'QUANTITY_EXCEEDS');
});

test('previously returned units reduce what is left', () => {
  const partReturned = { quantity: 2, returnedQty: 1, unitPrice: '1500.00' };
  assert.equal(eligible(DELIVERED, partReturned, { qty: 1 }).ok, true);
  expectCode(eligible(DELIVERED, partReturned, { qty: 2 }), 'QUANTITY_EXCEEDS');
});

test('an item already returned in full cannot be returned again', () => {
  expectCode(
    eligible(
      DELIVERED,
      { quantity: 1, returnedQty: 1, unitPrice: '1500.00' },
      { qty: 1 }
    ),
    'QUANTITY_EXCEEDS'
  );
});

test('rejects zero, negative and fractional quantities', () => {
  for (const qty of [0, -1, 1.5, Number.NaN]) {
    expectCode(eligible(DELIVERED, ITEM, { qty }), 'INVALID_QTY');
  }
});

// --- input validation -----------------------------------------------------

test('rejects a reason that is not on the published list', () => {
  // Otherwise a crafted reason string could be stored and later used to bypass
  // the photo requirement or the fault-exemption logic.
  expectCode(
    eligible(DELIVERED, ITEM, { reason: 'Because I want to' }),
    'UNKNOWN_REASON'
  );
});

// --- abuse scoring (flag-only, never a block) -----------------------------

test('an ordinary customer is not flagged', () => {
  const risk = assessAbuseRisk({
    returnValueRatio: 0.1,
    recentReturns: 1,
    immediateReturnRatio: 0.05,
  });
  assert.equal(risk.flagged, false);
  assert.deepEqual(risk.reasons, []);
});

test('flagging covers high value ratio, frequency and immediate returns', () => {
  assert.equal(
    assessAbuseRisk({
      returnValueRatio: 0.7,
      recentReturns: 0,
      immediateReturnRatio: 0,
    }).flagged,
    true
  );
  assert.equal(
    assessAbuseRisk({
      returnValueRatio: 0,
      recentReturns: 12,
      immediateReturnRatio: 0,
    }).flagged,
    true
  );
  assert.equal(
    assessAbuseRisk({
      returnValueRatio: 0,
      recentReturns: 0,
      immediateReturnRatio: 0.5,
    }).flagged,
    true
  );
});

test('scoring returns explanatory reasons, not a bare boolean', () => {
  const risk = assessAbuseRisk({
    returnValueRatio: 0.9,
    recentReturns: 0,
    immediateReturnRatio: 0,
  });
  assert.equal(risk.flagged, true);
  assert.equal(risk.reasons.length, 1);
  assert.match(risk.reasons[0], /90%/);
});

// --- policy/copy consistency ----------------------------------------------

test('the enforced window matches what the policy page publishes', () => {
  // If someone changes the constant without updating /returns, the site starts
  // promising something the code does not deliver. This is the tripwire.
  assert.equal(RETURN_WINDOW_DAYS, 7);
  assert.equal(DEFECT_CLAIM_WINDOW_HOURS, 48);
});
