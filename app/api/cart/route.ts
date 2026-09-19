import { NextResponse } from 'next/server';
import { getCartShopper, getCartDetail, clearCart } from '@/utils/cart';
import { removePromo } from '@/utils/promo';

/**
 * Cart payloads are per-visitor, so a cached response must never be replayed
 * for a different shopper. Reading `cookies()` already forces a dynamic render,
 * but an explicit header makes the response uncacheable regardless of how the
 * platform defaults change.
 */
function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET() {
  const { cartId, userId } = await getCartShopper();
  return noStore(NextResponse.json(await getCartDetail(cartId, userId)));
}

export async function DELETE() {
  const { cartId, userId } = await getCartShopper();
  if (cartId) {
    await clearCart(cartId);
    await removePromo(cartId);
  }
  return noStore(NextResponse.json(await getCartDetail(cartId, userId)));
}
