import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import {
  hashPassword,
  getUserByEmail,
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  storeSession,
  revokeSession,
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
import { rateLimit } from '@/utils/rate-limit';
import { normalisePhone } from '@/utils/phone';
import { issueWelcomeCode } from '@/utils/welcome-promo';
import { PhoneAlreadyRegisteredError } from '@/utils/account';
import { enqueueAndNotify } from '@/utils/email-queue';
import {
  WELCOME_DISCOUNT_PERCENT,
  WELCOME_MIN_ORDER,
  WELCOME_VALIDITY_LABEL,
} from '@/utils/welcome-promo-config';

/**
 * Signups per IP per hour. Burst cap only — it is per server instance, and the
 * real limits are one-account-per-phone plus the global redemption cap.
 */
const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  // Limited before parsing the body, so a flood costs nothing extra.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = rateLimit(`register:${ip}`, {
    limit: REGISTER_LIMIT,
    windowMs: REGISTER_WINDOW_MS,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Too many accounts created from this connection. Please try again in ${limit.retryAfterSeconds}s.`,
        code: 'RATE_LIMITED',
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let body: { name?: string; email?: string; password?: string; phone?: string };
  try {
    body = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
      phone?: string;
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

  // Phone at signup is what makes the one-account-per-phone guarantee possible,
  // which is the only real brake on farming welcome codes.
  const rawPhone = body.phone?.trim() ?? '';
  if (!rawPhone) {
    return NextResponse.json(
      { error: 'Mobile number is required' },
      { status: 400 }
    );
  }
  const phone = normalisePhone(rawPhone);
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid 10-digit mobile number' },
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
    // Carries the phone onto the customers row, where the one-account-per-phone
    // index lives. A collision is the exact abuse this feature stops, so it is a
    // 409 rather than a swallowed provisioning failure.
    let phoneInUse = false;
    try {
      const { ensureCustomer } = await import('@/utils/account');
      await ensureCustomer({ ...user, phone });
    } catch (err) {
      if (err instanceof PhoneAlreadyRegisteredError) {
        phoneInUse = true;
      } else {
        console.error('Customer provisioning failed:', err);
      }
    }

    if (phoneInUse) {
      // No customer row exists yet, so nothing visible is inconsistent. Clean up
      // to free the email and leave a clean slate for a retry.
      await db.delete(users).where(eq(users.id, user.id));
      await revokeSession(user.id);
      return NextResponse.json(
        {
          error:
            'An account already exists with this mobile number. Try logging in instead.',
          code: 'PHONE_IN_USE',
        },
        { status: 409 }
      );
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

    // Welcome email + first-order code, via the durable outbox so signup never
    // waits on Resend. The `welcome_email/<user-id>` dedupe key makes a
    // double-tap a no-op at the UNIQUE index. try/catch so a missing welcome
    // email never costs someone the account they just created.
    try {
      const welcome = await issueWelcomeCode(user.id);
      await enqueueAndNotify({
        flow: 'welcome_email',
        to: user.email,
        dedupeKey: `welcome_email/${user.id}`,
        payload: {
          customerName: user.name,
          promoCode: welcome?.code ?? null,
          promoValidFor: welcome ? WELCOME_VALIDITY_LABEL : undefined,
          discountPercent: welcome ? WELCOME_DISCOUNT_PERCENT : undefined,
          minimumOrder: welcome ? WELCOME_MIN_ORDER : undefined,
        },
      });
    } catch (err) {
      console.error('Welcome email enqueue failed (signup continues):', err);
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
