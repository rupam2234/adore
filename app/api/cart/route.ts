import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { CART_COOKIE, findCartId, getCartDetail, clearCart } from "@/utils/cart";
import { removePromo } from "@/utils/promo";
import { getSessionUserId } from "@/utils/request-user";

/**
 * Cart payloads are per-visitor, so a cached response must never be replayed
 * for a different shopper. Reading `cookies()` already forces a dynamic render,
 * but an explicit header makes the response uncacheable regardless of how the
 * platform defaults change.
 */
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  const cartId = await findCartId(token);
  const userId = await getSessionUserId();
  return noStore(NextResponse.json(await getCartDetail(cartId, userId)));
}

export async function DELETE() {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  const cartId = await findCartId(token);
  if (cartId) {
    await clearCart(cartId);
    await removePromo(cartId);
  }
  const userId = await getSessionUserId();
  return noStore(NextResponse.json(await getCartDetail(cartId, userId)));
}
