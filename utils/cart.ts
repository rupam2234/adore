import { rawQuery, sql } from "./db";
import { getPublicUrl } from "./cloudinary";
import { getAttachedPromo, type AppliedPromo } from "./promo";
import { computeDiscount } from "./promo-format";
import { sweepReservations } from "./reservations";

export const CART_COOKIE = "adore_cart";
export const CART_MAX_AGE = 60 * 60 * 24 * 90;

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
};

export type CartSummary = {
  items: CartLine[];
  itemCount: number;
  subtotal: string;
  discount: string;
  total: string;
  promo: AppliedPromo | null;
  currency: string | null;
};

const EMPTY_CART: CartSummary = {
  items: [],
  itemCount: 0,
  subtotal: "0",
  discount: "0",
  total: "0",
  promo: null,
  currency: null,
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
};

function mapCart(rows: CartRow[], promo: Omit<AppliedPromo, "discount"> | null): CartSummary {
  const items = rows.map((row) => ({
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
    lineTotal: String(Number(row.price) * row.quantity),
  }));

  const subtotal = String(
    items.reduce((sum, item) => sum + Number(item.lineTotal), 0),
  );
  const discount = promo
    ? computeDiscount(promo.discountType, promo.discountValue, subtotal)
    : "0";

  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    discount,
    total: String(Number(subtotal) - Number(discount)),
    promo: promo ? { ...promo, discount } : null,
    currency: items[0]?.currency ?? null,
  };
}

export async function findCartId(
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null;
  const rows = await rawQuery<{ id: string }>(
    sql`SELECT id FROM carts WHERE token = ${token} LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

/** The shopper's account cart, if one exists (most recently active wins). */
export async function findUserCart(
  userId: string | null,
): Promise<{ id: string; token: string } | null> {
  if (!userId) return null;
  const rows = await rawQuery<{ id: string; token: string }>(
    sql`SELECT id, token FROM carts
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT 1`,
  );
  return rows[0] ?? null;
}

/**
 * Resolve the active cart for a request: the account cart wins for logged-in
 * users (so the bag follows the account across devices/cookies), otherwise
 * fall back to the anonymous cookie cart. ONE round-trip covers both cases.
 */
export async function resolveCartId(
  userId: string | null,
  token: string | undefined,
): Promise<string | null> {
  if (!userId && !token) return null;
  const rows = await rawQuery<{ id: string }>(
    sql`SELECT id FROM carts
        WHERE (user_id IS NOT NULL AND user_id = ${userId})
           OR (user_id IS NULL AND token = ${token})
        ORDER BY (user_id IS NOT NULL) DESC, updated_at DESC
        LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

/**
 * Attach (or merge) the guest cookie cart into the user's account cart at
 * login. Returns the account cart's token so the caller can refresh the
 * cookie — after this the bag follows the account, not the browser.
 */
export async function mergeGuestCart(
  userId: string,
  guestCartId: string | null,
): Promise<string> {
  const userCart = await findUserCart(userId);

  // No account cart yet: adopt the guest cart (or create a fresh one). The
  // UPDATE...RETURNING keeps the happy path at one round-trip; ON CONFLICT
  // covers a concurrent login racing us to the one-cart-per-user limit.
  if (!userCart) {
    if (guestCartId) {
      const adopted = await rawQuery<{ token: string }>(
        sql`UPDATE carts SET user_id = ${userId}, updated_at = now()
            WHERE id = ${guestCartId} AND user_id IS NULL
            RETURNING token`,
      );
      if (adopted[0]) return adopted[0].token;
    }
    const token = crypto.randomUUID();
    const rows = await rawQuery<{ token: string }>(
      sql`INSERT INTO carts (id, token, user_id)
          VALUES (gen_random_uuid(), ${token}, ${userId})
          ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
          RETURNING token`,
    );
    return rows[0]!.token;
  }

  // Both exist: fold guest items into the account cart (capped at stock) and
  // copy the promo if the account cart has none — one round-trip — then drop
  // the guest cart (its items first).
  if (guestCartId && guestCartId !== userCart.id) {
    await rawQuery(sql`
      WITH merged AS (
        INSERT INTO cart_items (id, cart_id, variant_id, quantity)
        SELECT gen_random_uuid(), ${userCart.id}, ci.variant_id, ci.quantity
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
      WHERE id = ${userCart.id}
    `);
    await rawQuery(sql`
      WITH gone AS (
        DELETE FROM cart_items WHERE cart_id = ${guestCartId}
      )
      DELETE FROM carts WHERE id = ${guestCartId}
    `);
  }

  return userCart.token;
}

export async function getCartDetail(
  cartId: string | null,
  userId: string | null = null,
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
    rawQuery<CartRow>(sql`
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
  `),
    getAttachedPromo(cartId, userId),
  ]);
  return mapCart(rows, promo);
}

export async function addCartItem(
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<void> {
  const rows = await rawQuery<{ stock: number }>(
    sql`SELECT stock_quantity AS stock
        FROM product_variants
        WHERE id = ${variantId} AND is_active`,
  );
  const stock = rows[0]?.stock ?? 0;
  if (stock <= 0) {
    throw new CartError("This variant is unavailable", 409);
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
  quantity: number,
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
  if (stock == null) throw new CartError("Cart item not found", 404);

  await rawQuery(sql`
    UPDATE cart_items
    SET quantity = LEAST(${quantity}::int, ${stock}::int)
    WHERE id = ${itemId}::uuid AND cart_id = ${cartId}::uuid
  `);
}

export async function removeCartItem(
  cartId: string,
  itemId: string,
): Promise<void> {
  await rawQuery(
    sql`DELETE FROM cart_items WHERE id = ${itemId}::uuid AND cart_id = ${cartId}::uuid`,
  );
}

export async function clearCart(cartId: string): Promise<void> {
  await rawQuery(sql`DELETE FROM cart_items WHERE cart_id = ${cartId}`);
}

export class CartError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}