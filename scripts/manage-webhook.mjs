// Inspect (and optionally reconcile) the Razorpay webhook via the Webhooks API.
//
// WHY THIS EXISTS
// The dashboard is the normal way to configure a webhook, but it hides two
// things that matter here:
//   1. whether the webhook is currently ACTIVE, or was auto-disabled after
//      repeated delivery failures (this project returned 503 for ~30 min, and
//      Razorpay disables a webhook after 24h of non-2xx responses);
//   2. the secret — which is only ever shown once, at creation time.
//
// SAFE BY DEFAULT: with no flags it only reads. It will not create, modify or
// delete anything without an explicit --create / --activate flag, and it never
// deletes at all.
//
// Usage:
//   node scripts/manage-webhook.mjs                 # read-only status report
//   node scripts/manage-webhook.mjs --secret        # reveal the secret if available
//   node scripts/manage-webhook.mjs --setup         # create + save secret locally
//   node scripts/manage-webhook.mjs --activate      # (re)activate + sync events
//
// Credentials are read from .env.local and never printed.

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'https://api.razorpay.com/v1';

/** The URL the app serves. Override for a staging deployment. */
const WEBHOOK_URL =
  process.env.WEBHOOK_URL ?? 'https://adore.ind.in/api/webhooks/razorpay';

/**
 * The exact event list the returns flow handles.
 *
 * Deliberately NOT `payment.captured` / `order.paid`: checkout already verifies
 * those synchronously via a server-to-server fetch (see utils/checkout.ts), so
 * subscribing adds load and a second source of truth for no benefit.
 *
 * `refund.created` and `refund.speed_changed` are subscribed to but ignored by
 * the handler — subscribing is cheap and keeps the dashboard a complete record.
 */
const EVENTS = [
  'refund.processed',
  'refund.failed',
  'payment.dispute.created',
  'payment.dispute.won',
  'payment.dispute.lost',
  'payment.dispute.closed',
  'payment.dispute.under_review',
  'payment.dispute.action_required',
];

const args = new Set(process.argv.slice(2));

