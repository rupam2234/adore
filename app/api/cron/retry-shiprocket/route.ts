import { NextResponse } from 'next/server';
import { db, orders, sql } from '@/utils/db';
import { pushToShiprocket } from '@/utils/checkout';

export async function GET(request: Request) {
  // Only run via Vercel Cron (check Authorization header)
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stuck = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(
      sql`${orders.status} = 'CONFIRMED' AND ${orders.shiprocketOrderId} IS NULL AND ${orders.createdAt} < now() - interval '5 minutes'`
    )
    .limit(50);

  const results = [];
  for (const order of stuck) {
    try {
      const shiprocketOrderId = await pushToShiprocket(order.id);
      results.push({ orderNumber: order.orderNumber, shiprocketOrderId, ok: true });
    } catch (err) {
      results.push({ orderNumber: order.orderNumber, error: String(err), ok: false });
    }
  }

  return NextResponse.json({ retried: results.length, results });
}