import { NextResponse } from 'next/server';
import { db, orders, sql } from '@/utils/db';
import { jwtVerify } from 'jose';

async function verifyCronAuth(request: Request): Promise<boolean> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // First try JWT verification
  try {
    const key = new TextEncoder().encode(secret);
    await jwtVerify(token, key, { algorithms: ['HS256'] });
    return true;
  } catch {
    // Fallback: static secret match
    return token === secret;
  }
}

export async function GET(request: Request) {
  const started = Date.now();
  // Ensure tables exist
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cron_idempotency_keys (
      request_id uuid PRIMARY KEY,
      endpoint text NOT NULL,
      created_at timestamptz DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cron_audit_log (
      run_id uuid PRIMARY KEY,
      endpoint text NOT NULL,
      order_ids jsonb NOT NULL,
      status text NOT NULL,
      duration_ms int NOT NULL,
      created_at timestamptz DEFAULT now()
    )
  `);

  // Authorization
  if (!(await verifyCronAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Idempotency key from header
  const requestId = request.headers.get('x-request-id');
  if (!requestId) {
    return NextResponse.json({ error: 'Missing X-Request-Id header' }, { status: 400 });
  }

  // Check if already processed
  const existing = await db.execute(sql`
    SELECT 1 FROM cron_idempotency_keys WHERE request_id = ${requestId} AND endpoint = 'auto-process'
  `);
  if (existing.rows.length > 0) {
    return NextResponse.json({ error: 'Duplicate request', duplicate: true }, { status: 409 });
  }

  // Record idempotency key
  await db.execute(sql`
    INSERT INTO cron_idempotency_keys (request_id, endpoint) VALUES (${requestId}, 'auto-process')
  `);

  const toProcess = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      sql`${orders.status} = 'CONFIRMED' AND ${orders.shiprocketOrderId} IS NOT NULL AND (${orders.razorpayPaymentId} IS NOT NULL OR ${orders.totalAmount} = '0') AND ${orders.updatedAt} < now() - interval '2 minutes'`
    )
    .limit(100);

  let processed = 0;
  const processedIds: string[] = [];
  for (const order of toProcess) {
    const result = await db
      .update(orders)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(sql`${orders.id} = ${order.id} AND ${orders.status} = 'CONFIRMED'`)
      .returning({ id: orders.id });
    if (result.length > 0) {
      processed++;
      processedIds.push(order.id);
    }
  }

  const durationMs = Date.now() - started;
  // Audit log
  await db.execute(sql`
    INSERT INTO cron_audit_log (run_id, endpoint, order_ids, status, duration_ms)
    VALUES (${requestId}, 'auto-process', ${JSON.stringify(processedIds)}::jsonb, ${processed > 0 ? 'success' : 'none'}, ${durationMs})
  `);

  return NextResponse.json({ processed, total: toProcess.length });
}