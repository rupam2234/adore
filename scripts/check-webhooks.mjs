// Health check for the returns webhooks on a DEPLOYED site.
//
// Answers the question "is it deployed, and is it configured?" in one command,
// because the two look identical from the browser.
//
// The status codes are deliberately distinguishable, which is why this is
// worth automating:
//   404 — route is not deployed
//   405 — route exists but is POST-only (GET probe)  -> GOOD
//   503 — route deployed, but the secret is MISSING  -> not configured
//   401 — route deployed, secret present, request unsigned/wrong -> GOOD
//   200 — signature verified and the event was accepted
//
// Usage:
//   node scripts/check-webhooks.mjs
//   node scripts/check-webhooks.mjs https://staging.adore.ind.in
//   WEBHOOK_TOKEN=abc123 node scripts/check-webhooks.mjs   # also tests Shiprocket auth
import { readFileSync } from 'node:fs';

const target = (process.argv[2] ?? 'https://adore.ind.in').replace(/\/+$/, '');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

const results = [];

function record(label, { status, body = '', verdict, hint = '' }) {
  results.push({ label, verdict, hint });
  const colour =
    verdict === 'ok' ? GREEN : verdict === 'warn' ? YELLOW : RED;
  console.log(
    `${colour}${verdict === 'ok' ? 'OK  ' : verdict === 'warn' ? 'WARN' : 'FAIL'}${OFF}  ` +
      `${label.padEnd(34)} ${status === '?' ? '--' : status}  ${DIM}${body.slice(0, 60)}${OFF}`
  );
  if (hint) console.log(`      ${DIM}${hint}${OFF}`);
}

async function probe(path, init) {
  try {
    const res = await fetch(`${target}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, body: text };
  } catch (error) {
    return { status: '?', body: String(error.message ?? error) };
  }
}

console.log(`\nChecking ${target}\n${'-'.repeat(60)}`);

// 1. Route deployed at all? A GET on a POST-only route answers 405, which
//    proves the route exists without needing valid credentials.
const rzGet = await probe('/api/webhooks/razorpay');
record('razorpay route deployed', {
  status: rzGet.status,
  body: '',
  verdict: rzGet.status === 405 || rzGet.status === 401 || rzGet.status === 503 ? 'ok' : 'fail',
  hint:
    rzGet.status === 404
      ? 'Route missing — the deployment does not include app/api/webhooks/razorpay'
      : undefined,
});

// 2. Is the secret configured? 503 means "route fine, secret missing".
const rzPost = await probe('/api/webhooks/razorpay', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event: 'health.check' }),
});
record('razorpay secret configured', {
  status: rzPost.status,
  body: rzPost.body,
  verdict:
    rzPost.status === 401
      ? 'ok'
      : rzPost.status === 503
        ? 'fail'
        : 'warn',
  hint:
    rzPost.status === 503
      ? 'ADD RAZORPAY_WEBHOOK_SECRET to the host, then redeploy.'
      : rzPost.status === 401
        ? 'Secret is loaded; this probe was unsigned, so 401 is correct.'
        : undefined,
});

// 3. Shiprocket. A 401 is EXPECTED without a token — the route fails closed.
//    We cannot distinguish "token unset" from "token wrong" from outside, so we
//    say so rather than guessing.
const srGet = await probe('/api/webhooks/shiprocket');
record('shiprocket route deployed', {
  status: srGet.status,
  body: '',
  verdict: srGet.status === 405 || srGet.status === 401 ? 'ok' : 'fail',
  hint: srGet.status === 404 ? 'Route missing from the deployment' : undefined,
});

const providedToken = process.env.WEBHOOK_TOKEN;
if (providedToken) {
  const srAuth = await probe(
    `/api/webhooks/shiprocket?token=${encodeURIComponent(providedToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipment_status: 'HEALTH_CHECK' }),
    }
  );
  record('shiprocket token accepted', {
    status: srAuth.status,
    body: srAuth.body,
    verdict: srAuth.status === 200 ? 'ok' : 'fail',
    hint:
      srAuth.status === 401
        ? 'SHIPROCKET_WEBHOOK_TOKEN on the host does not match this value. ' +
          'It must also appear in the URL as ?token=…'
        : undefined,
  });
} else {
  console.log(
    `      ${DIM}tip: run with WEBHOOK_TOKEN=<your token> to also verify Shiprocket auth${OFF}`
  );
}

// 4. The reconciler cron. Same ambiguity as Shiprocket: 401 either way.
const cron = await probe('/api/cron/reconcile-refunds');
record('cron route deployed', {
  status: cron.status,
  body: '',
  verdict: cron.status === 401 || cron.status === 405 ? 'ok' : 'fail',
  hint:
    cron.status === 404
      ? 'Route missing — refund reconciliation is not running'
      : cron.status === 401
        ? 'Present and refusing unauthenticated calls (correct). Schedule it with CRON_SECRET.'
        : undefined,
});

// 5. Pages, so a deploy that broke the UI is visible here too.
for (const [path, why] of [
  ['/returns', 'policy page'],
  ['/account/returns', 'customer tracking (expect 307 when signed out)'],
]) {
  const page = await probe(path, { redirect: 'manual' });
  const ok = page.status === 200 || page.status === 307;
  record(`${path}`, {
    status: page.status,
    body: '',
    verdict: ok ? 'ok' : 'fail',
    hint: ok ? undefined : `${why} — not rendering`,
  });
}

const failed = results.filter(r => r.verdict === 'fail');
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (failed.length) {
  console.log(`\n${RED}Action needed:${OFF}`);
  failed.forEach(f => console.log(`  • ${f.label}${f.hint ? ` — ${f.hint}` : ''}`));
  process.exit(1);
}
console.log(`\n${GREEN}All webhook routes are deployed and responding correctly.${OFF}`);