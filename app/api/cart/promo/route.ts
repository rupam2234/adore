import { NextResponse } from 'next/server';
import { getCartShopper, getCartDetail } from '@/utils/cart';
import { applyPromo, removePromo, PromoError } from '@/utils/promo';

export async function POST(request: Request) {
  const { cartId, userId } = await getCartShopper();
  if (!userId) {
    return NextResponse.json(
      { error: 'Log in to use promo codes' },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json()) as { code?: string };
    if (typeof body?.code !== 'string' || !body.code.trim()) {
      return NextResponse.json(
        { error: 'Enter a promo code' },
        { status: 400 }
      );
    }

    if (!cartId) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
    }

    await applyPromo(cartId, userId, body.code);
    return NextResponse.json(await getCartDetail(cartId, userId));
  } catch (error) {
    if (error instanceof PromoError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: 'Could not apply promo code' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const { cartId, userId } = await getCartShopper();
  if (cartId) await removePromo(cartId);
  return NextResponse.json(await getCartDetail(cartId, userId));
}
