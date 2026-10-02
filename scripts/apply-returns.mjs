// apply-returns.mjs — applies scripts/add-returns.sql to the configured Neon
// database, and verifies the result.
//
//   node scripts/apply-returns.mjs            → dry run (default, no writes)
//   node scripts/apply-returns.mjs --apply    → executes the DDL
//
// DRY RUN IS THE DEFAULT ON PURPOSE. Every statement in add-returns.sql is
// additive and idempotent, so re-running is harmless — but nobody should be
// able to fire DDL at production by forgetting a flag, and nobody should have
// to read a diff to find out what would change. Run dry first, read it, then
// pass --apply deliberately.

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const APPLY = process.argv.includes('--apply');

// Minimal .env.local loader (Next.js loads it automatically; plain node doesn't).
function databaseUrl() {
  let url = process.env.adore_DATABASE_URL;
  if (!url) {
    const env = readFileSync('.env.local', 'utf8');
    const line = env
      .split('\n')
      .find(l => l.trim().startsWith('adore_DATABASE_URL='));
    url = line
      ?.split('=')[1]
      ?.trim()
      .replace(/^["']|["']$/g, '');
  }
  if (!url) throw new Error('adore_DATABASE_URL not found');
  return url;
}

const sql = neon(databaseUrl());
const ddl = readFileSync('scripts/add-returns.sql', 'utf8');

// --- Pre-flight: what would this touch? -------------------------------------

// Lock duration scales with table size, so surface the row count BEFORE the
// ALTERs rather than discovering it afterwards. orders is tiny in practice,
// but on a large dataset the ACCESS EXCLUSIVE lock is a real consideration.
const counts = await sql`
  SELECT (SELECT COUNT(*) FROM orders)::int      AS orders,
         (SELECT COUNT(*) FROM order_items)::int AS order_items`;
console.log(
  '[preflight] orders:',
  counts[0].orders,
  '| order_items:',
  counts[0].order_items
);

// Drizzle's neon-http driver speaks the extended query protocol, which allows
// exactly ONE statement per round-trip. So the file has to be split into
// individual statements and replayed in order.
//
// Two things make a naive split(';') wrong:
//   - the `DO $$ ... $$` constraint block contains semicolons of its own;
//   - a `$`-quoted body must survive the round-trip byte-for-byte.
// So dollar-quoted blocks are masked to an inert sentinel (which itself contains
// no semicolon) before splitting, then restored. The trailing ';' of each block
// is preserved on the sentinel, otherwise the following statement is glued onto
// the same chunk.
const SENTINEL = '__DQ_BLOCK__';
const blocks = [];

let masked = ddl
  .replace(/^\s*--.*$/gm, '')
  .replace(/(\$\$[\s\S]*?\$\$)/g, (_m, body) => {
    blocks.push(body);
    return `${SENTINEL}${blocks.length - 1}${SENTINEL};`;
  });

const statements = masked
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0)
  .map(s =>
    s.replace(
      new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'),
      (_m, i) => blocks[Number(i)]
    )
  );

console.log(
  `[preflight] ${statements.length} statement(s) parsed from add-returns.sql`
);

// Guard against a bad split silently dropping schema objects. Every table and
// column this script creates must appear in the parsed statement list.
const REQUIRED_OBJECTS = [
  'return_requests',
  'refunds',
  'delivered_at',
  'returned_qty',
];
const haystack = statements.join('\n').toLowerCase();
const missing = REQUIRED_OBJECTS.filter(o => !haystack.includes(o));
if (missing.length) {
  console.error(
    `[preflight] PARSE INCOMPLETE — these objects were not found in the parsed statements: ${missing.join(', ')}`
  );
  console.error('[preflight] refusing to continue; the SQL file needs fixing.');
  process.exit(1);
}
console.log(
  '[preflight] all expected tables/columns present in the parsed statements.'
);

// Classify risk on a whitespace-collapsed copy. Testing the raw text lets `\s+`
// match a newline and backtrack, which makes every multi-line ADD COLUMN look
// like a destructive ALTER.
const destructive = statements.filter(s => {
  const flat = s.replace(/\s+/g, ' ').trim().toUpperCase();
  if (/^(DROP|TRUNCATE|DELETE|UPDATE)\b/.test(flat)) return true;
  // ALTER that does anything other than ADD COLUMN is schema-destructive.
  if (/^ALTER TABLE /.test(flat))
    return !/^ALTER TABLE \S+ ADD COLUMN/.test(flat);
  // CREATE OR REPLACE FUNCTION / TRIGGER are additive: they add an object that
  // did not exist, or replace one with the same signature. Phase 3 of
  // add-returns.sql adds a terminal-state trigger this way, and refusing it
  // would make the script's own documented safety rule wrong.
  if (/^CREATE OR REPLACE FUNCTION /.test(flat)) return false;
  if (/^CREATE TRIGGER /.test(flat)) return false;
  return false;
});

if (destructive.length) {
  console.error(
    '[preflight] REFUSING — statements that alter or remove existing data:'
  );
  destructive.forEach(s => console.error('   ', s.slice(0, 120)));
  process.exit(1);
}
console.log('[preflight] all statements additive (CREATE / ADD COLUMN only).');

if (!APPLY) {
  console.log('\n=== DRY RUN — nothing was written ===\n');
  statements.forEach((s, i) => {
    console.log(`--- ${i + 1}/${statements.length} ---`);
    console.log(s.length > 400 ? `${s.slice(0, 400)}\n  …(truncated)` : s);
  });
  console.log('\nRe-run with --apply to execute.');
  process.exit(0);
}

// --- Apply ------------------------------------------------------------------

console.log('\n=== APPLYING ===');
for (const [i, statement] of statements.entries()) {
  try {
    await sql.query(statement);
    console.log(`  ok  ${i + 1}/${statements.length}`);
  } catch (error) {
    // A partial failure leaves earlier statements applied. They are all
    // IF NOT EXISTS / guarded, so re-running is safe — say so explicitly
    // rather than leaving the operator guessing.
    console.error(`  FAIL ${i + 1}/${statements.length}:`, error.message);
    console.error(
      '\nPartial apply. Every statement is idempotent, so fix the cause and re-run.'
    );
    process.exit(1);
  }
}

// --- Verify -----------------------------------------------------------------

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN ('return_requests','refunds')
  ORDER BY table_name`;
console.log('\ntables:', tables.map(t => t.table_name).join(', ') || 'NONE');

const cols = await sql`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema = 'public'
    AND ((table_name = 'orders' AND column_name = 'delivered_at')
      OR (table_name = 'order_items' AND column_name = 'returned_qty'))`;
for (const c of cols) console.log(`column: ${c.table_name}.${c.column_name}`);

const indexes = await sql`
  SELECT indexname FROM pg_indexes
  WHERE schemaname = 'public' AND tablename IN ('return_requests','refunds')
  ORDER BY indexname`;
console.log('\nindexes:');
for (const i of indexes) console.log('  ', i.indexname);
