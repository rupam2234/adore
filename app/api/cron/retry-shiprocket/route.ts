import { NextResponse } from 'next/server';
import { db, sql } from '@/utils/db';
import { pushToShiprocket } from '@/utils/checkout';
import { jwtVerify } from 'jose';
import { alertOnCronFailure } from '@/utils/alerts';

/* -------------------------------------------------------------
   1️⃣  JWT verification (no static fallback)
   ------------------------------------------------------------- */
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
    return false;
  }
}

/* -------------------------------------------------------------
   2️⃣  Main handler
   ------------------------------------------------------------- */
export async function GET(request: Request) {
  const started = Date.now();

  /* ---- 2.1  Ensure helper tables exist (idempotent) ---- */
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

  /* ---- 2.2  Ensure retry columns exist on orders ---- */
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0`);
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ`);

  /* ---- 2.3  Authorization ---- */
  if (!(await verifyCronAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  /* ---- 2.4  Idempotency key (X‑Request‑Id) ---- */
  const requestId = request.headers.get('x-request-id');
  if (!requestId) {
    return NextResponse.json({ error: 'Missing X-Request-Id header' }, { status: 400 });
  }

  const already = await db.execute(sql`
    SELECT 1 FROM cron_idempotency_keys
    WHERE request_id = ${requestId} AND endpoint = 'retry-shiprocket'
  `);
  if (already.rows.length) {
    return NextResponse.json({ error: 'Duplicate request', duplicate: true }, { status: 409 });
  }

  await db.execute(sql`
    INSERT INTO cron_idempotency_keys (request_id, endpoint)
    VALUES (${requestId}, 'retry-shiprocket')
  `);

  /* ---- 2.5  Pull orders that are ready for a retry ---- */
  interface StuckOrder {
    id: string;
    orderNumber: string;
    retryCount: number;
    nextRetryAt: Date | null;
  }

  const stuckResult = await db.execute(sql`
    SELECT
      id,
      order_number          AS "orderNumber",
      retry_count           AS "retryCount",
      next_retry_at         AS "nextRetryAt"
    FROM orders
    WHERE status = 'CONFIRMED'
      AND shiprocket_order_id IS NULL
      AND (next_retry_at IS NULL OR next_retry_at <= now())
      AND created_at < now() - interval '5 minutes'
    LIMIT 50
  `);

  const stuck = stuckResult.rows as unknown as StuckOrder[];

  const results: Array<{ orderNumber: string; shiprocketOrderId?: string; error?: string; ok: boolean }> = [];
  const retriedIds: string[] = [];

  for (const order of stuck) {
    try {
      const shiprocketOrderId = await pushToShiprocket(order.id);
      const sid = shiprocketOrderId ?? undefined;
      results.push({ orderNumber: order.orderNumber, shiprocketOrderId: sid, ok: true });
      retriedIds.push(order.id);

      /* success → clear retry metadata */
      await db.execute(sql`
        UPDATE orders
        SET retry_count = 0, next_retry_at = NULL
        WHERE id = ${order.id}
      `);
    } catch (err) {
      results.push({ orderNumber: order.orderNumber, error: String(err), ok: false });

      /* failure → exponential back‑off */
      const newRetryCount = (order.retryCount ?? 0) + 1;
      const backoffMinutes = 5 * Math.pow(2, newRetryCount - 1);   // 5,10,20,40,80…
      const MAX_RETRIES = 5;

      if (newRetryCount < MAX_RETRIES) {
        await db.execute(sql`
          UPDATE orders
          SET retry_count = ${newRetryCount},
              next_retry_at = now() + interval '${backoffMinutes} minutes'
          WHERE id = ${order.id}
        `);
      } else {
        /* max retries reached – stop retrying this order */
        await db.execute(sql`
          UPDATE orders SET next_retry_at = NULL WHERE id = ${order.id}
        `);
      }
    }
  }

  /* ---- 2.6  Audit log ---- */
  const durationMs = Date.now() - started;
  const status = results.some(r => r.ok) ? 'success' : 'none';
  await db.execute(sql`
    INSERT INTO cron_audit_log (run_id, endpoint, order_ids, status, duration_ms)
    VALUES (
      ${requestId},
      'retry-shiprocket',
      ${JSON.stringify(retriedIds)}::jsonb,
      ${status},
      ${durationMs}
    )
  `);

  // Alert on failure
  if (status !== 'success') {
    await alertOnCronFailure('retry-shiprocket', status, { retried: results.length, results });
  }

  return NextResponse.json({ retried: results.length, results });
}