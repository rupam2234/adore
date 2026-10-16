import { NextResponse } from 'next/server';
import { rawQuery, sql } from '@/utils/db';
import { getSessionUserId } from '@/utils/request-user';
import { rateLimit } from '@/utils/rate-limit';
import { fetchShiprocketOrderStatus } from '@/utils/shipping';

/**
 * GET /api/account/orders/[id]/track — live courier status for one order.
 *
 * On-demand only (the customer clicked "Track order status"): every hit costs a
 * Shiprocket API call, so it is rate limited per customer and never wired into
 * page renders. Ownership is enforced in the SQL itself — an order id belonging
 * to another account behaves exactly like one that does not exist (404, not
 * 403), so the endpoint cannot be used to probe for real order ids.
 */
const TRACK_LIMIT = { limit: 20, windowMs: 60_000 };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const limit = rateLimit(`track:${userId}`, TRACK_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again in a little while.' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    );
  }

  const { id } = await params;

  const rows = await rawQuery<{ shiprocket_order_id: string | null }>(sql`
    SELECT o.shiprocket_order_id
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${id} AND c.user_id = ${userId}
    LIMIT 1
  `);
  const order = rows[0];
  if (!order) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // No courier booking yet — nothing to ask Shiprocket about.
  if (!order.shiprocket_order_id) {
    return NextResponse.json({ tracking: null, reason: 'NOT_BOOKED' });
  }

  // Best-effort, same as the admin page: a courier outage renders as
  // "unavailable", never as a 500.
  const tracking = await fetchShiprocketOrderStatus(order.shiprocket_order_id);
  if (!tracking) {
    return NextResponse.json({ tracking: null, reason: 'UNAVAILABLE' });
  }
  return NextResponse.json({ tracking });
}
