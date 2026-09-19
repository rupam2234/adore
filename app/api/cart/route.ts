import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { CART_COOKIE, resolveCartId, getCartDetail, clearCart } from "@/utils/cart";
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

async function currentShopper() {
  const [token, userId] = await Promise.all([
    (async () => (await cookies()).get(CART_COOKIE)?.value)(),
    getSessionUserId(),
  ]);
  return { token, userId };
}

export async function GET() {
  const { token, userId } = await currentShopper();
  const cartId = await resolveCartId(userId, token);
  return noStore(NextResponse.json(await getCartDetail(cartId, userId)));
}

export async function DELETE() {
  const { token, userId } = await currentShopper();
  const cartId = await resolveCartId(userId, token);
  if (cartId) {
    await clearCart(cartId);
    await removePromo(cartId);
  }
  return noStore(NextResponse.json(await getCartDetail(cartId, userId)));
}
