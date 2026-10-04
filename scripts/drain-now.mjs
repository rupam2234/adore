// drain-now.mjs — forces a local drain of pending email jobs.
//
// WHY THIS EXISTS
// ---------------
// Locally there is no Vercel Queue: notifyQueue() fails with "Failed to get OIDC
// token for local development", so every enqueued job sits PENDING until the
// daily backstop cron runs. On Vercel that is correct and fine. In local dev it
// means the welcome email never arrives, which looks like a broken feature.
//
// This calls the same drain endpoint the cron uses. It reuses the app's own
// CRON_SECRET rather than hardcoding anything, so nothing here weakens the
// endpoint's auth.
//
// Usage: node scripts/drain-now.mjs [baseUrl]
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:3000';

// Minimal dotenv read, matching Next's behaviour closely enough: take the value
// after the first '=', trim, then unwrap one layer of matching quotes.
const envText = readFileSync('.env.local', 'utf8');
const rawLine = envText
  .split('\n')
  .find(l => l.trim().startsWith('CRON_SECRET='));

if (!rawLine) {
  console.error('CRON_SECRET not found in .env.local');
  process.exit(1);
}

let secret = rawLine.slice(rawLine.indexOf('=') + 1).trim();
const quote = secret[0];
if ((quote === '"' || quote === "'") && secret.endsWith(quote)) {
  secret = secret.slice(1, -1);
}

if (!secret) {
  console.error('CRON_SECRET is empty — the drain endpoint fails closed.');
  process.exit(1);
}

console.log(`Draining via ${base} (secret ${secret.length} chars)…\n`);

const res = await fetch(`${base}/api/cron/drain-emails`, {
  headers: { Authorization: `Bearer ${secret}` },
});

console.log(`HTTP ${res.status}`);
console.log(await res.text());

if (res.status === 401) {
  console.error(
    '\n401 means the dev server does not see the same CRON_SECRET. That happens if' +
      '\nthe server was started before the value was added to .env.local — restart' +
      '\nit (npm run dev) and try again.'
  );
}