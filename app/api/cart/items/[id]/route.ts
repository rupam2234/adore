import { NextResponse } from "next/server";
import {
  findCartId,
  getCartDetail,
  updateCartItem,
  removeCartItem,
  CartError,
} from "@/utils/cart";
import { cookies } from "next/headers";
import { CART_COOKIE } from "@/utils/cart";

type Context = { params: Promise<{ id: string }> };

async function requireCartId(): Promise<string | null> {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  return findCartId(token);
}

export async function PATCH(request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const cartId = await requireCartId();
    if (!cartId) throw new CartError("Cart not found", 404);

    const body = await request.json();
    const quantity = Number(body?.quantity);
    if (!Number.isFinite(quantity)) {
      return NextResponse.json({ error: "quantity is required" }, { status: 400 });
    }
    await updateCartItem(cartId, id, quantity);
    return NextResponse.json(await getCartDetail(cartId));
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
    const cartId = await requireCartId();
    if (!cartId) throw new CartError("Cart not found", 404);

    await removeCartItem(cartId, id);
    return NextResponse.json(await getCartDetail(cartId));
  } catch (error) {
    if (error instanceof CartError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not remove item" }, { status: 500 });
  }
}
