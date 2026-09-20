import { cookies } from 'next/headers';
import { rawQuery, sql } from './db';
import { getPublicUrl } from './cloudinary';
import { getAttachedPromo, type AppliedPromo } from './promo';
import { computeDiscount } from './promo-format';
import { sweepReservations, releaseOrderReservations } from './reservations';
import { getSessionUserId } from './request-user';
import { computeShippingAmount } from './checkout-format';
import { DEFAULT_WEIGHT_GRAMS } from './admin-schema';

export const CART_COOKIE = 'adore_cart';
export const CART_MAX_AGE = 60 * 60 * 24 * 90;

/** Single source of truth for the adore_cart cookie attributes. */
export function cartCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: CART_MAX_AGE,
    path: '/',
  };
}

/**
 * Resolve the current shopper (session user + cart) in one pass. Shared by
 * every cart route so the JWT is verified exactly once per request.
 */
export async function getCartShopper(): Promise<{
  cartId: string | null;
  userId: string | null;
}> {
  const [token, userId] = await Promise.all([
    (async () => (await cookies()).get(CART_COOKIE)?.value)(),
    getSessionUserId(),
  ]);
  return { cartId: await resolveCartId(userId, token), userId };
}

export type CartLine = {
  id: string;
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  color: string;
  colorHex: string | null;
  size: string;
  imageUrl: string | null;
  unitPrice: string;
  compareAtPrice: string | null;
  currency: string;
  quantity: number;
  stock: number;
  lineTotal: string;
  /** Packed weight per unit (grams); null → the 400g estimate applies. */
  weightGrams: number | null;
};

export type CartSummary = {
  items: CartLine[];
  itemCount: number;
  subtotal: string;
  discount: string;
  shipping: string;
  gst: string;
  total: string;
  promo: AppliedPromo | null;
  currency: string | null;
  /** Total packed weight (grams, incl. 400g fallback) for shipping quotes. */
  weightGrams: number;
};

const EMPTY_CART: CartSummary = {
  items: [],
  itemCount: 0,
  subtotal: '0',
  discount: '0',
  shipping: '0',
  gst: '0',
  total: '0',
  promo: null,
  currency: null,
  weightGrams: 0,
};

type CartRow = {
  id: string;
  variant_id: string;
  product_id: string;
  slug: string;
  name: string;
  color: string;
  color_hex: string | null;
  size: string;
  public_id: string | null;
  price: string;
  compare_at_price: string | null;
  currency: string;
  quantity: number;
  stock: number;
  weight_grams: number | null;
};

function mapCart(
  rows: CartRow[],
  promo: Omit<AppliedPromo, 'discount'> | null
): CartSummary {
  const items = rows.map(row => ({
    id: row.id,
    variantId: row.variant_id,
    productId: row.product_id,
    slug: row.slug,
    name: row.name,
    color: row.color,
    colorHex: row.color_hex,
    size: row.size,
    imageUrl: row.public_id ? getPublicUrl(row.public_id) : null,
    unitPrice: row.price,
    compareAtPrice: row.compare_at_price,
    currency: row.currency,
    quantity: row.quantity,
    stock: row.stock,
    weightGrams: row.weight_grams ?? null,
    lineTotal: String(Number(row.price) * row.quantity),
  }));

  const subtotal = String(
    items.reduce((sum, item) => sum + Number(item.lineTotal), 0)
  );
  const weightGrams = items.reduce(
    (sum, item) => sum + (item.weightGrams ?? DEFAULT_WEIGHT_GRAMS) * item.quantity,
    0
  );
  const discount = promo
    ? computeDiscount(promo.discountType, promo.discountValue, subtotal)
    : '0';
  const shipping = String(computeShippingAmount(Number(subtotal) - Number(discount)));
  const total = String(Number(subtotal) - Number(discount) + Number(shipping));

  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    discount,
    shipping,
    gst: '0', // Not applied currently
    total,
    promo: promo ? { ...promo, discount } : null,
    currency: items[0]?.currency ?? null,
    weightGrams,
  };
}

