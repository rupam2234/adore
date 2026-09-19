// One-off admin script: restore a PENDING order's items to the cart.
// Usage:
//   npx tsx --env-file-if-exists=.env.local scripts/restore-order-to-cart.mjs <order-id-or-number>
import { neon } from '@neondatabase/serverless';

const client = neon(process.env.adore_DATABASE_URL);

const [target] = process.argv.slice(2);

if (!target) {
  console.error('Usage: npx tsx --env-file-if-exists=.env.local scripts/restore-order-to-cart.mjs <order-id-or-number>');
  process.exit(1);
}

async function restoreOrderToCart() {
  const key = String(target);

  // Find the PENDING order
  const orders = await client`
    SELECT id, order_number, customer_id
    FROM orders
    WHERE id = ${key} OR order_number = ${key}
  `;

  if (orders.length === 0) {
    console.error('Order not found');
    process.exit(1);
  }

  const order = orders[0];
  console.log('Found order:', order.order_number, 'id:', order.id);

  // Get the order items
  const items = await client`
    SELECT variant_id, quantity
    FROM order_items
    WHERE order_id = ${order.id}
  `;

  if (items.length === 0) {
    console.error('No items in this order');
    process.exit(1);
  }

  console.log(`Found ${items.length} item(s) to restore to cart`);

  // Find the user_id for this customer
  const customerRows = await client`
    SELECT user_id FROM customers WHERE id = ${order.customer_id} LIMIT 1
  `;
  const userId = customerRows[0]?.user_id;
  if (!userId) {
    console.error('No user found for this customer');
    process.exit(1);
  }
  console.log('User ID:', userId);

  // Find or create a cart for this user
  let cart = await client`
    SELECT id FROM carts WHERE user_id = ${userId} LIMIT 1
  `;

  let cartId;
  if (cart.length === 0) {
    // Create a new cart
    const randomToken = Array.from({ length: 32 }, () =>
      Math.random().toString(36)[2]
    ).join('');
    const result = await client`
      INSERT INTO carts (id, token, user_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${randomToken}, ${order.customer_id}, now(), now())
      RETURNING id
    `;
    cartId = result[0].id;
    console.log('Created new cart:', cartId);
  } else {
    cartId = cart[0].id;
    console.log('Using existing cart:', cartId);
  }

  // Clear existing items in this cart
  await client`DELETE FROM cart_items WHERE cart_id = ${cartId}`;

  // Insert the order items as cart items
  for (const item of items) {
    await client`
      INSERT INTO cart_items (id, cart_id, variant_id, quantity)
      VALUES (gen_random_uuid(), ${cartId}, ${item.variant_id}, ${item.quantity})
    `;
  }

  console.log(`✓ Restored ${items.length} item(s) to cart: ${cartId}`);
}

restoreOrderToCart().catch(err => {
  console.error(err);
  process.exit(1);
});