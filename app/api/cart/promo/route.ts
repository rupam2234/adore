import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { CART_COOKIE, resolveCartId, getCartDetail } from "@/utils/cart";
import { applyPromo, removePromo, PromoError } from "@/utils/promo";
import { getSessionUserId } from "@/utils/request-user";

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Log in to use promo codes" },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as { code?: string };
    if (typeof body?.code !== "string" || !body.code.trim()) {
      return NextResponse.json({ error: "Enter a promo code" }, { status: 400 });
    }

    const token = (await cookies()).get(CART_COOKIE)?.value;
    const cartId = await resolveCartId(userId, token);
    if (!cartId) {
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    }

    await applyPromo(cartId, userId, body.code);
    return NextResponse.json(await getCartDetail(cartId, userId));
  } catch (error) {
    if (error instanceof PromoError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Could not apply promo code" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const [token, userId] = await Promise.all([
    (async () => (await cookies()).get(CART_COOKIE)?.value)(),
    getSessionUserId(),
  ]);
  const cartId = await resolveCartId(userId, token);
  if (cartId) await removePromo(cartId);
  return NextResponse.json(await getCartDetail(cartId, userId));
}
