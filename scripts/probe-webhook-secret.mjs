// Probe the Razorpay Webhooks API for its exact secret-handling semantics.
//
// WHY
// `POST /v1/webhooks` created a webhook but returned NO secret. That leaves a
// webhook we cannot verify signatures against — worse than useless, because it
// looks configured. We need to know one of:
//
//   (a) does POST accept an explicit `secret` and echo it back?  -> we control it
//   (b) does PUT  accept a secret, so an existing one can be rotated?
//   (c) is the secret only ever visible in the dashboard?
//
// This probes (a) and (b) against a THROWAWAY url and deletes it afterwards, so
// the real webhook is never touched. If deletion fails, the leftover is
// harmless: it points at a URL that does not exist and returns 404.
//
// Usage: node scripts/probe-webhook-secret.mjs

import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const BASE = 'https://api.razorpay.com/v1';
const PROBE_URL = 'https://adore.ind.in/api/__webhook_secret_probe__';
const OWN_SECRET = crypto.randomBytes(24).toString('hex');

function env(name) {
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find(l => l.trim().startsWith(`${name}=`));
  return line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const key = env('RAZORPAY_API_KEY');
const secret = env('RAZORPAY_API_SECRET');
const auth = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

console.log(`\nProbing webhook secret semantics\n${'-'.repeat(52)}`);
console.log(`probe url: ${PROBE_URL}`);
console.log(`own secret: ${OWN_SECRET.length}-char random (will be rotated away)\n`);

// --- (a) does POST accept an explicit secret? -----------------------------
const created = await api('/webhooks', {
  method: 'POST',
  body: JSON.stringify({
    url: PROBE_URL,
    active_events: ['refund.processed'],
    secret: OWN_SECRET,
    description: 'temporary capability probe — safe to delete',
  }),
});

console.log(`POST /webhooks (with explicit secret) -> ${created.status}`);
console.log(`  keys returned: ${Object.keys(created.body ?? {}).join(', ')}`);

if (!created.ok) {
  console.log(
    `  ${created.body?.error?.description ?? JSON.stringify(created.body)}\n` +
      '  => POST does not accept an explicit secret. (c) it must come from the dashboard.'
  );
  process.exitCode = 0;
} else {
  const echoed = created.body.secret;
  console.log(
    `  secret echoed back: ${echoed ? 'YES' : 'no'}` +
      (echoed ? `  (matches ours: ${echoed === OWN_SECRET})` : '')
  );

  // --- (b) can an existing webhook be rotated via PUT? --------------------
  if (echoed === OWN_SECRET) {
    const rotated = crypto.randomBytes(24).toString('hex');
    const put = await api(`/webhooks/${created.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ secret: rotated }),
    });
    console.log(`\nPUT /webhooks/:id (rotate secret) -> ${put.status}`);
    console.log(
      `  secret in response: ${put.body?.secret ? 'YES' : 'no'}` +
        (put.body?.secret ? `  (matches new: ${put.body.secret === rotated})` : '')
    );
  }
}

// --- cleanup --------------------------------------------------------------
const list = await api('/webhooks');
const probes = (list.body?.webhooks ?? []).filter(w => w.url === PROBE_URL);
for (const p of probes) {
  const del = await api(`/webhooks/${p.id}`, { method: 'DELETE' });
  console.log(`\nDELETE probe ${p.id} -> ${del.status}`);
}
if (!probes.length) console.log('\nNo probe webhook needed cleanup.');
console.log(
  '\nReal webhooks on the account are untouched by this probe.'
);