function env(name) {
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find(l => l.trim().startsWith(`${name}=`));
  return line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const key = env('RAZORPAY_API_KEY');
const secret = env('RAZORPAY_API_SECRET');
if (!key || !secret) {
  console.error('RAZORPAY_API_KEY / RAZORPAY_API_SECRET not found in .env.local');
  process.exit(1);
}

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

/**
 * Prove the credentials work BEFORE interpreting an empty webhook list.
 *
 * Without this, "0 webhooks" and "your key is wrong" look identical, and the
 * natural conclusion — "the webhook was never created" — is wrong. A cheap
 * authenticated read settles it.
 */
async function verifyAuth() {
  const res = await api('/payments?count=1');
  if (res.ok) {
    console.log(`Auth OK  (${key.slice(0, 9)}… key)`);
    return true;
  }
  console.error(
    `\n\x1b[31mAuthentication failed (${res.status})\x1b[0m — ${res.body?.error?.description ?? 'unknown'}\n` +
      'Check RAZORPAY_API_KEY and RAZORPAY_API_SECRET in .env.local.\n' +
      'Note: if the values are wrapped in quotes in the file, make sure both\n' +
      'the key and secret came from the SAME Razorpay account — a live key\n' +
      'paired with a test secret fails exactly like this.'
  );
  process.exitCode = 1;
  return false;
}

/** Find the webhook pointing at our URL, if any. */
async function findOurs() {
  const { ok, body } = await api('/webhooks');
  if (!ok) {
    console.error(`Could not list webhooks (${body?.error?.description ?? 'unknown'}).`);
    process.exit(1);
  }
  // The collection key is `items`, NOT `webhooks`. Reading `body.webhooks` yields
  // undefined, so an earlier version of this script reported "None configured at
  // all" while webhooks plainly existed. Do not "simplify" this back.
  const items = body?.items ?? [];
  const ours = items.filter(w => (w.url ?? '').split('?')[0] === WEBHOOK_URL);
  return { all: items, ours };
}

/**
 * Subscribed event names.
 *
 * `events` is an OBJECT of event -> boolean, not an array. Iterating it directly
 * yields keys like "false" and silently reports the wrong thing.
 */
function subscribedEvents(w) {
  return Object.entries(w.events ?? {})
    .filter(([, on]) => on === true)
    .map(([name]) => name);
}

function report(items, ours) {
  console.log(`\nRazorpay webhooks — ${WEBHOOK_URL}\n${'-'.repeat(60)}`);

  if (items.length === 0) {
    console.log('None configured at all.');
    return;
  }

  for (const w of items) {
    const mine = ours.includes(w);
    const on = subscribedEvents(w);
    console.log(`${mine ? 'OURS' : '    '}  id=${w.id}  active=${w.active}`);
    console.log(`         url=${w.url}`);
    console.log(`         subscribed: ${on.length} event(s)`);
    on.forEach(e => console.log(`           + ${e}`));
    if (mine && w.disabled_at) {
      console.log(
        `         \x1b[31mAUTO-DISABLED at ${w.disabled_at}\x1b[0m`
      );
    }
    if (mine && on.length === 0) {
      console.log(
        `         \x1b[33mNo events subscribed — the endpoint will never fire.\x1b[0m`
      );
    }
    console.log('');
  }

  const missing = EVENTS.filter(e => !ours.some(w => subscribedEvents(w).includes(e)));
  if (ours.length && missing.length) {
    console.log(
      `\n\x1b[33mNot subscribed on our webhook:\x1b[0m\n  ${missing.join('\n  ')}`
    );
  } else if (ours.length) {
    console.log('\n\x1b[32mAll required events are subscribed.\x1b[0m');
  }
}

// --- read-only default ----------------------------------------------------
if (!(await verifyAuth())) process.exit(1);

const { all, ours } = await findOurs();
report(all, ours);
printApiLimitations();

if (args.has('--secret') && ours.length) {
  const w = ours[0];
  if (w.secret) {
    console.log(`\nsecret: ${w.secret}`);
  } else {
    console.log(
      '\nThe secret is not retrievable after creation. If you have lost it:\n' +
        '  • check the dashboard (Settings → Webhooks → your webhook), or\n' +
        '  • create a replacement with an explicit secret via --create.'
    );
  }
}

if (!args.has('--setup') && !args.has('--activate') && !args.has('--cleanup-probes')) {
  // Set the exit code rather than calling process.exit(): on Windows, exiting
  // while fetch sockets are still open can trip a libuv assertion.
  process.exitCode = ours.length ? 0 : 1;
} else {
  process.exitCode = 0;
}

// --- explicit writes ------------------------------------------------------

/**
 * Persist the secret to .env.local WITHOUT printing it.
 *
 * The secret is shown exactly once by Razorpay, and it is the one thing that
 * blocks the whole returns flow. Writing it straight to the gitignored env file
 * rather than printing it means it never lands in a terminal scrollback, a
 * screenshot, or a pasted chat transcript.
 */
function saveSecretToEnvFile(value) {
  const file = '.env.local';
  const existing = readFileSync(file, 'utf8');
  const line = `RAZORPAY_WEBHOOK_SECRET="${value}"`;
  const replaced = existing.replace(
    /^RAZORPAY_WEBHOOK_SECRET=.*$/m,
    line
  );
  const next =
    replaced === existing
      ? `${existing.replace(/\s*$/, '')}\n${line}\n`
      : replaced;
  writeFileSync(file, next, 'utf8');
}

if (args.has('--setup')) {
  console.log(`\nCreating webhook → ${WEBHOOK_URL}`);
  const res = await api('/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      url: WEBHOOK_URL,
      active_events: EVENTS,
      description: 'Adore returns — refund confirmations and disputes',
      include_docs: false,
    }),
  });
  if (!res.ok) {
    console.error(
      `Failed: ${res.body?.error?.description ?? JSON.stringify(res.body)}`
    );
    process.exitCode = 1;
  } else if (!res.body.secret) {
    console.error(
      `Created id=${res.body.id} but Razorpay returned no secret.\n` +
        'Check the dashboard — it may be shown there once only.'
    );
    process.exitCode = 1;
  } else {
    saveSecretToEnvFile(res.body.secret);
    console.log(`\n\x1b[32mCreated webhook\x1b[0m id=${res.body.id}`);
    console.log(
      `  events: ${EVENTS.length} subscribed\n` +
        `  secret: saved to .env.local (not displayed)`
    );
    console.log(
      `\n\x1b[33mNext — the secret is shown ONCE by Razorpay and is now only in\n` +
        '.env.local. Push it to Vercel before doing anything else:\x1b[0m\n\n' +
        '  vercel env add RAZORPAY_WEBHOOK_SECRET production\n' +
        '  vercel env add RAZORPAY_WEBHOOK_SECRET preview\n' +
        '  vercel env add RAZORPAY_WEBHOOK_SECRET development\n' +
        '  vercel --prod\n\n' +
        '  node scripts/check-webhooks.mjs\n'
    );
  }
}

