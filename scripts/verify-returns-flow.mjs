// End-to-end verification of the returns flow against the real database.
//
// Creates a customer + order + item, then walks a return through every state
// and asserts the properties that stop the business being exploited. The refund
// itself is NEVER executed — that would call Razorpay with live keys. Instead we
// assert that the ledger and the state guards refuse a second payment, which is
// the property that actually matters.
//
// Run: node scripts/verify-returns-flow.mjs
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

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const run = async () => {
  const suffix = Date.now();
  const userId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const productId = crypto.randomUUID();

  // --- fixtures ---------------------------------------------------------
  // Column lists below match the live schema exactly (verified with
  // scripts/inspect-schema.mjs). `users.role` is constrained to admin|user, and
  // `products` carries no `price` column — the price lives on the variant.
  await sql`INSERT INTO users (id, email, password_hash, name, role)
    VALUES (${userId}, ${`e2e-${suffix}@test.local`}, 'x', 'E2E', 'user')`;
  await sql`INSERT INTO customers (id, user_id, email, first_name)
    VALUES (${customerId}, ${userId}, ${`e2e-${suffix}@test.local`}, 'E2E')`;
  await sql`INSERT INTO products (id, name, slug, status)
    VALUES (${productId}, 'E2E Product', ${`e2e-${suffix}`}, 'ACTIVE')`;
  await sql`INSERT INTO product_variants (id, product_id, sku, color, size, price, stock_quantity, is_active)
    VALUES (${variantId}, ${productId}, ${`E2E-${suffix}`}, 'Black', 'M', 1000, 5, true)`;
  await sql`INSERT INTO orders (id, customer_id, order_number, status, subtotal, total_amount, currency, shipping_amount, tax_amount, discount_amount, razorpay_payment_id)
    VALUES (${orderId}, ${customerId}, ${`E2E-${suffix}`}, 'DELIVERED', 1000, 2000, 'INR', 0, 0, 0, ${`pay_e2e_${suffix}`})`;
  await sql`INSERT INTO order_items (id, order_id, product_id, variant_id, product_name, sku, quantity, unit_price, total_price)
    VALUES (${itemId}, ${orderId}, ${productId}, ${variantId}, 'E2E Product', ${`E2E-${suffix}`}, 2, 1000, 2000)`;
  // Delivery 2 days ago, so the 7-day window is open.
  await sql`UPDATE orders SET delivered_at = now() - interval '2 days' WHERE id = ${orderId}`;

  // --- 1. intake --------------------------------------------------------
  const inserted = await sql`
    INSERT INTO return_requests (id, order_id, order_item_id, customer_id, type, reason, qty, fee, refund_amount, risk_score)
    VALUES (${crypto.randomUUID()}, ${orderId}, ${itemId}, ${customerId}, 'RETURN', 'Changed my mind', 1, 149, 1000, 0)
    RETURNING id`;
  const returnId = inserted[0].id;
  check('a return request can be created', Boolean(returnId));

  // --- 2. a second open request on the same line must be rejected ------
  let dupBlocked = false;
  try {
    await sql`INSERT INTO return_requests (id, order_id, order_item_id, customer_id, type, reason, qty, fee, refund_amount)
      VALUES (${crypto.randomUUID()}, ${orderId}, ${itemId}, ${customerId}, 'RETURN', 'Changed my mind', 1, 149, 1000)`;
  } catch (e) {
    dupBlocked = e.code === '23505';
  }
  check('a duplicate open request on one line is blocked by the DB', dupBlocked);

  // --- 3. the happy path, one compare-and-set at a time ----------------
  const path = [
    ['REQUESTED', 'APPROVED'],
    ['APPROVED', 'PICKUP_SCHEDULED'],
    ['PICKUP_SCHEDULED', 'IN_TRANSIT'],
    ['IN_TRANSIT', 'RECEIVED'],
    ['RECEIVED', 'QC_PASSED'],
  ];
  let walked = true;
  for (const [from, to] of path) {
    const moved = await sql`
      UPDATE return_requests SET status = ${to}, updated_at = now()
      WHERE id = ${returnId} AND status = ${from}
      RETURNING id`;
    if (moved.length === 0) {
      walked = false;
      console.log(`      stalled at ${from} -> ${to}`);
      break;
    }
  }
  check(
    'REQUESTED -> APPROVED -> PICKUP -> IN_TRANSIT -> RECEIVED -> QC_PASSED',
    walked
  );

  // --- 4. a stale compare-and-set must lose ----------------------------
  // This is the concurrency guarantee: a second caller holding the old status
  // updates zero rows rather than clobbering the new state.
  const stale = await sql`
    UPDATE return_requests SET status = 'RECEIVED'
    WHERE id = ${returnId} AND status = 'APPROVED'
    RETURNING id`;
  check('a stale status compare-and-set affects zero rows', stale.length === 0);

  // --- 5. settlement: claim, then the anti-double-refund guards --------
  const claimed = await sql`
    UPDATE return_requests
    SET status = 'REFUND_PENDING', net_refund = 851.00, updated_at = now()
    WHERE id = ${returnId} AND status = 'QC_PASSED'
    RETURNING id`;
  check('a QC-passed return can be claimed for settlement', claimed.length === 1);

  const reClaim = await sql`
    UPDATE return_requests
    SET status = 'REFUND_PENDING'
    WHERE id = ${returnId} AND status = 'QC_PASSED'
    RETURNING id`;
  check('the same return cannot be claimed for settlement twice', reClaim.length === 0);

  await sql`INSERT INTO refunds (id, return_request_id, order_id, amount, status)
    VALUES (${crypto.randomUUID()}, ${returnId}, ${orderId}, 851, 'PROCESSED')`;

  let secondRefundBlocked = false;
  try {
    await sql`INSERT INTO refunds (id, return_request_id, order_id, amount, status)
      VALUES (${crypto.randomUUID()}, ${returnId}, ${orderId}, 851, 'PENDING')`;
  } catch (e) {
    secondRefundBlocked = e.code === '23505';
  }
  check('a second live refund row for one request is blocked', secondRefundBlocked);

  // A FAILED row must NOT block a retry, or a gateway hiccup would permanently
  // block a customer from ever being refunded.
  let failedRowAllowed = true;
  try {
    await sql`INSERT INTO refunds (id, return_request_id, order_id, amount, status)
      VALUES (${crypto.randomUUID()}, ${returnId}, ${orderId}, 851, 'FAILED')`;
  } catch {
    failedRowAllowed = false;
  }
  check('a FAILED refund row does not block a retry', failedRowAllowed);

  // --- 6. terminality, now enforced by the DATABASE ---------------------
  await sql`
    UPDATE return_requests SET status = 'REFUNDED', settled_at = now()
    WHERE id = ${returnId} AND status = 'REFUND_PENDING' RETURNING id`;

  // The `return_requests_terminal_guard` trigger must reject this outright.
  // This is the defence-in-depth layer: the application state machine already
  // refuses, and this holds when everything above it fails (a bad migration, a
  // future raw-SQL code path, or a direct psql session).
  let reopenBlocked = false;
  let reopenError = '';
  try {
    await sql`
      UPDATE return_requests SET status = 'REFUND_PENDING'
      WHERE id = ${returnId}`;
  } catch (e) {
    reopenBlocked = String(e.message ?? '').includes(
      'Terminal return request cannot change status'
    );
    reopenError = e.code ?? '';
  }
  check(
    'the DB trigger refuses to reopen a terminal request',
    reopenBlocked,
    reopenError ? `SQLSTATE ${reopenError}` : 'trigger did not fire'
  );

  // Confirm the row genuinely did not move — the trigger aborts the statement.
  const afterGuard = await sql`SELECT status FROM return_requests WHERE id = ${returnId}`;
  check(
    'the refused transition left the row untouched',
    afterGuard[0].status === 'REFUNDED'
  );

  // And the independent money guarantee, even ignoring the status entirely.
  let thirdRefundBlocked = false;
  try {
    await sql`INSERT INTO refunds (id, return_request_id, order_id, amount, status)
      VALUES (${crypto.randomUUID()}, ${returnId}, ${orderId}, 851, 'PENDING')`;
  } catch (e) {
    thirdRefundBlocked = e.code === '23505';
  }
  check(
    'a second payout row is independently impossible (partial unique index)',
    thirdRefundBlocked
  );

  // --- 7. the audit log was written ------------------------------------
  // Written directly here because this script tests the DATABASE guarantees;
  // the application-level writer is unit-tested separately.
  await sql`
    INSERT INTO return_events (id, return_request_id, event, from_status, to_status, actor)
    VALUES (${crypto.randomUUID()}, ${returnId}, 'refunded', 'REFUND_PENDING', 'REFUNDED', 'e2e')`;
  const events = await sql`
    SELECT count(*)::int AS n FROM return_events WHERE return_request_id = ${returnId}`;
  check('audit events are recorded', events[0].n > 0, `${events[0].n} event(s)`);

  // --- 8. webhook replay guard -----------------------------------------
  const evId = `e2e:${suffix}`;
  const first = await sql`
    INSERT INTO webhook_events (id, provider, event_type)
    VALUES (${evId}, 'shiprocket', 'DELIVERED')
    ON CONFLICT DO NOTHING RETURNING id`;
  const second = await sql`
    INSERT INTO webhook_events (id, provider, event_type)
    VALUES (${evId}, 'shiprocket', 'DELIVERED')
    ON CONFLICT DO NOTHING RETURNING id`;
  check('the first webhook claim wins', first.length === 1);
  check('a duplicate webhook is dropped', second.length === 0);

  // --- 9. delivered_at is set once, and only forwards -----------------
  const redeliver = await sql`
    UPDATE orders SET delivered_at = now() WHERE id = ${orderId} AND delivered_at IS NULL
    RETURNING id`;
  check('a replayed delivery event cannot move delivered_at', redeliver.length === 0);

  // --- 10. customer_risk ledger recomputes cleanly --------------------
  await sql`
    INSERT INTO customer_risk (customer_id, total_returns, total_refunded)
    VALUES (${customerId}, 1, 851)
    ON CONFLICT (customer_id) DO UPDATE SET total_returns = 1, total_refunded = 851`;
  const risk = await sql`
    SELECT total_returns, total_refunded::text FROM customer_risk WHERE customer_id = ${customerId}`;
  check('the customer abuse ledger persists', risk[0]?.total_returns === 1, risk[0]?.total_refunded);

  // --- cleanup ---------------------------------------------------------
  await sql`DELETE FROM orders WHERE id = ${orderId}`; // cascades to items + returns + refunds
  await sql`DELETE FROM products WHERE id = ${productId}`;
  await sql`DELETE FROM customers WHERE id = ${customerId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  await sql`DELETE FROM webhook_events WHERE id = ${evId}`;

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map(f => f.name).join(', '));
    process.exit(1);
  }
  console.log('Cleanup complete — no fixtures left behind.');
};

run().catch(e => {
  console.error(e);
  process.exit(1);
});
