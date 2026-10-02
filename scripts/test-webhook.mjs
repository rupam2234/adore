// Send a correctly-signed Razorpay webhook to your local server, using
// Razorpay's REAL sample payload shape (docs/webhooks/refunds.md).
//
// This is how you verify the endpoint BEFORE pointing Razorpay at it. It proves
// three things at once: the secret matches, the signature is computed over the
// exact bytes you send, and the handler can find the ids it needs.
//
// Usage:
//   node scripts/test-webhook.mjs refund
//   node scripts/test-webhook.mjs dispute
//
// Run your app first (npm run dev). Expect 401 if RAZORPAY_WEBHOOK_SECRET is
// unset, and 200 if the signature checks out.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const kind = process.argv[2] ?? 'refund';
const target =
  process.env.WEBHOOK_TARGET ?? 'http://localhost:3000/api/webhooks/razorpay';

function env(name) {
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find(l => l.trim().startsWith(`${name}=`));
  return line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const secret = env('RAZORPAY_WEBHOOK_SECRET');
if (!secret) {
  console.error(
    'RAZORPAY_WEBHOOK_SECRET is not set in .env.local — the endpoint will ' +
      'return 503 and there is nothing to test.'
  );
  process.exit(1);
}

// Shaped exactly like Razorpay's published sample: payload.<thing>.entity.<field>
const payloads = {
  refund: {
    event: 'refund.processed',
    payload: {
      refund: {
        entity: {
          id: 'rfnd_TEST0000000001',
          entity: 'refund',
          amount: 85100,
          currency: 'INR',
          payment_id: 'pay_TEST0000000001',
          status: 'processed',
          speed_processed: 'normal',
          speed_requested: 'optimum',
        },
      },
      payment: { entity: { id: 'pay_TEST0000000001', status: 'captured' } },
    },
  },
  dispute: {
    event: 'payment.dispute.created',
    payload: {
      payment: {
        entity: { id: 'pay_TEST0000000001', amount: 85100, status: 'captured' },
      },
      dispute: {
        entity: {
          id: 'disp_TEST0000000001',
          entity: 'dispute',
          payment_id: 'pay_TEST0000000001',
          amount: 85100,
          currency: 'INR',
          reason_code: 'pre_arbitration',
          status: 'open',
          phase: 'chargeback',
        },
      },
    },
  },
};

const body = JSON.stringify({
  entity: 'event',
  account_id: 'acc_TEST',
  ...payloads[kind],
  created_at: Math.floor(Date.now() / 1000),
});

const signature = crypto
  .createHmac('sha256', secret)
  .update(body)
  .digest('hex');

console.log(`→ ${kind} event → ${target}`);
console.log(`  body bytes: ${Buffer.byteLength(body)}`);

const res = await fetch(target, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-razorpay-signature': signature,
    // Razorpay sends this; the handler prefers it for deduplication.
    'x-razorpay-event-id': `evt_test_${kind}_${Date.now()}`,
  },
  body,
});

const text = await res.text();
console.log(`  ← ${res.status} ${res.statusText}`);
console.log(`  ${text}`);

if (res.status === 503) {
  console.error('\n  ✗ Secret not loaded. Restart the dev server.');
} else if (res.status === 401) {
  console.error(
    '\n  ✗ Signature rejected. The secret in .env.local does not match the one\n' +
      '    the server process loaded — restart it after editing .env.local.'
  );
} else if (res.ok) {
  console.log('\n  ✓ Accepted.');
  console.log(
    '    Check the row in webhook_events, and that no return silently changed.\n' +
      '    A 200 only proves the signature and dedupe path work — the refund\n' +
      '    id here is a test id and will not match a real ledger row.'
  );
} else {
  console.error(`\n  ✗ Unexpected status ${res.status}.`);
}