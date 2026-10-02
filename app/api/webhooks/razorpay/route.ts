import { NextResponse } from 'next/server';
import { rateLimit } from '@/utils/rate-limit';
import { verifyWebhookSignature } from '@/utils/razorpay';
import { rawQuery, sql } from '@/utils/db';
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  recordDispute,
  resolveDispute,
} from '@/utils/returns-ops';

/**
 * POST /api/webhooks/razorpay — refund confirmations and disputes.
 *
 * Two jobs, both security-critical:
 *
 *  1. `refund.processed` / `refund.failed` — the asynchronous confirmation of a
 *     refund we already claimed. This is what moves REFUND_PENDING to REFUNDED
 *     when Razorpay took the money at T+1 rather than instantly.
 *
 *  2. `payment.dispute.created` — the chargeback signal. This is the single most
 *     valuable fraud input in the system, and it is the reason a customer who
 *     refunds an item and then disputes the payment cannot get paid twice.
 *
 * Signature verification uses the RAW body. Reading the body twice (once for the
 * signature, once for JSON.parse) is not possible on a standard Request, so we
 * read it as text and parse from that — a re-serialised parse would change the
 * bytes and break the HMAC.
 *
 * IMPORTANT: this endpoint deliberately CANNOT move a return to REFUNDED on its
 * own authority. It only confirms a refund we already issued against a ledger
 * row we already wrote. A forged `refund.processed` for an arbitrary refund id
 * updates nothing, because the update is keyed on our own `refunds` row.
 */

