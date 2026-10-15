// verify-customers-schema.mjs — confirms customers columns + runs the fixed returns queries
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

let url = process.env.adore_DATABASE_URL;
if (!url) {
  const env = readFileSync('.env.local', 'utf8');
  const line = env
    .split('\n')
    .find(l => l.trim().startsWith('adore_DATABASE_URL='));
  url = line?.split('=')[1]?.replace(/^["']|["']$/g, '');
}
if (!url) throw new Error('adore_DATABASE_URL not found');

const sql = neon(url);

const cols = await sql.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'customers' ORDER BY ordinal_position`
);
console.log('customers columns:', cols.map(c => c.column_name).join(', '));

// The ADMIN_SELECT shape used by listAdminReturns (the query that crashed).
const queue = await sql.query(
  `SELECT r.id, r.type, r.reason, r.status, r.qty, r.fee, r.refund_amount,
          r.net_refund, r.order_id, r.order_item_id,
          o.order_number, oi.product_name, oi.sku,
          r.customer_id,
          NULLIF(CONCAT_WS(' ', c.first_name, c.last_name), '') AS customer_name,
          c.email AS customer_email, c.phone AS customer_phone,
          r.created_at, o.delivered_at,
          r.risk_score, r.risk_reasons, r.is_blocked, r.blocked_reason,
          r.photos, r.pickup_attempts, r.shiprocket_return_awb,
          r.rejection_reason, r.notes
   FROM return_requests r
   JOIN orders o       ON o.id = r.order_id
   JOIN order_items oi ON oi.id = r.order_item_id
   LEFT JOIN customers c ON c.id = r.customer_id
   WHERE r.status NOT IN ('REFUNDED','REJECTED','CANCELLED')
   LIMIT 3`
);
console.log(`\nlistAdminReturns query OK — ${queue.length} row(s)`);
for (const row of queue) {
  console.log(`  ${row.order_number} · ${row.status} · ${row.customer_name}`);
}
