// probe-signup.mjs — READ-ONLY. Answers "why did my signup email not arrive?"
// without guessing.
//
// A missing welcome email has several very different causes, and they look
// identical from the customer's side: nothing in the inbox. Each one is
// distinguishable only by looking at the durable ledger, so this walks the
// pipeline end to end and names which stage swallowed it.
//
//   user row exists?          -> signup committed at all
//   email_jobs row exists?    -> enqueueAndNotify ran (dedupe key / CHECK)
//   its status                -> PENDING = never drained, DEAD = send failed
//   flow CHECK constraint     -> rejects 'welcome_email' if unmigrated
//   WELCOME10 row present?    -> no code can be issued without it
//   RESEND_API_KEY set?       -> sendEmail silently skips without it
//
// Usage: node scripts/probe-signup.mjs <email>
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const email = (process.argv[2] ?? '').trim().toLowerCase();
const wantTypes = process.argv.includes('--types');

if (!wantTypes && !email.includes('@')) {
  console.error('Usage: node scripts/probe-signup.mjs <email> | --types');
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
const show = v => console.log(JSON.stringify(v, null, 2));

/* --- 0. Column types (for diagnosing FK mismatches) ------------------------ */
if (wantTypes) {
  console.log('\n=== COLUMN TYPES ===');
  show(await sql`
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('promo_codes','promo_redemptions','carts','users',
                         'customers','welcome_promo_issues')
      AND column_name IN ('id','promo_code_id','user_id')
    ORDER BY table_name, column_name`);
  process.exit(0);
}

/* --- 1. The account -------------------------------------------------------- */
const users = await sql`
  SELECT u.id, u.email, u.name, u.role, u.created_at,
         c.id AS customer_id, c.phone
  FROM users u
  LEFT JOIN customers c ON c.user_id = u.id
  WHERE lower(u.email) = ${email}`;

console.log('\n=== 1. USER ===');
if (users.length === 0) {
  console.log('  NO USER ROW. Signup never committed — check the API response.');
} else {
  show(users[0]);
}

/* --- 2. The job in the outbox ---------------------------------------------- */
console.log('\n=== 2. EMAIL JOBS FOR THIS ADDRESS ===');
const jobs = await sql`
  SELECT flow, status, attempts, created_at, sent_at,
         left(coalesce(last_error, ''), 300) AS last_error,
         left(payload::text, 300) AS payload
  FROM email_jobs
  WHERE lower("to") = ${email}
  ORDER BY created_at DESC`;
show(jobs);

/* --- 3. Any job stuck at all ----------------------------------------------- */
console.log('\n=== 3. ALL JOB STATUSES (is the pipeline moving?) ===');
show(await sql`
  SELECT flow, status, count(*)::int AS n
  FROM email_jobs GROUP BY flow, status ORDER BY flow, status`);

/* --- 4. Does the schema accept the new flow? ------------------------------ */
console.log('\n=== 4. email_jobs.flow CHECK ===');
show(await sql`
  SELECT pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE conrelid = 'email_jobs'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%flow%'`);

/* --- 5. Welcome-promo prerequisites ---------------------------------------- */
console.log('\n=== 5. MIGRATION STATE ===');
const tbl = await sql`
  SELECT count(*)::int AS n FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'welcome_promo_issues'`;
console.log(`welcome_promo_issues table: ${tbl[0].n > 0 ? 'present' : 'MISSING'}`);
show(await sql`
  SELECT code, discount_type, discount_value, min_subtotal, max_redemptions, is_active
  FROM promo_codes WHERE code = 'WELCOME10'`);

if (users.length) {
  console.log('\n=== 6. CODE ISSUED TO THIS USER ===');
  if (tbl[0].n > 0) {
    show(await sql`
      SELECT code, expires_at, redeemed_at, created_at
      FROM welcome_promo_issues WHERE user_id = ${users[0].id}`);
  } else {
    console.log('  (table missing — no code can exist)');
  }
}

/* --- 7. Why did the enqueue fail? ----------------------------------------- */
// Reproduces enqueueEmail()'s exact INSERT. This is the one probe that can fail
// for a reason the ledger cannot show: enqueueEmail swallows its error by
// design (an email must never roll back a signup), so when it rejects, the
// ONLY evidence is its console.log — which is invisible if you did not run the
// dev server. Attempting the insert here surfaces the SQLSTATE.
console.log('\n=== 8. REPLAY THE ENQUEUE ===');
if (users.length) {
  const key = `welcome_email/PROBE-${Date.now()}`;
  const payload = JSON.stringify({ customerName: 'probe' });

  // (a) Literal values, as my earlier probe did.
  try {
    const r = await sql`
      INSERT INTO email_jobs (flow, "to", payload, dedupe_key)
      VALUES ('welcome_email', ${email}, ${payload}::jsonb, ${key})
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id`;
    console.log(`  (a) literal values: OK id=${r[0]?.id ?? '(conflict)'}`);
    await sql`DELETE FROM email_jobs WHERE dedupe_key = ${key}`;
  } catch (err) {
    console.log(`  (a) literal values: FAILED ${err.message}`);
  }

  // (b) Bound parameters — how Drizzle actually sends them. This is the one
  // that matters, and the one that differs from (a).
  const key2 = `${key}-B`;
  try {
    const r = await sql.query(
      `INSERT INTO email_jobs (flow, "to", payload, dedupe_key)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      ['welcome_email', email, payload, key2]
    );
    console.log(`  (b) bound params:   OK id=${r[0]?.id ?? '(conflict)'}`);
    await sql`DELETE FROM email_jobs WHERE dedupe_key = ${key2}`;
  } catch (err) {
    console.log(`  (b) bound params:   FAILED ${err.message}`);
    console.log(`      code: ${err.code ?? '(none)'}`);
    console.log(
      '      ^^ this is what enqueueEmail hits. Postgres cannot infer the type of' +
        '\n         a parameter compared against `flow IN (...)` / the ANY(ARRAY).'
    );
  }
}

/* --- 8. Provider config ---------------------------------------------------- */
console.log('\n=== 7. RESEND CONFIG (.env.local) ===');
const envText = readFileSync('.env.local', 'utf8');
for (const key of ['RESEND_API_KEY', 'RESEND_FROM', 'RESEND_WEBHOOK_SECRET']) {
  const line = envText.split('\n').find(l => l.trim().startsWith(`${key}=`));
  const val = line?.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
  console.log(
    `  ${key}: ${val ? `set (${val.length} chars, starts ${val.slice(0, 8)})` : 'NOT SET'}`
  );
}
console.log(
  '\n  RESEND_API_KEY unset means sendEmail() logs a warning and returns' +
    '\n  skipped — the job settles as SENT but nothing is ever sent.'
);