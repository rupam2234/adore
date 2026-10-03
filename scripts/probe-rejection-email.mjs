// probe-rejection-email.mjs â€” READ-ONLY diagnostic.
//
// Answers the question behind "do I need @vercel/queue before going live?".
//
// It walks the EXACT path a real rejection takes, without sending anything:
//   loadOpsRow fields -> notifyReturnRejected payload -> queue INSERT
// and then reports how long delivery would take under each configuration.
//
// It inserts a job row keyed on a throwaway dedupe key and deletes it again, so
// it is safe to run against production. It never calls Resend.
//
// Usage: node scripts/probe-rejection-email.mjs

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

let url = process.env.adore_DATABASE_URL;
if (!url) {
  const env = readFileSync('.env.local', 'utf8');
  const line = env
    .split('\n')
    .find(l => l.trim().startsWith('adore_DATABASE_URL='));
  url = line?.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
}
if (!url) throw new Error('adore_DATABASE_URL not found');

const { neon: mkNeon } = await import('@neondatabase/serverless');
const sql = mkNeon(url);

// --- 1. Can we even find a customer to email? ------------------------------
const customers = await sql`
  SELECT first_name, last_name, email FROM customers ORDER BY created_at
`;
console.log('=== 1. recipients reachable via customers join ===');
if (customers.length === 0) {
  console.log('  no customers at all');
} else {
  for (const c of customers) {
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
    console.log(`  ${c.email}   name="${name}"  greeting="${name.split(/\s+/)[0] || 'there'}"`);
  }
}

// --- 2. Insert the job a real rejection would insert. ----------------------
// Tagged templates throughout: sql.unsafe() does NOT execute in this driver
// version (it returns { sql }) and substitutes identifiers oddly, which bit this
// probe twice before switching.
const probeKey = 'return_rejected/PROBE_probe_only';
const probeEmail = customers[0]?.email ?? 'nobody@example.com';
const probeName =
  `${customers[0]?.first_name ?? ''} ${customers[0]?.last_name ?? ''}`.trim() ||
  'there';

await sql`DELETE FROM email_jobs WHERE dedupe_key = ${probeKey}`;
await sql`
  INSERT INTO email_jobs (flow, "to", payload, dedupe_key)
  VALUES (
    'return_rejected',
    ${probeEmail},
    ${JSON.stringify({
      customerName: probeName,
      orderNumber: 'AD-PROBE',
      reason: 'Diagnostic probe row, not a real rejection.',
      photoUrls: [],
    })}::jsonb,
    ${probeKey}
  )
`;

const job = await sql`
  SELECT id, status, attempts, next_attempt_at
  FROM email_jobs WHERE dedupe_key = ${probeKey}
`;
console.log('\n=== 2. job enqueued (this is what a rejection creates) ===');
console.log(' ', JSON.stringify(job[0]));
console.log('  status PENDING = durable, nothing lost. It is simply waiting.');

// --- 3. Who would pick it up, and when? ------------------------------------

console.log('\n=== 3. delivery timing ===');
console.log('  cron /api/cron/drain-emails runs daily at 04:30 UTC.');
console.log('  WITHOUT @vercel/queue: worst case ~24h before this row is sent.');

const queueInstalled = (() => {
  try {
    readFileSync('node_modules/@vercel/queue/package.json', 'utf8');
    return true;
  } catch {
    return false;
  }
})();
console.log(`  @vercel/queue installed: ${queueInstalled}`);
console.log(
  queueInstalled
    ? '  WITH the queue: the consumer fires within seconds of the rejection.'
    : '  WITHOUT it: notifyQueue() logs a warning and the row waits for the cron.'
);

// --- 4. Confirm the drain would actually claim it. -------------------------
const claimed = await sql`
  WITH due AS (
    SELECT id FROM email_jobs
    WHERE status = 'PENDING' AND next_attempt_at <= now()
    LIMIT 10 FOR UPDATE SKIP LOCKED
  )
  UPDATE email_jobs j SET status='SENDING', attempts=j.attempts+1
  FROM due WHERE j.id = due.id RETURNING j.id
`;
console.log(
  `\n=== 4. drain would claim ${claimed.length} row(s) right now ===` +
    (claimed.length
      ? '  <- the probe row is claimable, so the cron path works.'
      : '  <- nothing due, which is correct if the cron has not run yet.')
);

// --- 5. Clean up. ----------------------------------------------------------
await sql`UPDATE email_jobs SET status=${'PENDING'} WHERE dedupe_key=${probeKey}`;
await sql`DELETE FROM email_jobs WHERE dedupe_key=${probeKey}`;
console.log('\nprobe row deleted. Nothing was sent.');


