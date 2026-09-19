import { NextRequest, NextResponse } from 'next/server';
import {
  hashPassword,
  getUserByEmail,
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  storeSession,
  db,
  users,
} from '@/utils';
import {
  CART_COOKIE,
  cartCookieOptions,
  findCartId,
  mergeGuestCart,
} from '@/utils/cart';
import { REFRESH_TTL_MS } from '@/utils/auth';

export async function POST(request: NextRequest) {
  let body: { name?: string; email?: string; password?: string };
  try {
    body = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
    };
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const name = body.name?.trim() ?? '';
  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json(
      { error: 'Enter a valid email address' },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    );
  }

  try {
    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const inserted = await db
      .insert(users)
      .values({ name, email, passwordHash, role: 'user' })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      });
    const user = inserted[0];

    const payload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = await signAccessToken(payload);
    const refreshToken = await signRefreshToken(payload);
    if (!accessToken || !refreshToken) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    await storeSession(
      user.id,
      refreshToken,
      new Date(Date.now() + REFRESH_TTL_MS)
    );

    const cookies = setAuthCookies(accessToken, refreshToken);
    try {
      const { ensureCustomer } = await import('@/utils/account');
      await ensureCustomer(user);
    } catch (err) {
      console.error('Customer provisioning failed:', err);
    }

    // Adopt the guest cookie cart so the new account keeps its bag.
    let cartToken: string | null = null;
    try {
      const guestCartId = await findCartId(
        request.cookies.get(CART_COOKIE)?.value
      );
      cartToken = await mergeGuestCart(user.id, guestCartId);
    } catch (err) {
      console.error('Cart merge failed (signup continues):', err);
    }

    const response = NextResponse.json({ user }, { status: 201 });
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
    if (err instanceof Error && err.message.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }
    console.error('Register error:', err);
    return NextResponse.json(
      { error: 'Server error. Please try again.' },
      { status: 500 }
    );
  }
}
