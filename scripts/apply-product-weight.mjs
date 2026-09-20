// apply-product-weight.mjs — one-off: add products.weight_grams and verify.
// Usage: node scripts/apply-product-weight.mjs
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

await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_grams integer`;

const cols = await sql`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'products' AND column_name = 'weight_grams'`;
console.log('weight_grams column:', cols[0] ?? 'STILL MISSING');

const counts = await sql`
  SELECT COUNT(*) AS total,
         COUNT(weight_grams) AS with_weight
  FROM products`;
console.log('products:', counts[0]);