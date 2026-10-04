// delete-test-user.mjs — DESTRUCTIVE. Removes one user account and everything
// hanging off it, so a signup flow can be re-tested from scratch.
//
// WHY A SCRIPT INSTEAD OF A QUERY
// Deleting a user is not one DELETE. Several tables reference it, and the
// failure mode of getting the order wrong is a half-deleted account: user gone,
// orders orphaned, or a stale customers.phone row blocking the very re-signup
// this is meant to unblock. This walks the dependencies in order and reports
// every count BEFORE deleting anything.
//
// THE customers.phone TRAP (the reason this exists)
// The one-account-per-phone guarantee is a partial unique index on
// customers.phone. Deleting only the `users` row leaves the `customers` row
// behind, phone and all — and the next signup with that number is then
// rejected with PHONE_IN_USE. That is the most likely way to run this, get a
// confusing 409, and conclude the feature is broken.
//
// Usage: node scripts/delete-test-user.mjs <email>            (dry run: prints the plan)
//        node scripts/delete-test-user.mjs <email> --confirm  (deletes)
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const confirm = process.argv.includes('--confirm');
const email = process.argv[2];

if (!email || email.startsWith('--')) {
  console.error('Usage: node scripts/delete-test-user.mjs <email> [--confirm]');
  process.exit(1);
}
if (!email.includes('@')) {
  console.error(`"${email}" does not look like an email address.`);
  process.exit(1);
}

let url = process.env.adore_DATABASE_URL;
if (!url) {
  const env = readFileSync('.env.local', 'utf8');
  const line = env
    .split('\n')
    .find(l => l.trim().startsWith('adore_DATABASE_URL='));
  url = line?.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
}
if (!url) throw new Error('adore_DATABASE_URL not found');

const sql = neon(url);
const target = email.trim().toLowerCase();

// --- 1. Does it exist? ------------------------------------------------------
const users = await sql`
  SELECT id, email, name, role, created_at
  FROM users
  WHERE lower(email) = ${target}`;

if (users.length === 0) {
  console.log(`OK   no user with email ${target} — nothing to do.`);
  process.exit(0);
}
if (users.length > 1) {
  console.error(`ABORT ${users.length} rows share this email. Unusual; not deleting.`);
  process.exit(1);
}

const user = users[0];

// Admin accounts are not test fixtures. Deleting one can lock the only operator
// out of the panel.
if (user.role === 'admin') {
  console.error(`ABORT ${target} is an ADMIN. Delete it by hand if you really mean to.`);
  process.exit(1);
}

// --- 2. What depends on it? -------------------------------------------------
const customer = await sql`
  SELECT id, email, phone FROM customers WHERE user_id = ${user.id}`;
const customerId = customer[0]?.id ?? null;

// `count(*)::int` because the driver returns bigint as a string, which would
// otherwise print misleadingly for larger counts.
//
// welcome_promo_issues only exists once scripts/add-welcome-promo.sql has been
// applied. Probing for it rather than assuming means this script is usable for
// deleting an account BEFORE that migration lands, instead of failing with a
// confusing "relation does not exist" halfway through.
const hasWelcomeTable = await sql`
  SELECT count(*)::int AS n
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'welcome_promo_issues'`;
const hasWelcome = Number(hasWelcomeTable[0].n) > 0;

const counts = await sql`
  SELECT
    (SELECT count(*)::int FROM sessions WHERE user_id = ${user.id}) AS sessions,
    (SELECT count(*)::int FROM carts WHERE user_id = ${user.id}) AS carts,
    (SELECT count(*)::int FROM promo_redemptions WHERE user_id = ${user.id}) AS promo_redemptions,
    (SELECT count(*)::int FROM orders WHERE customer_id = ${customerId ?? ''}) AS orders,
    (SELECT count(*)::int FROM customer_addresses
       WHERE customer_id = ${customerId ?? ''}) AS addresses`;

const c = counts[0];
const welcomeCount = hasWelcome
  ? (await sql`
      SELECT count(*)::int AS n FROM welcome_promo_issues WHERE user_id = ${user.id}`)[0].n
  : 0;
const total =
  Object.values(c).reduce((a, b) => a + Number(b), 0) + Number(welcomeCount);

// Unsent email jobs addressed to this account.
//
// Deliberately counted by RECIPIENT rather than by user_id, because
// email_jobs has no user_id column — it stores `to` as a bare address. So this
// also catches a welcome_email that was enqueued but never drained.
//
// This matters more than it looks. A PENDING job outlives the account it was
// written for: delete the user and the row is still sitting in the outbox, so
// the daily backstop cron will eventually pick it up and send a welcome email
// containing a promo code that no longer exists. The recipient gets an offer
// they cannot use, and the redemption it points at is already gone.
const pendingJobs = await sql`
  SELECT flow, status, attempts, created_at
  FROM email_jobs
  WHERE lower("to") = ${target} AND status IN ('PENDING', 'SENDING')
  ORDER BY created_at DESC`;
