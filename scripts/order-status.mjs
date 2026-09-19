// One-off admin script: list cart items.
// Usage:
//   npx tsx --env-file-if-exists=.env.local scripts/list-cart.mjs <cart-id>
import { neon } from '@neondatabase/serverless';

const client = neon(process.env.adore_DATABASE_URL);

const [cartId] = process.argv.slice(2);

if (!cartId) {
  console.error('Usage: npx tsx --env-file-if-exists=.env.local scripts/list-cart.mjs <cart-id>');
  process.exit(1);
}

async function listCart() {
  const rows = await client`
    SELECT ci.id, ci.variant_id, ci.quantity, v.stock_quantity AS stock
    FROM cart_items ci
    LEFT JOIN product_variants v ON v.id = ci.variant_id
    WHERE ci.cart_id = ${cartId}
    ORDER BY ci.created_at ASC
  `;

  console.log(`Cart items (${rows.length}):`);
  console.table(
    rows.map(r => ({
      variant_id: r.variant_id,
      quantity: r.quantity,
      stock: r.stock,
    }))
  );
}

listCart().catch(err => {
  console.error(err);
  process.exit(1);
});