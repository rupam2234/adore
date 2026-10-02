// diagnose-product-create.mjs — READ-ONLY diagnostic for the admin product
// create 500 ("Failed to create product"). Checks that every column and
// constraint the create path names actually exists in the live database.
//
// Usage: node scripts/diagnose-product-create.mjs
//
// Safe: SELECT-only against information_schema / pg_catalog. No writes.
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

// Every column each write in createProduct() names explicitly. Drizzle emits
// named columns in the INSERT, so a missing one is a hard 500 ("column does
// not exist") even when the value is null.
const EXPECTED = {
  products: [
    'id', 'name', 'slug', 'short_description', 'details', 'story', 'material',
    'fit', 'care_instructions', 'status', 'is_featured', 'weight_grams',
    'created_at', 'updated_at',
  ],
  product_variants: [
    'id', 'product_id', 'sku', 'color', 'color_hex', 'size', 'price',
    'compare_at_price', 'currency', 'stock_quantity', 'is_active',
    'created_at', 'updated_at',
  ],
  product_categories: ['product_id', 'category_id'],
  categories: ['id', 'slug', 'name'],
};

let problems = 0;

for (const [table, expected] of Object.entries(EXPECTED)) {
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  const actual = new Set(rows.map(r => r.column_name));
  const missing = expected.filter(c => !actual.has(c));

  if (missing.length === 0) {
    console.log(`OK   ${table}: all ${expected.length} columns present`);
  } else {
    problems++;
    console.log(`FAIL ${table}: MISSING -> ${missing.join(', ')}`);
  }
}

// syncVariants() uses ON CONFLICT (product_id, color, size). Postgres requires
// an actual unique index on exactly those columns, or the upsert raises
// "there is no unique or exclusion constraint matching the ON CONFLICT
// specification". schema.ts declares one, but with no migration pipeline it
// has to have been created by hand.
const conflictIdx = await sql`
  SELECT indexdef FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'product_variants'
    AND indexdef ILIKE '%UNIQUE%'`;
const hasConflictTarget = conflictIdx.some(r =>
  /product_id/i.test(r.indexdef) &&
  /color/i.test(r.indexdef) &&
  /\bsize\b/i.test(r.indexdef)
);
if (hasConflictTarget) {
  console.log('OK   product_variants: unique index covers (product_id, color, size)');
} else {
  problems++;
  console.log('FAIL product_variants: NO unique index on (product_id, color, size)');
  console.log('     -> ON CONFLICT in syncVariants() cannot resolve.');
  console.log('     existing unique indexes:', conflictIdx.map(r => r.indexdef));
}

// products.slug must stay unique (uniqueSlug() relies on it to append -2, -3).
const slugIdx = await sql`
  SELECT indexdef FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'products' AND indexdef ILIKE '%UNIQUE%'`;
if (slugIdx.some(r => /slug/i.test(r.indexdef))) {
  console.log('OK   products: unique constraint on slug');
} else {
  problems++;
  console.log('WARN products: no unique index on slug — uniqueSlug() cannot dedupe.');
}

console.log(
  problems === 0
    ? '\nAll checks passed — schema is not the cause. Read the "admin create failed:" line in the dev-server console for the real driver error.'
    : `\n${problems} problem(s) found above. Each is fixable by running the matching idempotent statement in scripts/.`
);