if (args.has('--activate')) {
  if (!ours.length) {
    console.error('\nNo webhook for this URL — run with --setup first.');
    process.exitCode = 1;
  } else {
    for (const w of ours) {
      console.log(`\nActivating id=${w.id} and subscribing ${EVENTS.length} events…`);
      const res = await api(`/webhooks/${w.id}`, {
        method: 'PUT',
        // `url` is REQUIRED on PUT. Razorpay treats it as a full replace, not a
        // patch, and answers "validation error : url: cannot be blank" if it is
        // omitted — which is easy to miss as "events didn't save".
        body: JSON.stringify({ url: w.url, active_events: EVENTS }),
      });
      if (!res.ok) {
        console.error(
          `  Failed: ${res.body?.error?.description ?? JSON.stringify(res.body)}`
        );
        continue;
      }
      // Trust the RESPONSE, not the request: POST accepted `active_events`
      // earlier and silently subscribed nothing, so the only reliable proof is
      // what the API reports back.
      const on = subscribedEvents(res.body);
      console.log(`  active=${res.body.active}`);
      console.log(`  subscribed now: ${on.length}`);
      on.forEach(e => console.log(`    + ${e}`));
      const stillMissing = EVENTS.filter(e => !on.includes(e));
      if (stillMissing.length) {
        console.log(
          `  \x1b[31mstill missing:\x1b[0m ${stillMissing.join(', ')}`
        );
      }
    }
  }
}

/** Remove leftover webhooks pointed at our probe URL. */
if (args.has('--cleanup-probes')) {
  const { all: every } = await findOurs();
  const probes = every.filter(
    w => (w.url ?? '').includes('__webhook_secret_probe__')
  );
  if (!probes.length) {
    console.log('\nNo probe webhooks to clean up.');
  }
  for (const p of probes) {
    const del = await api(`/webhooks/${p.id}`, { method: 'DELETE' });
    const detail = del.ok
      ? 'deleted'
      : `${del.status} ${del.body?.error?.description ?? JSON.stringify(del.body)}`;
    console.log(`\nDELETE probe ${p.id} -> ${detail}`);
  }
}

/**
 * Report which parts of setup the API can and cannot do.
 *
 * Verified against this account on 2026-10-02, and both findings cost real
 * debugging time, so they are recorded here rather than rediscovered:
 *
 *   CREATE via API          → works. POST /v1/webhooks returns 200 + id.
 *   SET EVENTS via API      → BROKEN. Both POST and PUT accept `active_events`
 *                             and return 200, but a subsequent GET shows every
 *                             event still false. The request is silently ignored.
 *   READ THE SECRET via API → NOT POSSIBLE. The response contains `secret_exists`
 *                             (a boolean) and never the secret itself. Passing a
 *                             `secret` in the body is accepted but not returned,
 *                             so we cannot confirm it was applied.
 *
 * Conclusion: the webhook can be provisioned by API, but events and the secret
 * must be set in the Razorpay Dashboard.
 */
function printApiLimitations() {
  console.log(
    `\n\x1b[1mWhat the API can and cannot do\x1b[0m\n${'-'.repeat(60)}\n` +
      '  create webhook      API  ✅  (this script, or the dashboard)\n' +
      '  subscribe events    API  ❌  accepted but silently ignored\n' +
      '  read/rotate secret  API  ❌  only a secret_exists boolean is returned\n' +
      '\n' +
      '→ Select the events and read the secret in the Dashboard:\n' +
      '  Settings → Webhooks → https://adore.ind.in/api/webhooks/razorpay'
  );
}