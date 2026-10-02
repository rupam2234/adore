// Dump the RAW Razorpay webhooks API responses, with no interpretation.
//
// Why this exists: `POST /v1/webhooks` returned 200 with id=Tj4g…, and
// `GET /v1/webhooks` then returned an EMPTY list. Either the created webhook is
// in a state the list endpoint excludes, or the list is doing something we do
// not expect. Guessing between those two is how you end up with two live
// webhooks firing duplicate events at the same endpoint.
//
// This prints exactly what the API said so the question can be answered from
// evidence. Read-only.
//
// Usage: node scripts/dump-webhooks.mjs

import { readFileSync } from 'node:fs';

const BASE = 'https://api.razorpay.com/v1';

function env(name) {
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find(l => l.trim().startsWith(`${name}=`));
  return line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const auth =
  'Basic ' +
  Buffer.from(`${env('RAZORPAY_API_KEY')}:${env('RAZORPAY_API_SECRET')}`).toString(
    'base64'
  );

async function call(label, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`\n${label}`);
  console.log(`${'-'.repeat(52)}`);
  console.log(`GET ${path} -> ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  return body;
}

console.log('\nRaw Razorpay webhooks API dump');
console.log('-'.repeat(56));

const res = await fetch(`${BASE}/webhooks`, {
  headers: { Authorization: auth },
  signal: AbortSignal.timeout(20000),
});
const body = await res.json().catch(() => ({}));
console.log(`GET /v1/webhooks -> ${res.status}`);
console.log(`count: ${body.count}   entity: ${body.entity}`);

// The list lives under `items`, NOT `webhooks`. An earlier version of
// manage-webhook.mjs read `body.webhooks`, which is always undefined — so it
// reported "None configured at all" while webhooks plainly existed. That is the
// exact failure this compact dump exists to make impossible to repeat.
for (const w of body.items ?? []) {
  // `events` is an OBJECT of event -> boolean, not an array of names.
  const subscribed = Object.entries(w.events ?? {})
    .filter(([, on]) => on)
    .map(([name]) => name);

  console.log(`\n  id          ${w.id}`);
  console.log(`  url         ${w.url}`);
  console.log(`  active      ${w.active}`);
  console.log(`  disabled_at ${w.disabled_at || '(not disabled)'}`);
  console.log(`  service     ${w.service}`);
  console.log(`  created_at  ${w.created_at}`);
  console.log(`  subscribed  ${subscribed.length} event(s)`);
  if (subscribed.length) {
    subscribed.forEach(e => console.log(`               + ${e}`));
  }
}