export async function findCartId(
  token: string | undefined
): Promise<string | null> {
  if (!token) return null;
  const rows = await rawQuery<{ id: string }>(
    sql`SELECT id FROM carts WHERE token = ${token} LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

/** The shopper's account cart, if one exists (most recently active wins). */
export async function findUserCart(
  userId: string | null
): Promise<{ id: string; token: string } | null> {
  if (!userId) return null;
  const rows = await rawQuery<{ id: string; token: string }>(
    sql`SELECT id, token FROM carts
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT 1`
  );
  return rows[0] ?? null;
}

/** Fold a guest cart's items (stock-capped) + promo into the account cart. */
async function mergeGuestItems(
  userCartId: string,
  guestCartId: string
): Promise<void> {
  // Before the guest cart is deleted, clean up any PENDING order created from it.
  // A guest may have started checkout before logging in; if so, the pending order's
  // reservations reference this guest cart and must be released here or it survives
  // as an orphan with no cart attached.
  await cleanUpPendingOrder(guestCartId);

  await rawQuery(sql`
    WITH merged AS (
      INSERT INTO cart_items (id, cart_id, variant_id, quantity)
      SELECT gen_random_uuid(), ${userCartId}, ci.variant_id, ci.quantity
      FROM cart_items ci
      WHERE ci.cart_id = ${guestCartId}
      ON CONFLICT (cart_id, variant_id)
      DO UPDATE SET quantity = LEAST(
        cart_items.quantity + EXCLUDED.quantity,
        COALESCE(
          (SELECT v.stock_quantity FROM product_variants v WHERE v.id = EXCLUDED.variant_id),
          EXCLUDED.quantity
        )
      )
    )
    UPDATE carts
    SET promo_code_id = COALESCE(
          carts.promo_code_id,
          (SELECT promo_code_id FROM carts WHERE id = ${guestCartId})
        ),
        updated_at = now()
    WHERE id = ${userCartId}
  `);
  await rawQuery(sql`
    WITH gone AS (
      DELETE FROM cart_items WHERE cart_id = ${guestCartId}
    )
    DELETE FROM carts WHERE id = ${guestCartId}
  `);
}

/**
 * Resolve the active cart for a request: the account cart wins for logged-in
 * users (so the bag follows the account across devices/cookies), otherwise
 * fall back to the anonymous cookie cart. ONE round-trip covers both cases.
 *
 * Self-healing for logged-in users (each runs at most once per cart):
 * - Account cart + anonymous cookie cart both exist → the cookie cart is
 *   folded in (e.g. items added on another device before its login merge).
 * - Only an anonymous cookie cart exists → it is adopted into the account.
 *   This is what links a bag created before the user_id migration (or by a
 *   login whose merge didn't run) to the account, so it shows up on every
 *   other device the account is signed in on.
 */
export async function resolveCartId(
  userId: string | null,
  token: string | undefined
): Promise<string | null> {
  if (!userId && !token) return null;
  const rows = await rawQuery<{ id: string; owned: boolean }>(
    sql`SELECT id, (user_id IS NOT NULL) AS owned
        FROM carts
        WHERE (user_id IS NOT NULL AND user_id = ${userId})
           OR (user_id IS NULL AND token = ${token ?? null})
        ORDER BY (user_id IS NOT NULL) DESC, updated_at DESC`
  );
  const owned = rows.find(r => r.owned);
  const guest = rows.find(r => !r.owned);

  if (owned) {
    if (guest) await mergeGuestItems(owned.id, guest.id);
    return owned.id;
  }
  if (guest && userId) {
    await rawQuery(
      sql`UPDATE carts SET user_id = ${userId}, updated_at = now()
          WHERE id = ${guest.id} AND user_id IS NULL`
    );
  }
  return guest?.id ?? null;
}

/**
 * Attach (or merge) the guest cookie cart into the user's account cart at
 * login. Returns the account cart's token so the caller can refresh the
 * cookie — after this the bag follows the account, not the browser. Returns
 * null when there is nothing to carry over (no cart is created; the next
 * add-to-cart creates one bound to the account).
 */
export async function mergeGuestCart(
  userId: string,
  guestCartId: string | null
): Promise<string | null> {
  const userCart = await findUserCart(userId);

  if (!userCart) {
    if (guestCartId) {
      // Adopt the guest cart in one round-trip; the user_id IS NULL guard
      // means a concurrent login that already claimed it is a no-op.
      const adopted = await rawQuery<{ token: string }>(
        sql`UPDATE carts SET user_id = ${userId}, updated_at = now()
            WHERE id = ${guestCartId} AND user_id IS NULL
            RETURNING token`
      );
      if (adopted[0]) return adopted[0].token;
    }
    return null;
  }

  if (guestCartId && guestCartId !== userCart.id) {
    await mergeGuestItems(userCart.id, guestCartId);
  }

  return userCart.token;
}

export async function getCartDetail(
  cartId: string | null,
  userId: string | null = null
): Promise<CartSummary> {
  // No cart → nothing to report, so return BEFORE the housekeeping sweep. The
  // sweep is two sequential round-trips on the Neon HTTP driver and its
  // result is discarded here: an empty bag has no availability to show.
  // Guests with no cart (the bulk of page loads) take this path every time.
  if (!cartId) return EMPTY_CART;

  // Lazy housekeeping (throttled to 30s in reservations.ts): expired checkout
  // reservations go back on sale here, so the bag always shows true
  // availability. Checkout forces a sweep too, so an expired hold is never
  // stranded at pay time.
  await sweepReservations();
  const [rows, promo] = await Promise.all([
    cartRowsWithWeight(cartId),
    getAttachedPromo(cartId, userId),
  ]);
  return mapCart(rows, promo);
}

/** Cart rows including per-product packed weight. */
const CART_ROWS_SQL = sql`
    SELECT
      ci.id,
      ci.variant_id,
      p.id AS product_id,
      p.slug,
      p.name,
      v.color,
      v.color_hex,
      v.size,
      v.price,
      v.compare_at_price,
      v.currency,
      v.stock_quantity AS stock,
      p.weight_grams AS weight_grams,
      ci.quantity,
      (
        SELECT pi.public_id
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.is_primary DESC, pi.sort_order ASC
        LIMIT 1
      ) AS public_id
    FROM cart_items ci
    JOIN product_variants v ON v.id = ci.variant_id AND v.is_active
    JOIN products p ON p.id = v.product_id AND p.status = 'ACTIVE'
    WHERE ci.cart_id = `;
const CART_ROWS_ORDER = sql`
    ORDER BY ci.created_at ASC
  `;

/**
 * Weight-aware cart read. If the products table predates weight_grams
 * (migration not run — see scripts/add-product-weight.sql), the query would
 * error and break every cart operation; fall back to the legacy read with
 * null weights (→ the 400g estimate applies).
 */
async function cartRowsWithWeight(
  cartId: string
): Promise<CartRow[]> {
  try {
    return await rawQuery<CartRow>(
      sql`${CART_ROWS_SQL}${cartId}${CART_ROWS_ORDER}`
    );
  } catch (err) {
    console.warn(
      '[cart] weighted read failed (weight_grams column missing? run scripts/add-product-weight.sql) — falling back:',
      err instanceof Error ? err.message : err
    );
    return rawQuery<CartRow>(sql`
    SELECT
      ci.id,
      ci.variant_id,
      p.id AS product_id,
      p.slug,
      p.name,
      v.color,
      v.color_hex,
      v.size,
      v.price,
      v.compare_at_price,
      v.currency,
      v.stock_quantity AS stock,
      NULL::integer AS weight_grams,
      ci.quantity,
      (
        SELECT pi.public_id
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.is_primary DESC, pi.sort_order ASC
        LIMIT 1
      ) AS public_id
    FROM cart_items ci
    JOIN product_variants v ON v.id = ci.variant_id AND v.is_active
    JOIN products p ON p.id = v.product_id AND p.status = 'ACTIVE'
    WHERE ci.cart_id = ${cartId}
    ORDER BY ci.created_at ASC
  `);
  }
}

export async function addCartItem(
  cartId: string,
  variantId: string,
  quantity: number
): Promise<void> {
  const rows = await rawQuery<{ stock: number }>(
    sql`SELECT stock_quantity AS stock
        FROM product_variants
        WHERE id = ${variantId} AND is_active`
  );
  const stock = rows[0]?.stock ?? 0;
  if (stock <= 0) {
    throw new CartError('This variant is unavailable', 409);
  }

  const wanted = quantity > 0 ? quantity : 1;
  // Insert + touch the cart's updated_at in one round-trip (the CTE runs
  // alongside the upsert, so the account-cart ordering stays fresh).
  await rawQuery(sql`
    WITH upsert AS (
      INSERT INTO cart_items (id, cart_id, variant_id, quantity)
      VALUES (gen_random_uuid(), ${cartId}, ${variantId}, ${Math.min(wanted, stock)})
      ON CONFLICT (cart_id, variant_id)
      DO UPDATE SET quantity = LEAST(cart_items.quantity + ${wanted}, ${stock})
    )
    UPDATE carts SET updated_at = now() WHERE id = ${cartId}
  `);
}

export async function updateCartItem(
  cartId: string,
  itemId: string,
  quantity: number
): Promise<void> {
  if (quantity <= 0) {
    await removeCartItem(cartId, itemId);
    return;
  }
  const rows = await rawQuery<{ stock: number }>(sql`
    SELECT v.stock_quantity AS stock
    FROM cart_items ci
    JOIN product_variants v ON v.id = ci.variant_id
    WHERE ci.id = ${itemId} AND ci.cart_id = ${cartId}
  `);
  const stock = rows[0]?.stock;
  if (stock == null) throw new CartError('Cart item not found', 404);

  await rawQuery(sql`
    UPDATE cart_items
    SET quantity = LEAST(${quantity}::int, ${stock}::int)
    WHERE id = ${itemId}::uuid AND cart_id = ${cartId}::uuid
  `);
}

export async function removeCartItem(
  cartId: string,
  itemId: string
): Promise<void> {
  await rawQuery(
    sql`DELETE FROM cart_items WHERE id = ${itemId}::uuid AND cart_id = ${cartId}::uuid`
  );

  // Clean up any PENDING order that was created from this cart.
  // A pending order is created from the cart at checkout start; if the cart
  // changes afterward (item removed), the pending order no longer matches and
  // must be removed immediately — not just when the cart becomes empty.
  await cleanUpPendingOrder(cartId);
}

export async function clearCart(cartId: string): Promise<void> {
  await rawQuery(sql`DELETE FROM cart_items WHERE cart_id = ${cartId}`);
  // Clear any PENDING order that was created from this cart.
  await cleanUpPendingOrder(cartId);
}

export class CartError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Clean up any PENDING orders that were created from this cart.
 * Called after removeCartItem or clearCart — whenever the cart changes, any
 * PENDING order created from it is no longer valid (its items no longer match
 * the cart), so it must be removed immediately to prevent orphaned/stale orders.
 * Stock is released back to the pool via releaseOrderReservations.
 */
async function cleanUpPendingOrder(cartId: string): Promise<void> {
  try {
    // Find PENDING orders that have reservations linked to this cart.
    // The cart_id is stored in stock_reservations, not orders directly.
    const orders = await rawQuery<{ order_id: string }>(sql`
      SELECT DISTINCT o.id AS order_id
      FROM stock_reservations r
      JOIN orders o ON o.id = r.order_id
      WHERE r.cart_id = ${cartId}
        AND o.status = 'PENDING'
    `);

    if (orders.length === 0) {
      return; // No PENDING order for this cart.
    }

    // Delete the orders.
    await rawQuery(sql`
      DELETE FROM orders
      WHERE id = ANY(${orders.map(o => o.order_id)})
    `);

    // Release their reservations.
    for (const o of orders) {
      await releaseOrderReservations(o.order_id);
    }
  } catch (err) {
    console.error('[cart] failed to clean up PENDING order:', err);
    // Don't throw — a cleanup failure shouldn't break cart operations.
  }
}
