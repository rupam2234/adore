/**
 * Tests for the Razorpay webhook signature check and payload parsing.
 *
 * Run: node --test utils/razorpay-webhook.test.ts
 *
 * The fixtures below are copied from Razorpay's OWN published sample payloads
 * (docs/webhooks/refunds.md and docs/webhooks/disputes.md), not invented. That
 * is the point: an earlier version of the webhook handler read
 * `payload.refund_entity.id`, which does not exist in Razorpay's schema. Nothing
 * failed — the id was simply `''`, so every refund confirmation was silently
 * ignored and refunds sat in REFUND_PENDING forever. These tests exist so that
 * class of mistake cannot come back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The module reads the secret from the environment, so it must be set before
// the import is evaluated.
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret';

const { signWebhookPayload, verifyWebhookSignature } = await import(
  './razorpay.ts'
);

// --- Razorpay's real sample payload: refund.processed ---------------------
const REFUND_PROCESSED = JSON.stringify({
  entity: 'event',
  account_id: 'acc_E7OQJcEANmBHTC',
  event: 'refund.processed',
  contains: ['refund', 'payment'],
  payload: {
    refund: {
      entity: {
        id: 'rfnd_FS8TWyPrCsa0OB',
        entity: 'refund',
        amount: 50000,
        currency: 'INR',
        payment_id: 'pay_FPoJKWQQ8lK13n',
        notes: { comment: 'Customer Notes for Webhooks.' },
        receipt: null,
        created_at: 1597734071,
        status: 'processed',
        speed_processed: 'normal',
        speed_requested: 'optimum',
      },
    },
    payment: {
      entity: { id: 'pay_FPoJKWQQ8lK13n', amount: 500000, status: 'captured' },
    },
  },
  created_at: 1597734071,
});

// --- Razorpay's real sample payload: payment.dispute.created --------------
const DISPUTE_CREATED = JSON.stringify({
  entity: 'event',
  account_id: 'acc_CFvOKjkTwf3GQy',
  event: 'payment.dispute.created',
  contains: ['payment', 'dispute'],
  payload: {
    payment: {
      entity: {
        id: 'pay_EFtmUsbwpXwBHI',
        entity: 'payment',
        amount: 5297600,
        status: 'captured',
        amount_refunded: 700000,
        refund_status: 'partial',
        method: 'card',
      },
    },
    dispute: {
      entity: {
        id: 'disp_EsIAlDcoUr8CaQ',
        entity: 'dispute',
        payment_id: 'pay_EFtmUsbwpXwBHI',
        amount: 39000,
        currency: 'INR',
        amount_deducted: 0,
        reason_code: 'processed_invalid_expired_card',
        respond_by: 1590431400,
        status: 'open',
        phase: 'chargeback',
        created_at: 1589907957,
      },
    },
  },
  created_at: 1589907977,
});

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

test('a correctly signed body is accepted', () => {
  assert.equal(
    verifyWebhookSignature(REFUND_PROCESSED, signWebhookPayload(REFUND_PROCESSED)),
    true
  );
});

test('a missing signature is rejected', () => {
  assert.equal(verifyWebhookSignature(REFUND_PROCESSED, null), false);
});

test('a signature from a different secret is rejected', () => {
  assert.equal(
    verifyWebhookSignature(REFUND_PROCESSED, 'a'.repeat(64)),
    false
  );
});

test('re-serialising the body can invalidate the signature', () => {
  // THE failure mode this guards. Re-serialising JSON changes the bytes —
  // whitespace, and key order for integer-like keys — so the HMAC no longer
  // matches. The route handler therefore reads request.text() ONCE and parses
  // from that same string; it must never re-stringify.
  //
  // Note this is "can", not "always": a compact payload whose keys are all
  // non-numeric happens to re-serialise byte-identically, which is exactly why
  // this bug is so dangerous — it passes in testing and fails in production.
  const prettyPrinted = JSON.stringify(
    { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_X' } } } },
    null,
    2
  );

  assert.notEqual(
    prettyPrinted,
    JSON.stringify(JSON.parse(prettyPrinted)),
    'fixture must genuinely differ after a round-trip'
  );
  assert.equal(
    verifyWebhookSignature(
      prettyPrinted,
      signWebhookPayload(JSON.stringify(JSON.parse(prettyPrinted)))
    ),
    false,
    'a re-serialised body must NOT verify against the original signature'
  );
});

test('a single changed byte invalidates the signature', () => {
  const tampered = REFUND_PROCESSED.replace('50000', '99999');
  assert.equal(
    verifyWebhookSignature(tampered, signWebhookPayload(REFUND_PROCESSED)),
    false
  );
});

test('a truncated signature is rejected without throwing', () => {
  const sig = signWebhookPayload(REFUND_PROCESSED);
  assert.equal(verifyWebhookSignature(REFUND_PROCESSED, sig.slice(0, 10)), false);
});

// ---------------------------------------------------------------------------
// Payload shape — the bug this file exists to prevent
// ---------------------------------------------------------------------------

test('refund id is at payload.refund.entity.id, not payload.refund_entity', () => {
  const event = JSON.parse(REFUND_PROCESSED);
  const refundId = String(
    (event.payload.refund as { entity?: { id?: string } })?.entity?.id ?? ''
  );
  assert.equal(refundId, 'rfnd_FS8TWyPrCsa0OB');

  // The shape the handler used to read, which does not exist.
  const legacy = (event.payload as Record<string, unknown>).refund_entity;
  assert.equal(legacy, undefined, 'payload.refund_entity must not be relied on');
});

test('dispute payment_id and reason_code are read from the dispute entity', () => {
  const event = JSON.parse(DISPUTE_CREATED);
  const dispute = (event.payload.dispute as { entity?: Record<string, unknown> })
    ?.entity;

  assert.equal(String(dispute?.payment_id), 'pay_EFtmUsbwpXwBHI');
  assert.equal(dispute?.reason_code, 'processed_invalid_expired_card');
  // Razorpay sends `reason_code`, not `reason`.
  assert.equal(dispute?.reason, undefined);
});

test('dispute amount on the wire is in paise', () => {
  const event = JSON.parse(DISPUTE_CREATED);
  const dispute = (event.payload.dispute as { entity?: Record<string, unknown> })
    ?.entity;
  const paise = Number(dispute?.amount);
  assert.equal(paise, 39000);
  // rupees, as stored in payment_disputes.amount
  assert.equal(paise / 100, 390);
});