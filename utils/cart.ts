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

export async function getCartDetail(
  cartId: string | null,
  userId: string | null = null,
): Promise<CartSummary> {
  // No cart → nothing to report, so return BEFORE the housekeeping sweep. The
  // sweep is two sequential round-trips (~2 x 114ms on the Neon HTTP driver)
  // and its result is discarded here: an empty bag has no availability to show.
  // Guests with no cart (the bulk of page loads) take this path every time.
  if (!cartId) return EMPTY_CART;

  // Lazy housekeeping: expired checkout reservations go back on sale here, so
  // the bag always shows true availability. Idempotent and cheap. Checkout
  // (reserveCartItems) sweeps too, so an expired hold is never stranded.
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
  await rawQuery(sql`
    INSERT INTO cart_items (id, cart_id, variant_id, quantity)
    VALUES (gen_random_uuid(), ${cartId}, ${variantId}, ${Math.min(wanted, stock)})
    ON CONFLICT (cart_id, variant_id)
    DO UPDATE SET quantity = LEAST(cart_items.quantity + ${wanted}, ${stock})
  `);
  await rawQuery(
    sql`UPDATE carts SET updated_at = now() WHERE id = ${cartId}`,
  );
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
