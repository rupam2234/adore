/**
 * Unit tests for the email queue's decision logic.
 *
 * Run: node --test utils/email-queue.test.ts
 *
 * Same convention as the other utils tests: node:test, no framework. The
 * database functions themselves are exercised against the live database (see
 * scripts/), but the parts that can be reasoned about in isolation — backoff
 * growth, the DEAD threshold, dedupe key shape — are pinned here so a refactor
 * that breaks them fails loudly.
 *
 * The concurrency property (two workers must never claim the same job) is NOT
 * testable here because it lives in SQL. It was verified against the live
 * database instead, and it is the reason claimEmailJobs flips rows to SENDING —
 * see the comment on that function.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  backoffMs,
  buildDedupeKey,
  MAX_ATTEMPTS,
  settleFailure,
  STALE_SENDING_SECONDS,
} from './email-lifecycle.ts';

const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

test('backoff starts at one minute', () => {
  assert.equal(backoffMs(1), MINUTE);
});

test('backoff grows exponentially', () => {
  assert.equal(backoffMs(2), 2 * MINUTE);
  assert.equal(backoffMs(3), 4 * MINUTE);
  assert.equal(backoffMs(4), 8 * MINUTE);
});

test('backoff is capped so a DEAD job arrives in well under an hour', () => {
  // Uncapped exponential backoff would push a permanently failing job days into
  // the future, where nobody would ever notice it. The cap is the reason DEAD
  // is reachable in practice.
  assert.equal(backoffMs(20), 15 * MINUTE);
  assert.equal(backoffMs(100), 15 * MINUTE);
});

test('backoff is monotonic non-decreasing', () => {
  let prev = 0;
  for (let a = 1; a <= 12; a++) {
    const ms = backoffMs(a);
    assert.ok(ms >= prev, `attempt ${a} went backwards`);
    prev = ms;
  }
});

test('backoff handles a zero or negative attempt count without going negative', () => {
  assert.equal(backoffMs(0), MINUTE);
  assert.equal(backoffMs(-5), MINUTE);
});

// ---------------------------------------------------------------------------
// The DEAD threshold
// ---------------------------------------------------------------------------

test('MAX_ATTEMPTS is a small, finite number', () => {
  // Large enough to ride out a transient outage, small enough that a genuinely
  // broken job surfaces within the hour.
  assert.ok(MAX_ATTEMPTS >= 3, 'too few retries to survive a blip');
  assert.ok(MAX_ATTEMPTS <= 10, 'too many retries; DEAD would never arrive');
});

test('a job exhausting MAX_ATTEMPTS is dead within the hour', () => {
  // Ties the threshold to the backoff cap: 5 attempts x 15m worst case.
  const totalWorstCase = Array.from({ length: MAX_ATTEMPTS }, (_, i) =>
    backoffMs(i + 1)
  ).reduce((a, b) => a + b, 0);
  assert.ok(
    totalWorstCase < 60 * MINUTE,
    `worst-case retry window is ${totalWorstCase}ms, expected under an hour`
  );
});

// ---------------------------------------------------------------------------
// Dedupe key contract
// ---------------------------------------------------------------------------

/**
 * The key is both a UNIQUE column and Resend's `Idempotency-Key`, so its shape
 * is a real contract rather than an implementation detail:
 *   - must be unique per logical email, so it must include the entity id
 *   - must be under Resend's 256-character limit
 *   - must be stable across retries, so it must not contain a timestamp
 */
function isValidDedupeKey(key: string): boolean {
  if (key.length === 0 || key.length > 256) return false;
  if (!/^[a-z_]+\/[A-Za-z0-9._-]+$/.test(key)) return false;
  // A timestamp would break retry-idempotency: the retry would mint a new key
  // and Resend would treat it as a new email.
  if (/\d{10,}/.test(key.split('/')[1] ?? '')) return false;
  return true;
}

test('dedupe keys follow <flow>/<entity-id>', () => {
  assert.ok(isValidDedupeKey('order_confirmed/AD-1001'));
  assert.ok(isValidDedupeKey('return_rejected/AD-1001'));
  assert.ok(isValidDedupeKey('refund_failed/8f2c1a90-4b3d-4c1e-9f77-2a1b3c4d5e6f'));
});

test('dedupe keys must include an entity id, not just a flow', () => {
  // A flow-only key would collide across every order and silently drop all but
  // the first confirmation.
  assert.ok(!isValidDedupeKey('order_confirmed/'));
  assert.ok(!isValidDedupeKey('order_confirmed'));
});

test('dedupe keys must stay under the Resend 256-char limit', () => {
  const long = 'order_confirmed/' + 'x'.repeat(300);
  assert.ok(!isValidDedupeKey(long));
  assert.ok(isValidDedupeKey('order_confirmed/' + 'x'.repeat(200)));
});

test('dedupe keys must not embed a timestamp', () => {
  // This is the subtle one: a retry that recomputes the key from Date.now()
  // defeats idempotency entirely and sends a duplicate email.
  assert.ok(!isValidDedupeKey('order_confirmed/1759000000000'));
  assert.ok(!isValidDedupeKey('order_confirmed/AD-1001-1759000000000'));
});

test('buildDedupeKey is deterministic and clock-free', () => {
  assert.equal(buildDedupeKey('order_confirmed', 'AD-1001'), 'order_confirmed/AD-1001');
  // The whole point: calling it again must produce the SAME key, or Resend sees
  // a new email on every retry.
  assert.equal(
    buildDedupeKey('order_confirmed', 'AD-1001'),
    buildDedupeKey('order_confirmed', 'AD-1001')
  );
  // Different entity, different key.
  assert.notEqual(
    buildDedupeKey('order_confirmed', 'AD-1001'),
    buildDedupeKey('order_confirmed', 'AD-1002')
  );
});

// ---------------------------------------------------------------------------
// Failure settling
// ---------------------------------------------------------------------------

test('a job is retried until it reaches MAX_ATTEMPTS, then written off', () => {
  // attempts is post-increment, so 1 is the first send.
  for (let a = 1; a < MAX_ATTEMPTS; a++) {
    assert.equal(settleFailure(a), 'RETRY', `attempt ${a} should retry`);
  }
  assert.equal(settleFailure(MAX_ATTEMPTS), 'DEAD');
  assert.equal(settleFailure(MAX_ATTEMPTS + 1), 'DEAD');
});

test('the stale-SENDING window outlives a single Resend call', () => {
  // If this were shorter than a slow send, a healthy worker could have its job
  // stolen mid-flight and the email would go out twice.
  assert.ok(
    STALE_SENDING_SECONDS >= 60,
    'too short to survive a slow provider call'
  );
  // But not so long that a genuinely dead worker strands the email for hours.
  assert.ok(
    STALE_SENDING_SECONDS <= 900,
    'too long; a killed worker would delay the email too much'
  );
});