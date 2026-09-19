import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  CART_COOKIE,
  CART_MAX_AGE,
  addCartItem,
  resolveCartId,
  getCartDetail,
  CartError,
} from "@/utils/cart";
import { rawQuery, sql } from "@/utils/db";
import { getSessionUserId } from "@/utils/request-user";
import { revalidateAttachedPromo } from "@/utils/promo";

/**
 * Resolve the active cart (account cart first, cookie fallback) or create a
 * fresh anonymous cart. Returns the cartId plus the token to persist in the
 * cookie when a new cart was created.
 */
async function getOrCreateCartId(
  userId: string | null,
): Promise<{ cartId: string; token?: string }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CART_COOKIE)?.value;

  const existing = await resolveCartId(userId, token);
  if (existing) return { cartId: existing };

  const newToken = crypto.randomUUID();
  const rows = await rawQuery<{ id: string }>(
    sql`INSERT INTO carts (id, token) VALUES (gen_random_uuid(), ${newToken})
        ON CONFLICT (token) DO UPDATE SET updated_at = now()
        RETURNING id`,
  );
  cookieStore.set(CART_COOKIE, newToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CART_MAX_AGE,
    path: "/",
  });
  return { cartId: rows[0]!.id, token: newToken };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const variantId = typeof body?.variantId === "string" ? body.variantId : "";
    const quantity = Number(body?.quantity) || 1;
    if (!variantId) {
      return NextResponse.json({ error: "variantId is required" }, { status: 400 });
    }
    const userId = await getSessionUserId();
    const { cartId } = await getOrCreateCartId(userId);
    await addCartItem(cartId, variantId, quantity);
    await revalidateAttachedPromo(cartId, userId);
    return NextResponse.json(await getCartDetail(cartId, userId));
  } catch (error) {
    if (error instanceof CartError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not add to cart" }, { status: 500 });
  }
}
