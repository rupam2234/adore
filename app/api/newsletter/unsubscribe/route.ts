import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db, newsletterSubscribers } from '@/utils/db';
import { verifyUnsubscribeToken } from '@/utils/newsletter';

/**
 * GET /api/newsletter/unsubscribe?email=...&sig=...
 *
 * ONE-CLICK unsubscribe — no confirmation step, by design. The `sig` HMAC
 * (see utils/newsletter.ts) is what prevents anyone from unsubscribing an
 * arbitrary email address; the click itself is the user's confirmation.
 *
 * Renders a tiny standalone HTML page rather than JSON: this link is clicked
 * from an email client, so the visitor must see a human-readable result.
 * Unknown emails still render success (idempotent, and avoids confirming
 * whether an address is on the list).
 */

function page(title: string, body: string): NextResponse {
  const html = `<!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${title}</title></head>
      <body style="margin:0;background:#2B2620;color:#FAF8F3;font-family:Georgia,'Times New Roman',serif;">
        <div style="max-width:480px;margin:0 auto;padding:64px 24px;text-align:center;">
          <h1 style="font-weight:normal;font-size:22px;margin:0 0 12px;">${title}</h1>
          <p style="font-size:14px;line-height:1.7;color:rgba(250,248,243,0.6);margin:0;">
            ${body}
          </p>
        </div>
      </body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 254);
  const sig = url.searchParams.get('sig');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return page(
      'Invalid link',
      'This unsubscribe link is malformed. If you received it in an email from us, please write to us and we will remove you manually.'
    );
  }

  // Fail closed: a missing or forged signature unsubscribes nobody.
  if (!verifyUnsubscribeToken(email, sig)) {
    return page(
      'Link expired',
      'This unsubscribe link is not valid. If you received it in an email from us, please write to us and we will remove you manually.'
    );
  }

  try {
    // Idempotent: unsubscribing twice (or an address that was never subscribed,
    // thanks to the WHERE clause matching nothing) is still a success.
    await db
      .update(newsletterSubscribers)
      .set({ unsubscribedAt: sql`now()` })
      .where(eq(newsletterSubscribers.email, email));

    return page(
      'You are unsubscribed',
      'You will not receive any more marketing emails from us. Your order emails (confirmations, shipping) are unaffected.'
    );
  } catch (error) {
    console.error('[newsletter] unsubscribe failed:', error);
    return page(
      'Something went wrong',
      'We could not process that right now. Please try again, or write to us and we will remove you manually.'
    );
  }
}
