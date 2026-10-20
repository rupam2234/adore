import { NextResponse } from 'next/server';
import { db, orders, sql } from '@/utils/db';

export async function GET(request: Request) {
  // Only run via Vercel Cron (check Authorization header)
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const toProcess = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      sql`${orders.status} = 'CONFIRMED' AND ${orders.shiprocketOrderId} IS NOT NULL AND ${orders.updatedAt} < now() - interval '2 minutes'`
    )
    .limit(100);

  let processed = 0;
  for (const order of toProcess) {
    const result = await db
      .update(orders)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(sql`${orders.id} = ${order.id} AND ${orders.status} = 'CONFIRMED'`)
      .returning({ id: orders.id });
    if (result.length > 0) processed++;
  }

  return NextResponse.json({ processed, total: toProcess.length });
}