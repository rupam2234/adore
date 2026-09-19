import { rawQuery, sql } from "./db";

/**
 * Stock reservations — hold inventory while an order is being paid for.
 *
 * Flow:
 *  - `reserveCartItems` runs at checkout start (BEFORE the Razorpay order is
 *    created). Each item's stock is PHYSICALLY decremented with a single
 *    conditional UPDATE, so concurrent checkouts can never oversell — the
 *    second caller simply gets no row updated and is told the item is gone.
 *  - While reserved, `stock_quantity` IS the buyable stock, so every existing
 *    display (bag, product page, quantity clamps) automatically shows what's
 *    actually available — no other query needs to know about reservations.
 *  - `sweepReservations` lazily releases stock when a reservation expires
 *    (order abandoned) or its order is no longer PENDING (cancelled/refunded),
 *    and deletes consumed rows after payment confirmation.
 *  - `finalizeReservations` runs after payment: the reservation becomes the
 *    sale (stock already decremented — nothing more to move).
 */

export const RESERVATION_TTL_MINUTES = 10;

export type ReservationItem = {
  variantId: string;
  quantity: number;
};

export class StockUnavailableError extends Error {
  status: number;
  variantId: string;
  available: number;
  constructor(message: string, variantId: string, available: number) {
    super(message);
    this.status = 409;
    this.variantId = variantId;
    this.available = available;
  }
}

/**
 * Release stock for reservations that no longer hold:
 *  1. Expired reservations of still-PENDING orders → restock (customer
 *     abandoned checkout; the items go back on sale).
 *  2. Reservations of orders that are NOT PENDING anymore (confirmed/cancelled/
 *     refunded) → delete only. Confirmed rows were already sold, so no restock.
 *
 * Lazy housekeeping runs on every cart read; two sequential round-trips on
 * the Neon HTTP driver (~2 x 114ms) would tax every page load, so it is
 * throttled to once per 30s per server instance. A hold lives for 10 minutes,
 * so a briefly-delayed restock is invisible next to the TTL itself. Checkout
 * passes force=true so an expired hold can never block a paying customer.
 */
const SWEEP_THROTTLE_MS = 30_000;
let lastSweepAt = 0;

export async function sweepReservations(force = false): Promise<void> {
  if (!force) {
    const now = Date.now();
    if (now - lastSweepAt < SWEEP_THROTTLE_MS) return;
    lastSweepAt = now;
  }

  await rawQuery(sql`
    WITH expired AS (
      DELETE FROM stock_reservations r
      USING orders o
      WHERE r.order_id = o.id
        AND o.status = 'PENDING'
        AND r.expires_at < now()
      RETURNING r.variant_id, r.quantity
    )
    UPDATE product_variants v
    SET stock_quantity = v.stock_quantity + e.quantity,
        updated_at = now()
    FROM expired e
    WHERE v.id = e.variant_id
  `);
  await rawQuery(sql`
    DELETE FROM stock_reservations r
    USING orders o
    WHERE r.order_id = o.id AND o.status <> 'PENDING'
  `);
}

/**
 * Hold stock for a checkout attempt. Runs before the Razorpay order is
 * created, so a checkout that can't be honoured never opens a payment window.
 *
 * Any previous reservation from the SAME cart (an abandoned attempt still
 * inside its TTL) is released first — a retrying customer must never block
 * themselves.
 */
export async function reserveCartItems(
  orderId: string,
  cartId: string,
  items: ReservationItem[],
): Promise<void> {
  // Forced sweep: a pay attempt must never be blocked by an expired hold.
  await sweepReservations(true);

  // Release this cart's earlier (still-pending) attempt.
  await rawQuery(sql`
    WITH released AS (
      DELETE FROM stock_reservations r
      USING orders o
      WHERE r.order_id = o.id
        AND o.status = 'PENDING'
        AND r.cart_id = ${cartId}
        AND r.order_id <> ${orderId}
      RETURNING r.variant_id, r.quantity
    )
    UPDATE product_variants v
    SET stock_quantity = v.stock_quantity + s.quantity,
        updated_at = now()
    FROM released s
    WHERE v.id = s.variant_id
  `);

  // Claim the items. One conditional UPDATE per variant is atomic in Postgres:
  // two simultaneous checkouts for the last unit cannot both succeed.
  for (const item of items) {
    const claimed = await rawQuery<{ id: string }>(sql`
      UPDATE product_variants
      SET stock_quantity = stock_quantity - ${item.quantity},
          updated_at = now()
      WHERE id = ${item.variantId}
        AND is_active
        AND stock_quantity >= ${item.quantity}
      RETURNING id
    `);
    if (claimed.length === 0) {
      // Someone got it first — undo what this order already claimed.
      await releaseOrderReservations(orderId);
      const rows = await rawQuery<{ stock: number }>(sql`
        SELECT stock_quantity AS stock
        FROM product_variants WHERE id = ${item.variantId}
      `);
      const available = rows[0]?.stock ?? 0;
      throw new StockUnavailableError(
        available > 0
          ? `Only ${available} left — someone else just reserved this item.`
          : "Too popular. Looks like someone else just purchased this item.",
        item.variantId,
        available,
      );
    }
  }

  await rawQuery(sql`
    INSERT INTO stock_reservations (order_id, cart_id, variant_id, quantity, expires_at)
    SELECT ${orderId}, ${cartId}, v.id, oi.quantity,
           now() + (${RESERVATION_TTL_MINUTES} * interval '1 minute')
    FROM order_items oi
    JOIN product_variants v ON v.id = oi.variant_id
    WHERE oi.order_id = ${orderId}
  `);
}

/**
 * Explicitly give reserved stock back (order cancelled/aborted before the TTL
 * expires). Never throws — a release failure must not break the caller.
 */
export async function releaseOrderReservations(orderId: string): Promise<void> {
  try {
    await rawQuery(sql`
      WITH released AS (
        DELETE FROM stock_reservations
        WHERE order_id = ${orderId}
        RETURNING variant_id, quantity
      )
      UPDATE product_variants v
      SET stock_quantity = v.stock_quantity + r.quantity,
          updated_at = now()
      FROM released r
      WHERE v.id = r.variant_id
    `);
  } catch (err) {
    console.error("[reservations] release failed — stock returns at TTL:", err);
  }
}

/**
 * Payment confirmed: the reservation becomes the sale. Stock was already
 * decremented at reservation time — items WITHOUT a reservation (legacy
 * orders created before this system) are decremented here instead, so both
 * worlds are correct. Rows are deleted either way.
 */
export async function finalizeReservations(orderId: string): Promise<void> {
  await rawQuery(sql`
    UPDATE product_variants v
    SET stock_quantity = GREATEST(0, v.stock_quantity - oi.quantity),
        updated_at = now()
    FROM order_items oi
    WHERE oi.order_id = ${orderId}
      AND v.id = oi.variant_id
      AND NOT EXISTS (
        SELECT 1 FROM stock_reservations r
        WHERE r.order_id = ${orderId} AND r.variant_id = oi.variant_id
      )
  `);
  await rawQuery(sql`
    DELETE FROM stock_reservations WHERE order_id = ${orderId}
  `);
}