import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed one-click unsubscribe tokens.
 *
 * Every marketing email will carry an unsubscribe link of the form
 *   `${SITE_URL}/api/newsletter/unsubscribe?email=...&sig=...`
 * where `sig` is an HMAC of the email. Without the signature, the endpoint
 * would let anyone unsubscribe anyone else by iterating email addresses —
 * a real (if low-stakes) abuse vector. With it, only links WE generated work.
 *
 * No confirmation page or email — the user asked for friction-free opt-out
 * (also what RFC 8058 one-click unsubscribe and most spam filters expect).
 */

function secret(): string {
  // Any long-lived secret already in the env works; NEWSLETTER_SECRET wins so
  // rotation of other secrets can't invalidate every old unsubscribe link.
  const s =
    process.env.NEWSLETTER_SECRET ??
    process.env.CRON_SECRET ??
    process.env.RESEND_API_KEY;
  if (!s) {
    throw new Error(
      'Newsletter secret not configured (set NEWSLETTER_SECRET or CRON_SECRET)'
    );
  }
  return s;
}

export function signUnsubscribeToken(email: string): string {
  return createHmac('sha256', secret()).update(email.toLowerCase()).digest('hex');
}

export function verifyUnsubscribeToken(
  email: string,
  sig: string | null
): boolean {
  if (!sig) return false;
  const expected = signUnsubscribeToken(email);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** Build the one-click unsubscribe URL for an outgoing email. */
export function buildUnsubscribeUrl(email: string): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://adore.ind.in';
  const lower = email.toLowerCase();
  return `${site}/api/newsletter/unsubscribe?email=${encodeURIComponent(
    lower
  )}&sig=${signUnsubscribeToken(lower)}`;
}
