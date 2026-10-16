/**
 * Order lifecycle operations (admin-side).
 *
 * Currently only cancellation, but structured so more transitions (PROCESSING,
 * SHIPPED nudges, notes) can live here without growing checkout.ts.
 *
 * THE CANCELLATION CONTRACT
 * -------------------------
 * Cancellation must be safe to call from BOTH sides:
 *   - Admin UI  → cancels in Shiprocket first, then here.
 *   - Shiprocket webhook (admin cancelled it in the SR dashboard) → the courier
 *     is already authoritative; we only mirror the state and restock.
 *
 * Both paths converge on `cancelOrder`, which is IDEMPOTENT: a webhook firing
 * after the admin already cancelled (or vice versa) is a no-op, not an error.
 *
 * Stock: a CONFIRMED order's stock was decremented at reserve time and the
 * reservation deleted at finalize. Cancellation therefore ADDS the quantities
 * back to product_variants — the same write the returns QC-pass restock uses.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, rawQuery, orders, orderItems } from './db';
import { cancelShiprocketOrder } from './shipping';

/** Statuses an order must be in to allow cancellation. */
const CANCELLABLE_STATUSES = ['CONFIRMED', 'PROCESSING'] as const;

export type CancelOrderResult = {
  ok: boolean;
  /** Machine-readable reason when ok is false. */
  code?: 'NOT_FOUND' | 'NOT_CANCELLABLE' | 'DISPATCHED' | 'GATEWAY_ERROR';
  message: string;
  orderNumber?: string;
};

/**
 * Cancel an order: mirror the status, restock the line items, and cancel the
 * courier booking when one exists.
 *
 * Shiprocket-first ordering matters: if the courier rejects the cancellation
 * (shipment already dispatched), the order here is left untouched so the two
 * systems never disagree about who owns the parcel. A courier outage returns
 * code GATEWAY_ERROR — retryable, order still CONFIRMED.
 */
export async function cancelOrder(input: {
  orderId: string;
  actor: string;
  reason?: string;
}): Promise<CancelOrderResult> {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  const order = rows[0];
  if (!order) {
    return { ok: false, code: 'NOT_FOUND', message: 'Order not found.' };
  }

  // Idempotent: an already-cancelled order satisfies the request.
  if (order.status === 'CANCELLED') {
    return {
      ok: true,
      message: 'Order was already cancelled.',
      orderNumber: order.orderNumber,
    };
  }

  if (!CANCELLABLE_STATUSES.includes(order.status as 'CONFIRMED')) {
    return {
      ok: false,
      code: 'NOT_CANCELLABLE',
      message: `An order in status ${order.status} cannot be cancelled.`,
      orderNumber: order.orderNumber,
    };
  }

  // Courier first (see docstring). No booking yet → nothing to cancel there.
  if (order.shiprocketOrderId) {
    try {
      await cancelShiprocketOrder(order.shiprocketOrderId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Dispatched shipments cannot be cancelled anywhere — both systems agree
      // the parcel is moving, so the admin must run a return instead.
      if (/already|dispatch|in.?transit|shipped/i.test(message)) {
        return {
          ok: false,
          code: 'DISPATCHED',
          message:
            'The parcel has already been dispatched with the courier. Cancel from Shiprocket and process a return instead.',
          orderNumber: order.orderNumber,
        };
      }
      console.error(
        `[order-ops] Shiprocket cancel failed for ${order.orderNumber}:`,
        message
      );
      return {
        ok: false,
        code: 'GATEWAY_ERROR',
        message: `Could not cancel the courier booking: ${message}`,
        orderNumber: order.orderNumber,
      };
    }
  }

  // PENDING→CANCELLED is a single conditional UPDATE: a webhook and an admin
  // click racing on the same order can both reach the courier cancel above
  // (idempotent at Shiprocket), but only one caller wins the status flip and
  // only the winner restocks — so stock is returned exactly once.
  const updated = await db
    .update(orders)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, input.orderId),
        inArray(orders.status, [...CANCELLABLE_STATUSES])
      )
    )
    .returning({ id: orders.id });

  if (updated.length === 0) {
    // Lost the race — the webhook already did it.
    return {
      ok: true,
      message: 'Order was already cancelled.',
      orderNumber: order.orderNumber,
    };
  }

  await restockOrderItems(input.orderId);

  console.log(
    `[order-ops] ${order.orderNumber} cancelled by ${input.actor}${input.reason ? ` — ${input.reason}` : ''}`
  );

  return {
    ok: true,
    message: 'Order cancelled and stock returned.',
    orderNumber: order.orderNumber,
  };
}

/**
 * Return every line item's quantity to its variant's stock. Only called after
 * the status flip to CANCELLED has actually been won, so it runs at most once
 * per order.
 */
async function restockOrderItems(orderId: string): Promise<void> {
  const items = await db
    .select({
      variantId: orderItems.variantId,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  if (items.length === 0) return;

  // One UPDATE per variant, same atomic pattern as the returns restock.
  for (const item of items) {
    if (!item.variantId) continue;
    await rawQuery(sql`
      UPDATE product_variants v
      SET stock_quantity = v.stock_quantity + ${item.quantity}, updated_at = now()
      WHERE v.id = ${item.variantId}
    `);
  }
}

/**
 * Shiprocket told us (via webhook) that the shipment for this order number was
 * cancelled. Mirrors the status and restocks — the courier side is already
 * authoritative, so there is nothing to call there.
 */
export async function cancelOrderFromCourier(
  orderNumber: string
): Promise<void> {
  const rows = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  const order = rows[0];
  if (!order) return;

  if (order.status === 'CANCELLED') return; // already mirrored

  if (!CANCELLABLE_STATUSES.includes(order.status as 'CONFIRMED')) {
    // SHIPPED/DELIVERED reaching here would be a mis-categorised webhook;
    // never mark those cancelled from a courier event.
    console.warn(
      `[order-ops] courier cancellation event for ${orderNumber} in status ${order.status} — ignored`
    );
    return;
  }

  const updated = await db
    .update(orders)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, order.id),
        inArray(orders.status, [...CANCELLABLE_STATUSES])
      )
    )
    .returning({ id: orders.id });

  if (updated.length > 0) {
    await restockOrderItems(order.id);
    console.log(
      `[order-ops] ${orderNumber} cancelled via Shiprocket webhook; stock returned`
    );
  }
}
