import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { rawQuery, sql } from '@/utils/db';
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from '@/utils/returns-ops';

/**
 * POST /api/webhooks/resend — inbound delivery events from Resend.
 *
 * WHY THIS MATTERS
 * ----------------
 * Resend reports whether an email actually arrived. Without this, a bounce is
 * invisible: the queue marks the job SENT the moment the API accepts it, and a
 * hard bounce (a mistyped address, a full mailbox) would never be discovered.
 * That matters here because your `customers.email` comes from checkout form
 * input, so bad addresses WILL happen.
 *
 * A hard bounce is a PERMANENT failure. Retrying it is pointless — the address
 * does not exist — so the job goes DEAD rather than burning five attempts and
 * an hour of backoff on something that can never succeed. Retrying that address
 * also degrades your sending reputation, which is how a small store ends up
 * silently filtered as spam by Gmail.
 *
 * Security: verified with Resend's Svix signing secret, the same way
 * app/api/webhooks/razorpay/route.ts verifies Razorpay. Without this anyone
 * could POST a fake bounce and mark a customer's order email as undelivered.
 *
 * Replay protection reuses `claimWebhookEvent` (provider = 'resend'), so a
 * retried delivery event is acknowledged and dropped rather than re-processed.
 * Resend retries webhooks, and on serverless a retry lands on a different
 * instance, so the dedupe has to live in the database.
 */

/** Events we act on. Everything else is acknowledged and ignored. */
const HARD_BOUNCES = new Set(['email.bounced', 'email.complained']);

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed. Without this, the endpoint would accept forged events.
    console.error('[webhooks/resend] RESEND_WEBHOOK_SECRET not set');
    return false;
  }
  if (!signature) return false;

  // Svix format: "v1,<base64 signature>". Multiple values are space-separated.
  const parts = signature.split(' ');
  const candidate = parts.find(p => p.startsWith('v1,'))?.slice(3);
  if (!candidate) return false;

  // Svix signs "<timestamp>.<body>" to prevent replay of a captured request.
  const timestamp = parts[0] ?? '';
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('base64');

  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so check first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type ResendEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    from?: string;
    bounce?: { message?: string; type?: string };
  };
};

export async function POST(request: Request) {
  // The RAW body is required: re-serialising it changes the bytes and the
  // signature check fails. This is why the handler does not call request.json()
  // before verifying.
  const rawBody = await request.text();

  const signature =
    request.headers.get('svix-signature') ??
    request.headers.get('webhook-signature');

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventId = `${event.type}:${event.data?.email_id ?? event.created_at ?? rawBody.length}`;
  const first = await claimWebhookEvent(
    'resend',
    eventId,
    event.type,
    event
  );
  if (!first) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    // Only hard bounces change job state. `delivered` needs no write — the job
    // was already marked SENT when the API accepted it.
    if (HARD_BOUNCES.has(event.type)) {
      const providerId = event.data?.email_id;
      const reason =
        event.data?.bounce?.message ??
        event.data?.bounce?.type ??
        event.type;

      if (providerId) {
        const rows = await rawQuery<{ id: string }>(sql`
          UPDATE email_jobs
          SET status = 'DEAD', last_error = ${`bounced: ${reason}`.slice(0, 500)}
          WHERE provider_id = ${providerId}
            AND status = 'SENT'
          RETURNING id
        `);
        if (rows.length > 0) {
          console.warn(
            `[webhooks/resend] hard bounce, marked DEAD: job=${rows[0].id} reason=${reason}`
          );
        }
      }
    }

    await completeWebhookEvent('resend', eventId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failWebhookEvent('resend', eventId, message).catch(() => {});
    console.error('[webhooks/resend] handler failed:', message);
    // 500 so Resend retries: an event we failed to record should come back.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
}