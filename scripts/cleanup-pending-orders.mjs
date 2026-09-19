import { rawQuery, sql } from '../utils/db.js';

// Find and list PENDING orders
const orders = await rawQuery(sql`
  SELECT
    o.id,
    o.order_number,
    o.status,
    o.customer_id,
    o.total_amount,
    o.created_at,
    COUNT(r.id) AS reservation_count,
    (SELECT cart_id FROM stock_reservations r2 WHERE r2.order_id = o.id LIMIT 1) AS linked_cart_id
  FROM orders o
  LEFT JOIN stock_reservations r ON r.order_id = o.id
  WHERE o.status = 'PENDING'
  GROUP BY o.id
  ORDER BY o.created_at ASC
`);

console.log(`\nFound ${orders.length} PENDING order(s):\n`);

for (const o of orders) {
  console.log(`  ID:            ${o.id}`);
  console.log(`  Order Number:  ${o.order_number}`);
  console.log(`  Customer ID:   ${o.customer_id}`);
  console.log(`  Total:         ${o.total_amount}`);
  console.log(`  Created:       ${o.created_at}`);
  console.log(`  Reservations:  ${o.reservation_count}`);
  console.log(`  Linked Cart:   ${o.linked_cart_id ?? 'NONE (orphaned)'}`);
  console.log(`  ---`);
}

if (orders.length === 0) {
  console.log('No PENDING orders found. Nothing to clean up.\n');
  process.exit(0);
}

// Check if any are orphaned (no linked cart)
const orphaned = orders.filter(o => !o.linked_cart_id);
if (orphaned.length > 0) {
  console.log(`\n⚠ ${orphaned.length} orphaned PENDING order(s) — no cart attached:`);
  for (const o of orphaned) {
    console.log(`    ${o.order_number} (ID: ${o.id})`);
  }
  console.log('');
}

// Delete all PENDING orders and release their stock
for (const o of orders) {
  // Delete the order
  await rawQuery(sql`DELETE FROM orders WHERE id = ${o.id}`);

  // Release reservations and return stock
  await rawQuery(sql`
    WITH released AS (
      DELETE FROM stock_reservations
      WHERE order_id = ${o.id}
      RETURNING variant_id, quantity
    )
    UPDATE product_variants v
    SET stock_quantity = v.stock_quantity + r.quantity,
        updated_at = now()
    FROM released r
    WHERE v.id = r.variant_id
  `);

  // Clean up order items
  await rawQuery(sql`DELETE FROM order_items WHERE order_id = ${o.id}`);

  console.log(`✓ Deleted PENDING order: ${o.order_number} (ID: ${o.id}) — stock released`);
}

// Final check
const remaining = await rawQuery(sql`
  SELECT COUNT(*) AS count FROM orders WHERE status = 'PENDING'
`);
console.log(`\nRemaining PENDING orders: ${remaining[0]?.count ?? 0}`);
console.log('Done.\n');