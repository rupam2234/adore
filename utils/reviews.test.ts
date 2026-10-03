/**
 * Unit tests for the REVIEW ELIGIBILITY rules.
 *
 * Run: node --test utils/reviews.test.ts
 *
 * Same convention as the other utils tests — node:test, no framework, no
 * database. Only the pure decision layer is covered: the DB queries it depends
 * on are exercised through the live app, but the LOGIC that turns "who is this
 * and what did they buy" into "may they review" is where a mistake silently
 * opens the review system to anyone, so it is pinned here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateReviewEligibility,
  REVIEW_BLOCK_MESSAGES,
} from './review-format.ts';

const signedOut = { loggedIn: false, hasPurchased: false };

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------

test('a signed-in buyer with a matching order may review', () => {
  assert.equal(
    evaluateReviewEligibility({ loggedIn: true, hasPurchased: true }),
    'eligible'
  );
});

test('a signed-in NON-buyer may not review', () => {
  // The rule this change adds: login alone is not enough.
  assert.equal(
    evaluateReviewEligibility({ loggedIn: true, hasPurchased: false }),
    'not_purchased'
  );
});

test('a signed-out visitor is asked to log in, not told they have no purchase', () => {
  // Ordering matters: signing in may reveal they DID buy it, so we must not
  // claim "only verified buyers" to someone we have not identified yet.
  assert.equal(evaluateReviewEligibility(signedOut), 'logged_out');
});

test('a signed-in buyer who already reviewed is blocked as a duplicate', () => {
  assert.equal(
    evaluateReviewEligibility({
      loggedIn: true,
      hasPurchased: true,
      alreadyReviewed: true,
    }),
    'already_reviewed'
  );
});

test('the purchase gate outranks the soft duplicate check', () => {
  // The purchase rule is the hard gate; the duplicate rule only matches on
  // author NAME. If the soft check won here, two different customers sharing a
  // name would decide each other's outcomes, and a denied request would report
  // the wrong reason.
  assert.equal(
    evaluateReviewEligibility({
      loggedIn: true,
      hasPurchased: false,
      alreadyReviewed: true,
    }),
    'not_purchased'
  );
});

test('a buyer is only told about duplicates once they pass the purchase gate', () => {
  assert.equal(
    evaluateReviewEligibility({
      loggedIn: true,
      hasPurchased: true,
      alreadyReviewed: true,
    }),
    'already_reviewed'
  );
});

test('alreadyReviewed is ignored entirely for signed-out visitors', () => {
  assert.equal(
    evaluateReviewEligibility({ ...signedOut, alreadyReviewed: true }),
    'logged_out'
  );
});

test('alreadyReviewed defaults to false when the caller omits it', () => {
  assert.equal(
    evaluateReviewEligibility({ loggedIn: true, hasPurchased: true }),
    evaluateReviewEligibility({
      loggedIn: true,
      hasPurchased: true,
      alreadyReviewed: false,
    })
  );
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

test('every blocked state has a distinct, non-empty message', () => {
  const states = ['logged_out', 'not_purchased', 'already_reviewed'] as const;
  const messages = states.map(s => REVIEW_BLOCK_MESSAGES[s]);
  for (const m of messages) assert.ok(m.length > 0);
  assert.equal(new Set(messages).size, states.length);
});

test('the non-buyer message names the actual rule', () => {
  // If someone is ever wrongly blocked, this string is what they will read, so
  // it has to say what would let them in.
  assert.match(REVIEW_BLOCK_MESSAGES.not_purchased, /verified buyers/i);
});

test('no "eligible" message exists — the form is shown instead', () => {
  assert.equal(
    (REVIEW_BLOCK_MESSAGES as Record<string, string>).eligible,
    undefined
  );
});
