// verify-cart-query.mjs — proves the weighted cart SELECT parses & executes
// against the live schema (fake cart id → 0 rows, but no column errors).
// Usage: node scripts/verify-cart-query.mjs
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

const sql = neon(url);

const rows = await sql`
  SELECT
    ci.id,
    p.id AS product_id,
    p.weight_grams AS weight_grams,
    v.stock_quantity AS stock,
    ci.quantity
  FROM cart_items ci
  JOIN product_variants v ON v.id = ci.variant_id AND v.is_active
  JOIN products p ON p.id = v.product_id AND p.status = 'ACTIVE'
  WHERE ci.cart_id = '00000000-0000-0000-0000-000000000000'
  ORDER BY ci.created_at ASC`;

console.log('weighted cart query OK, rows:', rows.length);