// purge-reviews.mjs — DESTRUCTIVE. Deletes rows from `product_reviews`.
//
// Two safeguards, because this cannot be undone:
//
//   1. A JSON backup of every row is written BEFORE the delete and its path is
//      printed. Restoring is a documented `insert` away.
//   2. Nothing happens unless --confirm is passed, and the scope must be one of
//      the two named below. There is deliberately no "delete everything" default.
//
// SCOPES — read scripts/audit-reviews.mjs output first, it shows both counts:
//
//   --scope=unverified  Delete only reviews with no verified purchase behind
//                       them (the rows the new gate rejects). Real customer
//                       reviews survive.
//
//   --scope=all         Delete EVERY review, including genuine verified-buyer
//                       ones. Use only for a genuine content reset.
//
//   --id=<uuid>         Delete exactly ONE review, identified by its primary
//                       key. This is the precise option — "remove the review on
//                       the Kurti" should be resolved to a row id by
//                       audit-reviews.mjs first, never matched by name, since
//                       author_name is not unique.
//
// Usage:
//   node scripts/purge-reviews.mjs --scope=unverified --confirm
//   node scripts/purge-reviews.mjs --id=3602f0eb-9b53-4359-9342-f8df42b113cf --confirm
//
// Restoring a backup (re-inserts the exact rows that were deleted):
//
//   node scripts/purge-reviews.mjs --restore=scripts/reviews-backup-<stamp>.json
import { readFileSync, writeFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const args = process.argv.slice(2);
const scope = args.find(a => a.startsWith('--scope='))?.split('=')[1];
const onlyId = args.find(a => a.startsWith('--id='))?.split('=')[1];
const confirmed = args.includes('--confirm');
const restoreFrom = args.find(a => a.startsWith('--restore='))?.split('=').slice(1).join('=');

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

// ---------------------------------------------------------------------------
// Restore path — takes precedence, and needs no --confirm.
// ---------------------------------------------------------------------------
if (restoreFrom) {
  const backup = JSON.parse(readFileSync(restoreFrom, 'utf8'));
  const rows = backup.rows ?? [];
  if (rows.length === 0) {
    console.log('Backup contains no rows — nothing to restore.');
    process.exit(0);
  }

  // ON CONFLICT DO NOTHING: restoring a backup twice must not explode on the
  // primary key, and must never clobber a review written since the purge.
  let restored = 0;
  for (const r of rows) {
    const res = await sql`
      INSERT INTO product_reviews
        (id, product_id, rating, title, body, author_name, size_purchased,
         fit_feedback, helpful_count, is_approved, created_at, updated_at)
      VALUES
        (${r.id}, ${r.product_id}, ${r.rating}, ${r.title}, ${r.body},
         ${r.author_name}, ${r.size_purchased}, ${r.fit_feedback},
         ${r.helpful_count}, ${r.is_approved}, ${r.created_at}, ${r.updated_at})
      ON CONFLICT (id) DO NOTHING
      RETURNING id`;
    if (res.length > 0) restored += 1;
  }

  const [{ remaining }] = await sql`
    SELECT COUNT(*)::int AS remaining FROM product_reviews`;
  console.log(
    `Restored ${restored} of ${rows.length} row(s) from ${restoreFrom}.\n` +
      `(${rows.length - restored} already existed and were left untouched.)\n` +
      `${remaining} review(s) now in product_reviews.`
  );
  process.exit(0);
}

if (!onlyId && (!scope || !['unverified', 'all'].includes(scope))) {
  console.error(
    'Refusing to run: pass --id=<uuid>, or --scope=unverified / --scope=all.\n' +
      'Run `node scripts/audit-reviews.mjs` first to see what each would remove.'
  );
  process.exit(1);
}
if (!onlyId && !confirmed) {
  console.error(
    'Refusing to run without --confirm.\n' +
      'This permanently deletes review rows. See the header of this file.'
  );
  process.exit(1);
}

// Fail fast on a pasted typo or a truncated id. The id is bound as a query
// parameter below (never interpolated), so this is a usability guard that turns
// a confusing "0 rows matched" into an obvious error message.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (onlyId && !UUID_RE.test(onlyId)) {
  console.error(`Refusing to run: "${onlyId}" is not a valid review id (uuid).`);
  process.exit(1);
}

/** Same predicate the application gate uses (utils/reviews.ts). */
const UNVERIFIED_PREDICATE = sql`
  NOT EXISTS (
    SELECT 1
    FROM order_items oi
    JOIN orders o     ON o.id  = oi.order_id
    JOIN customers c ON c.id  = o.customer_id
    WHERE c.user_id IS NOT NULL
      AND oi.product_id = r.product_id
      AND o.status NOT IN ('CANCELLED', 'REFUNDED')
  )`;

// Tagged templates bind parameters, so the id is never interpolated into SQL
// text. The uuid check above stays as a fail-fast guard against a pasted typo.
const match = onlyId ? sql`r.id = ${onlyId}` : scope === 'all' ? sql`TRUE` : UNVERIFIED_PREDICATE;

// --- Backup first. A delete with no way back is not a safe operation. -------
const doomed = await sql`
  SELECT r.id, r.product_id, r.rating, r.title, r.body, r.author_name,
         r.size_purchased, r.fit_feedback, r.helpful_count, r.is_approved,
         r.created_at, r.updated_at,
         p.name AS product_name
  FROM product_reviews r
  LEFT JOIN products p ON p.id = r.product_id
  WHERE ${match}`;

if (doomed.length === 0) {
  console.log('Nothing matched — no rows deleted.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `scripts/reviews-backup-${stamp}.json`;
writeFileSync(
  backupPath,
  JSON.stringify(
    { scope: onlyId ? `id:${onlyId}` : scope, exportedAt: new Date().toISOString(), rows: doomed },
    null,
    2
  )
);

console.log(`Backed up ${doomed.length} row(s) -> ${backupPath}`);
for (const r of doomed) {
  console.log(`  ${r.id}  "${r.author_name}"  ${r.rating}*  on ${r.product_name}`);
}

if (!onlyId && scope === 'unverified') {
  console.log(
    '\nNOTE: these were removed for having no verified purchase. If the orders\n' +
      'table is empty, that is a DATA GAP, not fraud — check audit-reviews.mjs.'
  );
}

// --- Delete, then verify the row count actually moved. ----------------------
const deleted = await sql`
  DELETE FROM product_reviews r WHERE ${match} RETURNING r.id`;

const [{ remaining }] = await sql`
  SELECT COUNT(*)::int AS remaining FROM product_reviews`;

console.log(`\nDeleted ${deleted.length} row(s). ${remaining} review(s) remain.`);
console.log(`To restore: node scripts/purge-reviews.mjs --restore=${backupPath}`);