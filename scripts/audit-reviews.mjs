// audit-reviews.mjs — READ-ONLY. Reports what is in `product_reviews` and,
// crucially, WHICH of those rows would survive the verified-buyer gate.
//
// This exists because "delete the previous reviews" has two very different
// meanings, and picking the wrong one is irreversible:
//
//   A. Delete ONLY reviews that fail the verified-purchase check. The rows that
//      are not attached to any real, non-cancelled/non-refunded order. This is
//      the one you want if the goal is "purge anything the new rule would have
//      rejected" — legitimate buyer reviews survive.
//   B. Delete ALL reviews, including genuine verified-buyer ones. This throws
//      away real customers' words along with the junk.
//
// Run with --scope=unverified to see exactly what A would remove (still only
// reports; it never deletes — see purge-reviews.mjs for that).
//
// Usage: node scripts/audit-reviews.mjs
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

const totals = await sql`
  SELECT
    COUNT(*)::int                                    AS total,
    COUNT(*) FILTER (WHERE is_approved)::int          AS approved,
    COUNT(*) FILTER (WHERE NOT is_approved)::int      AS unapproved,
    COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '30 days')::int AS older_than_30d
  FROM product_reviews`;

const t = totals[0];
console.log('=== product_reviews ===');
console.log(`  total:              ${t.total}`);
console.log(`  approved:           ${t.approved}`);
console.log(`  awaiting approval:  ${t.unapproved}`);
console.log(`  older than 30 days: ${t.older_than_30d}`);

if (t.total === 0) {
  console.log('\nNothing to do — the table is already empty.');
  process.exit(0);
}

/**
 * A review "passes the gate" when some customer with a user_id owns an order
 * containing this product that is not CANCELLED/REFUNDED.
 *
 * Matched on author_name, because product_reviews has no user_id column (it
 * predates accounts) — the same soft rule hasAlreadyReviewedProduct() uses.
 * This is why the count below is an APPROXIMATION, and it is reported as such.
 */
const classified = await sql`
  SELECT
    r.id,
    r.author_name,
    r.rating,
    r.is_approved,
    r.created_at,
    EXISTS (
      SELECT 1
      FROM order_items oi
      JOIN orders o    ON o.id  = oi.order_id
      JOIN customers c ON c.id  = o.customer_id
      WHERE c.user_id IS NOT NULL
        AND oi.product_id = r.product_id
        AND o.status NOT IN ('CANCELLED', 'REFUNDED')
    ) AS has_verified_purchase
  FROM product_reviews r
  ORDER BY r.created_at DESC`;

const verified = classified.filter(r => r.has_verified_purchase);
const unverified = classified.filter(r => !r.has_verified_purchase);

console.log(`\n=== would survive the verified-buyer gate: ${verified.length} ===`);
console.log(`=== would be REMOVED by a verified-buyer purge: ${unverified.length} ===`);

if (unverified.length > 0) {
  console.log('\nRows that fail the gate:');
  for (const r of unverified) {
    console.log(
      `  ${r.id}  "${r.author_name}"  ${r.rating}*  ` +
        `[${r.is_approved ? 'approved' : 'unapproved'}]  ${r.created_at}`
    );
  }
}

if (verified.length > 0) {
  console.log('\nRows that pass the gate (real customers — do NOT bulk-delete):');
  for (const r of verified) {
    console.log(
      `  ${r.id}  "${r.author_name}"  ${r.rating}*  ` +
        `[${r.is_approved ? 'approved' : 'unapproved'}]  ${r.created_at}`
    );
  }
}

console.log(
  '\nNote: the gate is matched on author_name, not user_id, so a name collision\n' +
    'can misclassify a row. Read the lists above before choosing a scope.'
);

// Per-product breakdown, so "the review for X" can be resolved to a row id
// rather than guessed at from the author name.
const byProduct = await sql`
  SELECT p.id, p.name, p.slug, COUNT(r.id)::int AS review_count
  FROM product_reviews r
  JOIN products p ON p.id = r.product_id
  GROUP BY p.id, p.name, p.slug
  ORDER BY review_count DESC, p.name`;

console.log('\n=== reviews by product ===');
for (const p of byProduct) {
  console.log(`  ${String(p.review_count).padStart(3)} review(s)  ${p.name}  (/products/${p.slug})`);
}

console.log('\n=== every review, with its product ===');
const detail = await sql`
  SELECT r.id, r.author_name, r.rating, r.is_approved, r.created_at,
         p.name AS product_name, p.slug AS product_slug
  FROM product_reviews r
  JOIN products p ON p.id = r.product_id
  ORDER BY r.created_at DESC`;
for (const r of detail) {
  console.log(
    `  ${r.id}\n` +
      `      author:  "${r.author_name}"  ${r.rating}*  ` +
      `[${r.is_approved ? 'approved' : 'unapproved'}]\n` +
      `      product: ${r.product_name}  (/products/${r.product_slug})\n` +
      `      posted:  ${r.created_at}`
  );
}

/**
 * SANITY CHECK — if "everything fails the gate" is the answer, the likelier
 * explanation is a broken join than three coincidences. Verify the tables the
 * gate depends on actually contain linked rows, so a false negative here is
 * ruled out before anyone deletes anything.
 */
const [orderCounts, linkedOrders] = await Promise.all([
  sql`
    SELECT
      (SELECT COUNT(*)::int FROM orders)         AS orders,
      (SELECT COUNT(*)::int FROM order_items)    AS order_items,
      (SELECT COUNT(*)::int FROM customers)      AS customers,
      (SELECT COUNT(*)::int FROM customers WHERE user_id IS NOT NULL) AS customers_with_user`,
  sql`
    SELECT COUNT(DISTINCT oi.product_id)::int AS products_bought
    FROM order_items oi
    JOIN orders o     ON o.id  = oi.order_id
    JOIN customers c ON c.id  = o.customer_id
    WHERE c.user_id IS NOT NULL
      AND o.status NOT IN ('CANCELLED', 'REFUNDED')`,
]);

const oc = orderCounts[0];
console.log('\n=== gate sanity check ===');
console.log(`  orders:                      ${oc.orders}`);
console.log(`  order_items:                 ${oc.order_items}`);
console.log(`  customers:                   ${oc.customers}`);
console.log(`  customers with a user_id:    ${oc.customers_with_user}`);
console.log(`  products with a verified buy: ${linkedOrders[0].products_bought}`);

if (linkedOrders[0].products_bought === 0) {
  console.log(
    '\n  WARNING: NO product has a verified purchase at all. Every review will\n' +
      '  be classified as unverified because the join has nothing to match —\n' +
      '  not because the reviewers were fraudulent. Check whether orders are\n' +
      '  linked to accounts via customers.user_id before purging.'
  );
}