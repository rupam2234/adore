import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { CART_COOKIE, findCartId, getCartDetail, clearCart } from "@/utils/cart";

export async function GET() {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  const cartId = await findCartId(token);
  return NextResponse.json(await getCartDetail(cartId));
}

export async function DELETE() {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  const cartId = await findCartId(token);
  if (cartId) await clearCart(cartId);
  return NextResponse.json(await getCartDetail(cartId));
}
