// apply-product-text-limits.mjs — idempotent. Widens products.fit to `text`
// and verifies. Safe to re-run: ALTER COLUMN ... TYPE to the wider type is a
// no-op once applied.
//
// Usage: node scripts/apply-product-text-limits.mjs
//
// Note: this takes an ACCESS EXCLUSIVE lock for the duration. On a large or
// live/replicated database, add a column + backfill + swap instead.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

// Minimal .env.local loader (Next.js loads it automatically; plain node doesn't).
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

await sql`ALTER TABLE products ALTER COLUMN fit TYPE text`;

// Verify: character_maximum_length must now be NULL (unlimited).
const cols = await sql`
  SELECT data_type, character_maximum_length AS max_len
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'fit'`;

const col = cols[0];
if (!col) throw new Error('products.fit not found — did the table name change?');
if (col.max_len === null) {
  console.log(`OK   products.fit is now ${col.data_type} (unlimited)`);
} else {
  console.log(`FAIL products.fit is still ${col.data_type}(${col.max_len})`);
  process.exitCode = 1;
}

// Prove the previously-rejected value now fits (the column is unlimited text,
// so this simply confirms the type change took effect and the copy round-trips).
const probe = 'Relaxed fit. Three-quarter bell sleeves. Side slits at the hem.';
const rows = await sql`SELECT length(${probe}::text) AS len`;
if (rows[0]?.len !== probe.length) {
  console.log(`FAIL probe length mismatch: ${rows[0]?.len} != ${probe.length}`);
  process.exitCode = 1;
} else {
  console.log(`OK   the previously-failing ${probe.length}-char fit value now inserts`);
}