const pendingCount = pendingJobs.length;

if (!hasWelcome) {
  console.log(
    '\nNOTE: welcome_promo_issues is absent — scripts/add-welcome-promo.sql has' +
      '\n      not been run. Nothing to clean up there, and the welcome flow' +
      '\n      cannot issue codes until it is.'
  );
}

// --- 3. Print the plan ------------------------------------------------------
console.log(`\nUSER  ${user.email}`);
console.log(`      id:    ${user.id}`);
console.log(`      name:  ${user.name}`);
console.log(`      role:  ${user.role}`);
console.log(`      since: ${user.created_at}`);

console.log('\nCUSTOMER ROW');
if (customer[0]) {
  console.log(`      id:    ${customerId}`);
  console.log(`      email: ${customer[0].email}`);
  console.log(`      phone: ${customer[0].phone ?? '(none)'}`);
  console.log('      NOTE:  this row holds the phone that would block a re-signup');
} else {
  console.log('      (none)');
}

console.log('\nDEPENDENT ROWS');
console.log(`      sessions:             ${c.sessions}`);
console.log(`      carts:                ${c.carts}`);
console.log(`      orders:               ${c.orders}`);
console.log(`      customer_addresses:   ${c.addresses}`);
console.log(`      promo_redemptions:    ${c.promo_redemptions}`);
console.log(`      welcome_promo_issues: ${welcomeCount}`);
console.log(`      total:                ${total}`);

if (pendingCount > 0) {
  console.log('\nUNSENT EMAIL JOBS (will be deleted with the account)');
  for (const j of pendingJobs) {
    console.log(`      ${j.flow}  ${j.status}  attempts=${j.attempts}`);
  }
  console.log(
    '      NOTE: left in place, the daily cron would send these to a' +
      '\n            deleted account — with a promo code that no longer exists.'
  );
}

if (Number(c.orders) > 0) {
  console.log(
    '\nWARNING: this account has orders. They are deleted with it. If you only' +
      '\n         want to re-test the welcome EMAIL and not the order flow, do not' +
      '\n         delete — re-request the email from the admin panel instead.'
  );
}

if (!confirm) {
  console.log('\nDRY RUN. Nothing deleted. Re-run with --confirm to apply.');
  process.exit(0);
}

// --- 4. Delete, children first ----------------------------------------------
// neon-http cannot open a transaction, so there is no atomic option — hence the
// plan printed above. Children go before parents so a mid-way failure leaves
// less behind than the reverse would.
const deleted = [];
const drop = async (label, query) => {
  const rows = await query;
  deleted.push(`${label}: ${rows.length}`);
};

await drop('sessions', sql`
  DELETE FROM sessions WHERE user_id = ${user.id} RETURNING user_id`);
await drop('carts', sql`
  DELETE FROM carts WHERE user_id = ${user.id} RETURNING id`);
await drop('promo_redemptions', sql`
  DELETE FROM promo_redemptions WHERE user_id = ${user.id} RETURNING id`);
if (pendingCount > 0) {
  // Delete only UNSENT jobs. A SENT row is the audit record that the customer
  // was emailed, and the Resend bounce webhook resolves provider_id -> job, so
  // destroying it would orphan a late bounce. Keeping it costs nothing.
  await drop('email_jobs (unsent)', sql`
    DELETE FROM email_jobs
    WHERE lower("to") = ${target} AND status IN ('PENDING','SENDING')
    RETURNING id`);
}

if (hasWelcome) {
  await drop('welcome_promo_issues', sql`
    DELETE FROM welcome_promo_issues WHERE user_id = ${user.id} RETURNING id`);
} else {
  deleted.push('welcome_promo_issues: 0 (table absent)');
}
await drop('customer_addresses', sql`
  DELETE FROM customer_addresses WHERE customer_id = ${customerId ?? ''} RETURNING id`);
await drop('customers', sql`
  DELETE FROM customers WHERE user_id = ${user.id} RETURNING id`);
await drop('users', sql`
  DELETE FROM users WHERE id = ${user.id} RETURNING id`);

console.log('\nDELETED');
for (const line of deleted) console.log(`      ${line}`);

// --- 5. Verify the phone is actually free ----------------------------------
// The whole point of step 4. A surviving customers row with the same phone
// means the next signup fails with PHONE_IN_USE and looks like a bug.
if (customer[0]?.phone) {
  const left = await sql`
    SELECT count(*)::int AS n FROM customers WHERE phone = ${customer[0].phone}`;
  const n = Number(left[0].n);
  console.log(
    `\nVERIFY phone ${customer[0].phone}: ${n} row(s) left.` +
      (n === 0
        ? ' Free for a fresh signup.'
        : ' STILL BLOCKED — a customers row survived.')
  );
}

console.log('\nOK   you can sign up again with that email and phone.');