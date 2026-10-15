import { NextResponse } from 'next/server';
import { rateLimit } from '@/utils/rate-limit';
import { sendContactFormEmail } from '@/utils/email';

/**
 * POST /api/contact — Contact form submission.
 *
 * Rate-limited by IP to prevent spam. Validates required fields and sends
 * the message to the support inbox via Resend. The customer's email is set
 * as reply-to so the team can respond directly.
 */

const CONTACT_LIMIT = { limit: 5, windowMs: 60_000 }; // 5 submissions/minute per IP

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  );
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeInput(input: string): string {
  // Strip control characters but preserve newlines for message body
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Rate limit by IP
  const ip = clientIp(request);
  const limit = rateLimit(`contact:${ip}`, CONTACT_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    );
  }

  // 2. Parse form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  // 3. Extract and validate fields
  const name = sanitizeInput(String(formData.get('name') ?? '').trim());
  const email = sanitizeInput(
    String(formData.get('email') ?? '')
      .trim()
      .toLowerCase()
  );
  const order = sanitizeInput(
    String(formData.get('order') ?? '')
      .trim()
      .toUpperCase()
  );
  const subject = sanitizeInput(String(formData.get('subject') ?? '').trim());
  const message = sanitizeInput(String(formData.get('message') ?? '').trim());

  const errors: Record<string, string> = {};

  if (!name) errors.name = 'Name is required';
  if (!email) errors.email = 'Email is required';
  else if (!isValidEmail(email)) errors.email = 'Enter a valid email address';
  if (!message) errors.message = 'Message is required';
  else if (message.length < 10)
    errors.message = 'Message must be at least 10 characters';
  else if (message.length > 5000)
    errors.message = 'Message is too long (max 5000 characters)';

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  // 4. Send email to support inbox
  const SUPPORT_EMAIL = process.env.CONTACT_EMAIL ?? 'contact@adore.ind.in';

  const result = await sendContactFormEmail({
    to: SUPPORT_EMAIL,
    name,
    customerEmail: email,
    orderNumber: order || undefined,
    subject,
    message,
  });

  if (!result.ok) {
    console.error('[contact] Failed to send email:', result.error);
    return NextResponse.json(
      { error: 'Could not send your message. Please try again later.' },
      { status: 500 }
    );
  }

  // 5. Success
  return NextResponse.json({ ok: true });
}
