import { NextRequest, NextResponse } from 'next/server';
import { login, setAuthCookies } from '@/utils/auth';
import {
  CART_COOKIE,
  cartCookieOptions,
  findCartId,
  mergeGuestCart,
} from '@/utils/cart';

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password are required' },
      { status: 400 }
    );
  }

  try {
    const result = await login(email.trim().toLowerCase(), password);
    // console.log("Login result:", { success: result.success, error: result.error, hasTokens: !!(result.accessToken && result.refreshToken) });

    if (!result.success || !result.accessToken || !result.refreshToken) {
      return NextResponse.json(
        { error: result.error ?? 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Account-based cart: fold the guest cookie cart into the account cart so
    // the bag follows the user across devices. Guest + account carts are
    // merged; the cookie is refreshed to the account cart's token.
    let cartToken: string | null = null;
    try {
      const guestToken = request.cookies.get(CART_COOKIE)?.value;
      const guestCartId = await findCartId(guestToken);
      cartToken = await mergeGuestCart(result.user!.id, guestCartId);
    } catch (err) {
      console.error('Cart merge failed (login continues):', err);
    }

    const cookies = setAuthCookies(result.accessToken, result.refreshToken);

    const response = NextResponse.json(
      {
        user: {
          id: result.user!.id,
          email: result.user!.email,
          name: result.user!.name,
          role: result.user!.role,
        },
      },
      { status: 200 }
    );

    response.cookies.set(
      cookies.access.name,
      cookies.access.value,
      cookies.access.options
    );
    response.cookies.set(
      cookies.refresh.name,
      cookies.refresh.value,
      cookies.refresh.options
    );
    // Client-readable login hint so guests can skip /api/auth/me entirely.
    response.cookies.set(
      cookies.loggedIn.name,
      cookies.loggedIn.value,
      cookies.loggedIn.options
    );

    if (cartToken) {
      response.cookies.set(CART_COOKIE, cartToken, cartCookieOptions());
    }

    return response;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json(
      { error: 'Server error. Check console for details.' },
      { status: 500 }
    );
  }
}