const IP_LIMIT = { limit: 120, windowMs: 60_000 };

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(request: Request) {
  // If the webhook secret is not configured, refuse everything rather than
  // accepting unsigned events.
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const limit = rateLimit(`razorpay-hook:${clientIp(request)}`, IP_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  // Raw body for the HMAC, then parse from that same string.
  const raw = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = String(event.event ?? '');
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  // Razorpay's payload shape is `payload.<thing>.entity.<field>` — e.g.
  // payload.refund.entity.id and payload.dispute.entity.payment_id. Getting this
  // wrong is silent: the id comes back as '' and the handler simply does
  // nothing, so a refund sits in REFUND_PENDING forever with no error anywhere.
  const entity = (key: 'refund' | 'payment' | 'dispute') =>
    (payload[key] as Record<string, unknown> | undefined)?.entity as
      | Record<string, unknown>
      | undefined;

  /**
   * Dedupe key.
   *
   * Prefers Razorpay's own `x-razorpay-event-id` header, which the docs specify
   * is unique per event and is the recommended way to detect duplicates. The
   * payload-derived key is only a fallback, because Razorpay delivers
   * at-least-once and may re-send with a different timestamp.
   */
  const eventId =
    request.headers.get('x-razorpay-event-id')?.trim() ||
    `${eventType}:${String(
      entity('refund')?.id ??
        entity('dispute')?.id ??
        entity('payment')?.id ??
        event.created_at
    )}`;

  const first = await claimWebhookEvent('razorpay', eventId, eventType, event);
  if (!first) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    switch (eventType) {
      case 'refund.processed': {
        const refundId = String(entity('refund')?.id ?? '');
        if (refundId) await markRefundProcessed(refundId);
        break;
      }

      case 'refund.failed': {
        const refundId = String(entity('refund')?.id ?? '');
        if (refundId) await markRefundFailedRemote(refundId);
        break;
      }

      // Chargeback raised by the issuing bank. This is the highest-value fraud
      // signal in the system: a customer who refunds an item and then disputes
      // the payment has taken the money twice.
      case 'payment.dispute.created': {
        const dispute = entity('dispute');
        // `payment_id` lives on the DISPUTE entity, so we do not need to dig
        // into payload.payment at all.
        const paymentId = String(dispute?.payment_id ?? '');
        if (!paymentId) break;
        // `amount` is in paise on the wire.
        const amountPaise = Number(dispute?.amount ?? 0);
        await recordDispute({
          disputeId: String(dispute?.id ?? `dispute_${eventId}`),
          paymentId,
          amount: Number.isFinite(amountPaise) ? amountPaise / 100 : 0,
          // Razorpay sends `reason_code` (a machine slug), not `reason`.
          reason:
            typeof dispute?.reason_code === 'string' ? dispute.reason_code : null,
        });
        break;
      }

      // Won / lost are the two events that actually matter. `closed` alone does
      // not tell us the outcome, and losing means the bank has already returned
      // the money — so a customer who also refunded has been paid twice.
      case 'payment.dispute.won': {
        const id = String(entity('dispute')?.id ?? '');
        if (id) await resolveDispute({ disputeId: id, status: 'WON' });
        break;
      }

      case 'payment.dispute.lost': {
        const id = String(entity('dispute')?.id ?? '');
        if (id) await resolveDispute({ disputeId: id, status: 'LOST' });
        break;
      }

      // `closed` fires for both outcomes, so we fall back to the entity's own
      // status rather than guessing. Under-review and action-required are
      // progress notifications, not resolutions, so they are recorded and
      // ignored.
      case 'payment.dispute.closed': {
        const dispute = entity('dispute');
        const id = String(dispute?.id ?? '');
        const status = String(dispute?.status ?? '').toLowerCase();
        if (!id) break;
        if (status === 'lost') {
          await resolveDispute({ disputeId: id, status: 'LOST' });
        } else if (status === 'won') {
          await resolveDispute({ disputeId: id, status: 'WON' });
        } else if (status === 'withdrawn') {
          await resolveDispute({ disputeId: id, status: 'WITHDRAWN' });
        }
        break;
      }

      case 'payment.dispute.under_review':
      case 'payment.dispute.action_required':
      case 'refund.created':
      case 'refund.speed_changed':
      case 'payment.captured':
      case 'payment.authorized':
      case 'order.paid':
        // Acknowledged and ignored. The first two are progress notifications on a
        // dispute; the rest belong to checkout, which verifies synchronously.
        break;

      default:
        // Unknown event: recorded in webhook_events, then ignored. Razorpay adds
        // events regularly, and an unrecognised one must never be a 500.
        break;
    }

    await completeWebhookEvent('razorpay', eventId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[razorpay-webhook] handler failed:', error);
    await failWebhookEvent('razorpay', eventId, message).catch(() => {});
    return NextResponse.json(
      { error: 'Could not process the event' },
      { status: 500 }
    );
  }
}

/**
 * A refund we issued has been confirmed by the bank.
 *
 * Keyed on OUR ledger row (matched by razorpay_refund_id), not on the payload's
 * return id. That is deliberate: a forged webhook naming a return it did not
 * refund matches zero rows and does nothing. The status change is additionally
 * guarded on the request still being in REFUND_PENDING, so a duplicate delivery
 * cannot re-apply a transition that has already happened.
 */
async function markRefundProcessed(razorpayRefundId: string): Promise<void> {
  const rows = await rawQuery<{ id: string; return_request_id: string }>(sql`
    UPDATE refunds
    SET status = 'PROCESSED', processed_at = now()
    WHERE razorpay_refund_id = ${razorpayRefundId} AND status <> 'PROCESSED'
    RETURNING id, return_request_id
  `);

  for (const row of rows) {
    await rawQuery(sql`
      UPDATE return_requests
      SET status = 'REFUNDED',
          settled_at = COALESCE(settled_at, now()),
          resolved_at = COALESCE(resolved_at, now()),
          updated_at = now()
      WHERE id = ${row.return_request_id} AND status = 'REFUND_PENDING'
    `);
    await rawQuery(sql`
      INSERT INTO return_events
        (id, return_request_id, event, from_status, to_status, actor, data)
      VALUES (
        ${crypto.randomUUID()},
        ${row.return_request_id},
        'refunded',
        'REFUND_PENDING',
        'REFUNDED',
        'system:razorpay-webhook',
        ${JSON.stringify({ razorpayRefundId })}
      )
    `);
  }
}

/**
 * A refund failed at the bank. Release the claim so an admin can retry — but
 * only if nothing was actually sent. If the request has already reached
 * REFUNDED, the money left and this event is a late notification, not a failure.
 */
async function markRefundFailedRemote(razorpayRefundId: string): Promise<void> {
  const rows = await rawQuery<{ id: string; return_request_id: string }>(sql`
    UPDATE refunds
    SET status = 'FAILED'
    WHERE razorpay_refund_id = ${razorpayRefundId} AND status = 'PENDING'
    RETURNING id, return_request_id
  `);

  for (const row of rows) {
    await rawQuery(sql`
      UPDATE return_requests
      SET status = 'REFUND_FAILED', net_refund = NULL, updated_at = now()
      WHERE id = ${row.return_request_id} AND status = 'REFUND_PENDING'
    `);
    await rawQuery(sql`
      INSERT INTO return_events
        (id, return_request_id, event, from_status, to_status, actor, data)
      VALUES (
        ${crypto.randomUUID()},
        ${row.return_request_id},
        'refund_failed',
        'REFUND_PENDING',
        'REFUND_FAILED',
        'system:razorpay-webhook',
        ${JSON.stringify({ razorpayRefundId })}
      )
    `);
  }
}

