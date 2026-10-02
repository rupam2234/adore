// check-orphans.mjs — READ-ONLY. createProduct() runs three sequential writes
// with no transaction (neon-http cannot open one). Before the compensating
// rollback was added, a mid-pipeline failure left a DRAFT product row behind
// with no variants — invisible on the storefront but cluttering the admin list
// and consuming a slug, so the next retry produced "name-2".
//
// Usage: node scripts/check-orphans.mjs
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

const orphans = await sql`
  SELECT p.id, p.name, p.slug, p.status, p.created_at
  FROM products p
  LEFT JOIN product_variants v ON v.product_id = p.id
  GROUP BY p.id, p.name, p.slug, p.status, p.created_at
  HAVING COUNT(v.id) = 0
  ORDER BY p.created_at DESC`;

if (orphans.length === 0) {
  console.log('OK   no variant-less products — nothing was left half-written.');
} else {
  console.log(`FOUND ${orphans.length} product(s) with no variants:`);
  for (const o of orphans) console.log(' ', o);
  console.log('\nThese are safe to delete if they were abandoned mid-create.');
}

const all = await sql`SELECT slug, status, created_at FROM products ORDER BY created_at DESC`;
console.log('\nAll products:');
for (const p of all) console.log(`  ${p.slug}  [${p.status}]  ${p.created_at}`);