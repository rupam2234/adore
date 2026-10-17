import { NextResponse } from 'next/server';
import { rateLimit } from '@/utils/rate-limit';
import { db, newsletterSubscribers } from '@/utils/db';

/**
 * POST /api/newsletter — footer newsletter signup.
 *
 * Stores the email in `newsletter_subscribers`. A repeat signup is a SUCCESS
 * no-op (the UNIQUE index + ON CONFLICT DO NOTHING), because from the visitor's
 * point of view "already on the list" and "now on the list" are the same
 * outcome — no email enumeration, no error noise.
 *
 * Rate-limited by IP (Vercel KV) like /api/contact, since the endpoint writes
 * to the database and is reachable by anyone.
 */

const NEWSLETTER_LIMIT = { limit: 3, windowMs: 60_000 }; // 3 signups/minute per IP

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  );
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Rate limit by IP before touching the database.
  const ip = clientIp(request);
  const limit = rateLimit(`newsletter:${ip}`, NEWSLETTER_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    );
  }

  // 2. Parse + validate.
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const email =
    typeof body.email === 'string'
      ? body.email.trim().toLowerCase().slice(0, 254)
      : '';

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: 'Enter a valid email address' },
      { status: 400 }
    );
  }

  // 3. Persist. Idempotent on the UNIQUE email: a duplicate is reported as
  //    success, never a 500. A previously-unsubscribed email is re-subscribed
  //    (unsubscribed_at cleared) — the click itself is the consent.
  try {
    await db
      .insert(newsletterSubscribers)
      .values({ email, source: 'footer' })
      .onConflictDoUpdate({
        target: newsletterSubscribers.email,
        set: { unsubscribedAt: null },
      });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[newsletter] subscribe failed:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
