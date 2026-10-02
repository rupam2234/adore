// Read-only schema inspector. Used to confirm what is actually deployed rather
// than what the .sql file claims, and to discover the exact NOT NULL / CHECK
// constraints fixtures must satisfy.
//
// Run: node scripts/inspect-schema.mjs
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const env = readFileSync('.env.local', 'utf8');
const url = env
  .split('\n')
  .find(l => l.trim().startsWith('adore_DATABASE_URL='))
  .split('=')
  .slice(1)
  .join('=')
  .trim()
  .replace(/^["']|["']$/g, '');
const sql = neon(url);

const cols = async (table) =>
  (
    await sql`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position`
  ).map(r => `${r.column_name}${r.is_nullable === 'NO' ? '*' : ''}`);

const checks = async (table) =>
  (
    await sql`
    SELECT conname, pg_get_constraintdef(oid) AS d
    FROM pg_constraint
    WHERE conrelid = ${table}::regclass AND contype = 'c'
    ORDER BY conname`
  ).map(r => `${r.conname}: ${r.d}`);

const out = {};
for (const t of ['users', 'customers', 'products', 'product_variants', 'orders', 'order_items']) {
  out[t] = { columns: await cols(t), checks: await checks(t) };
}
console.log(JSON.stringify(out, null, 2));
