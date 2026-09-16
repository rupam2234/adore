import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { CART_COOKIE, findCartId, getCartDetail, clearCart } from "@/utils/cart";
import { removePromo } from "@/utils/promo";
import { getSessionUserId } from "@/utils/request-user";

export async function GET() {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  const cartId = await findCartId(token);
  const userId = await getSessionUserId();
  return NextResponse.json(await getCartDetail(cartId, userId));
}

export async function DELETE() {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  const cartId = await findCartId(token);
  if (cartId) {
    await clearCart(cartId);
    await removePromo(cartId);
  }
  const userId = await getSessionUserId();
  return NextResponse.json(await getCartDetail(cartId, userId));
}
