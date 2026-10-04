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
 * Signups per IP per hour.
 *
 * Keyed on IP rather than customer because there is no customer yet. This is a
 * burst cap, not an airtight global limit — utils/rate-limit.ts documents that
 * it is per server instance — and that is the right trade here: it stops a naive
 * script without adding infrastructure, and the durable limits (one account per
 * phone, global redemption cap) are what actually bound the damage.
 */
const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  // Rate limited BEFORE the body is parsed, so a flood costs nothing beyond the
  // limiter itself.
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

  // Phone is required at signup, which is a deliberate change from before. It
  // is what makes the one-account-per-phone guarantee possible, and that
  // guarantee is the only thing here that meaningfully raises the cost of
  // farming welcome codes. We also need a reachable number for delivery
  // questions anyway, so asking now saves asking twice later.
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
    // ensureCustomer carries the phone onto the customers row, which is where
    // the one-account-per-phone unique index lives. A collision here is a
    // SECOND ACCOUNT on a number we have already seen — the exact abuse case
    // this feature exists to stop — so it is reported as a 409 rather than
    // swallowed like the other non-fatal provisioning failures below.
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
      // The account row exists but has no customer row, so nothing the customer
      // can see is inconsistent. Clean it up so the email stays free to be
      // reused and a retry starts from a clean slate.
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

    // Welcome email + first-order code.
    //
    // Enqueued through the durable outbox rather than sent inline, for two
    // reasons. The account already exists and is already logged in, so nothing
    // here is on the critical path and the customer should not wait on Resend.
    // And `welcome_email/<user-id>` is a dedupe key derived from the id we just
    // got back, so a customer who double-taps the button cannot receive two
    // copies — the second enqueue is a no-op at the UNIQUE index.
    //
    // Wrapped in try/catch because issueWelcomeCode already swallows its own
    // failures; this guard is for the enqueue itself, and a missing welcome
    // email must never cost someone the account they just created.
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
