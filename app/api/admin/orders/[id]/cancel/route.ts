import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAdminRequest } from '@/utils/admin-auth';
import { cancelOrder } from '@/utils/order-ops';

/**
 * POST /api/admin/orders/[id]/cancel — cancel an order.
 *
 * Flow: cancel the Shiprocket booking first (if one exists), then flip the
 * order to CANCELLED and restock. If the courier reports the parcel already
 * dispatched, nothing changes and the admin is told to run a return instead —
 * an order that is physically moving must not silently become "cancelled"
 * while Shiprocket still shows it in transit.
 *
 * Idempotent: cancelling an already-cancelled order is a success no-op, so a
 * double-click or a racing Shiprocket webhook cannot corrupt anything.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const { id } = await params;

  let reason: string | undefined;
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body?.reason === 'string' && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 300);
    }
  } catch {
    // Body optional.
  }

  const result = await cancelOrder({ orderId: id, actor: 'admin', reason });

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 422;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status }
    );
  }

  // Refresh the ledger so the row shows CANCELLED immediately.
  revalidatePath('/admin/ledger');

  return NextResponse.json({
    ok: true,
    message: result.message,
    orderNumber: result.orderNumber,
  });
}
