// Verify the returns schema exists in the database you are ABOUT to check.
//
// Run it twice — once against local, once against the production database —
// because a deployment can point at a DIFFERENT database than your local
// .env.local, and a migration applied to one is invisible to the other. That
// mismatch is the single most confusing failure mode here: every route returns
// the right status code, and only the first admin page load explodes with
// "relation return_requests does not exist".
//
// Usage:
//   node scripts/verify-returns-schema.mjs
//   DATABASE_URL=<prod-url> node scripts/verify-returns-schema.mjs
//
// Read-only. Never writes.

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

function resolveUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find(l => l.trim().startsWith('adore_DATABASE_URL='));
  return line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const url = resolveUrl();
if (!url) {
  console.error('No database URL. Set DATABASE_URL or add adore_DATABASE_URL to .env.local');
  process.exit(1);
}

// Print the host so it is obvious WHICH database answered. Credentials are
// stripped — this output may end up in a screenshot or a bug report.
const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
})();

const sql = neon(url);

console.log(`\nChecking returns schema on: ${host}\n${'-'.repeat(60)}`);

let missing = 0;

async function checkTables() {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'return_requests','refunds','return_events',
        'customer_risk','payment_disputes','webhook_events'
      )`;
  const found = new Set(rows.map(r => r.table_name));
  const required = [
    'return_requests','refunds','return_events',
    'customer_risk','payment_disputes','webhook_events',
  ];
  for (const t of required) {
    const ok = found.has(t);
    if (!ok) missing++;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  table ${t}`);
  }
}

async function checkColumns() {
  const rows = await sql`
    SELECT table_name || '.' || column_name AS col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND (
      (table_name = 'orders' AND column_name = 'delivered_at')
      OR (table_name = 'order_items' AND column_name = 'returned_qty')
      OR (table_name = 'return_requests' AND column_name IN (
           'net_refund','payout_amount','risk_score','is_blocked',
           'pickup_exhausted','settled_at'))
    )`;
  const found = new Set(rows.map(r => r.col));
  for (const c of [
    'orders.delivered_at',
    'order_items.returned_qty',
    'return_requests.net_refund',
    'return_requests.payout_amount',
    'return_requests.risk_score',
    'return_requests.is_blocked',
    'return_requests.pickup_exhausted',
    'return_requests.settled_at',
  ]) {
    const ok = found.has(c);
    if (!ok) missing++;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  column ${c}`);
  }
}

async function checkIndexes() {
  const rows = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname IN (
      'idx_return_requests_open_unique',
      'idx_refunds_one_per_return',
      'idx_disputes_payment_open'
    )`;
  const found = new Set(rows.map(r => r.indexname));
  for (const i of [
    // Each of these is a money guard, not an optimisation.
    'idx_return_requests_open_unique',
    'idx_refunds_one_per_return',
    'idx_disputes_payment_open',
  ]) {
    const ok = found.has(i);
    if (!ok) missing++;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  index ${i}`);
  }
}

async function checkTrigger() {
  const rows = await sql`
    SELECT tgname FROM pg_trigger WHERE tgname = 'return_requests_terminal_guard'`;
  const ok = rows.length > 0;
  if (!ok) missing++;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'}  trigger return_requests_terminal_guard` +
      (ok ? '' : '   <- terminal states are not DB-enforced')
  );
}

async function checkStates() {
  const rows = await sql`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conname = 'return_requests_status_check'`;
  const def = rows[0]?.def ?? '';
  const need = ['PICKUP_FAILED','SELF_SHIP_PENDING','REFUND_PENDING','EXCHANGE_SHIPPED'];
  for (const s of need) {
    const ok = def.includes(s);
    if (!ok) missing++;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  status allows ${s}`);
  }
}

try {
  await checkTables();
  await checkColumns();
  await checkIndexes();
  await checkTrigger();
  await checkStates();
} catch (error) {
  console.error(`\nCould not query the database: ${error.message}`);
  process.exit(1);
}

if (missing) {
  console.log(
    `\n${missing} item(s) missing on ${host}.\n` +
      'If this is NOT the production database, apply the migration there:\n' +
      '  DATABASE_URL=<prod-url> node scripts/apply-returns.mjs --apply'
  );
  process.exit(1);
}

console.log(`\nSchema complete on ${host}.`);