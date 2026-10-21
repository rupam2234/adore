import { NextResponse } from 'next/server';
import { db, orders, sql } from '@/utils/db';
import { pushToShiprocket } from '@/utils/checkout';
import { jwtVerify } from 'jose';
import { finalizeReservations } from '@/utils/reservations';
import { queueOrderConfirmedEmail } from '@/utils/checkout';

async function verifyCronAuth(request: Request): Promise<boolean> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  try {
    const key = new TextEncoder().encode(secret);
    await jwtVerify(token, key, { algorithms: ['HS256'] });
    return true;
  } catch {
    return token === secret;
  }
}

export async function GET(request: Request) {
  const started = Date.now();

  // Ensure helper tables exist
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cron_idempotency_keys (
      request_id uuid PRIMARY KEY,
      endpoint   text NOT NULL,
      created_at timestamptz DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cron_audit_log (
      run_id      uuid PRIMARY KEY,
      endpoint    text NOT NULL,
      order_ids   jsonb NOT NULL,
      status      text NOT NULL,
      duration_ms int  NOT NULL,
      created_at  timestamptz DEFAULT now()
    )
  `);

  // Authorization
  if (!(await verifyCronAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Idempotency key
  const requestId = request.headers.get('x-request-id');
  if (!requestId) {
    return NextResponse.json({ error: 'Missing X-Request-Id header' }, { status: 400 });
  }

  const already = await db.execute(sql`
    SELECT 1 FROM cron_idempotency_keys
    WHERE request_id = ${requestId} AND endpoint = 'confirm-zero-total'
  `);
  if (already.rows.length) {
    return NextResponse.json({ error: 'Duplicate request', duplicate: true }, { status: 409 });
  }

  await db.execute(sql`
    INSERT INTO cron_idempotency_keys (request_id, endpoint)
    VALUES (${requestId}, 'confirm-zero-total')
  `);

  // Fetch zero-total pending orders ready for confirmation
  const pending = await db.execute(sql`
    SELECT id, order_number AS "orderNumber", promo_code_id AS "promoCodeId"
    FROM orders
    WHERE status = 'PENDING'
      AND zero_total = true
      AND payment_verified = false
      AND created_at < now() - interval '1 minute'
    LIMIT 50
  `);

  const results = [];
  const confirmedIds: string[] = [];

  for (const order of pending.rows as any[]) {
    try {
      // Optionally re-validate promo code still valid
      // if (order.promoCodeId && !(await isPromoStillValid(order.promoCodeId))) {
      //   throw new Error('Promo no longer valid');
      // }

      // Finalize reservations (decrement stock)
      await finalizeReservations(order.id);

      // Mark order confirmed and payment verified
      await db.execute(sql`
        UPDATE orders
        SET status = 'CONFIRMED',
            payment_verified = true,
            updated_at = now()
        WHERE id = ${order.id}
      `);

      // Queue confirmation email
      const custResult = await db.execute(sql`SELECT customer_id FROM orders WHERE id = ${order.id}`);
      const customerId = custResult.rows[0]?.customer_id as string;
      await queueOrderConfirmedEmail({
        id: order.id,
        orderNumber: order.orderNumber,
        customerId,
        totalAmount: '0',
        currency: 'INR',
      });

      // Push to Shiprocket (best-effort)
      try {
        await pushToShiprocket(order.id);
      } catch (e) {
        console.error(`[confirm-zero-total] Shiprocket push failed for ${order.orderNumber}:`, e);
      }

      results.push({ orderNumber: order.orderNumber, ok: true });
      confirmedIds.push(order.id);
    } catch (err) {
      results.push({ orderNumber: order.orderNumber, error: String(err), ok: false });
    }
  }

  const durationMs = Date.now() - started;
  await db.execute(sql`
    INSERT INTO cron_audit_log (run_id, endpoint, order_ids, status, duration_ms)
    VALUES (
      ${requestId},
      'confirm-zero-total',
      ${JSON.stringify(confirmedIds)}::jsonb,
      ${results.some(r => r.ok) ? 'success' : 'none'},
      ${durationMs}
    )
  `);

  return NextResponse.json({ confirmed: results.length, results });
}