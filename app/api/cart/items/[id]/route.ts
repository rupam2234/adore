import { NextResponse } from "next/server";
import {
  resolveCartId,
  getCartDetail,
  updateCartItem,
  removeCartItem,
  CartError,
} from "@/utils/cart";
import { cookies } from "next/headers";
import { CART_COOKIE } from "@/utils/cart";
import { getSessionUserId } from "@/utils/request-user";
import { revalidateAttachedPromo } from "@/utils/promo";

type Context = { params: Promise<{ id: string }> };

/** Resolve the cart AND the session user in one pass (single JWT verify). */
async function requireShopper(): Promise<{
  cartId: string | null;
  userId: string | null;
}> {
  const [token, userId] = await Promise.all([
    (async () => (await cookies()).get(CART_COOKIE)?.value)(),
    getSessionUserId(),
  ]);
  return { cartId: await resolveCartId(userId, token), userId };
}

export async function PATCH(request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const { cartId, userId } = await requireShopper();
    if (!cartId) throw new CartError("Cart not found", 404);

    const body = await request.json();
    const quantity = Number(body?.quantity);
    if (!Number.isFinite(quantity)) {
      return NextResponse.json({ error: "quantity is required" }, { status: 400 });
    }
    await updateCartItem(cartId, id, quantity);
    await revalidateAttachedPromo(cartId, userId);
    return NextResponse.json(await getCartDetail(cartId, userId));
  } catch (error) {
    if (error instanceof CartError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not update cart" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const { cartId, userId } = await requireShopper();
    if (!cartId) throw new CartError("Cart not found", 404);

    await removeCartItem(cartId, id);
    await revalidateAttachedPromo(cartId, userId);
    return NextResponse.json(await getCartDetail(cartId, userId));
  } catch (error) {
    if (error instanceof CartError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not remove item" }, { status: 500 });
  }
}
