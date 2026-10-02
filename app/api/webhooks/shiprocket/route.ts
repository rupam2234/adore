import { NextResponse } from 'next/server';
import { rateLimit } from '@/utils/rate-limit';
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  handleOrderDelivered,
  syncReturnFromCourier,
} from '@/utils/returns-ops';
import { rawQuery, sql } from '@/utils/db';

/**
 * POST /api/webhooks/shiprocket — courier events.
 *
 * This endpoint is what makes the returns flow work at all, and also what makes
 * it attackable, so it is the most carefully gated route in the app.
 *
 * Three defences, in order:
 *
 *  1. SHARED SECRET. Shiprocket can be configured to append a token to the
 *     webhook URL. Checked with a constant-time compare. An unauthenticated
 *     endpoint here would let anyone mark their own order delivered (opening a
 *     return window they should not have) or drive a return into RECEIVED — the
 *     last automated step before inspection.
 *
 *  2. RATE LIMIT. Per-IP, before any parsing. Bounds the cost of a flood even
 *     if the secret were somehow guessed.
 *
 *  3. EVENT DEDUPLICATION. Every event id is claimed in `webhook_events`, whose
 *     primary key does the work. Couriers retry aggressively, and on serverless
 *     those retries land on different instances, so an in-memory Set would be
 *     useless here.
 *
 * Note what this endpoint does NOT do: it never moves a return to QC_PASSED or
 * REFUNDED. Delivery events move the ORDER forward and RECEIVE returns; from
 * RECEIVED a human must inspect the goods. That separation is deliberate — it is
 * the guarantee that no amount of forged or replayed courier traffic can produce
 * a refund.
 */

/** Shiprocket appends this to the configured webhook URL. */
const WEBHOOK_TOKEN = process.env.SHIPROCKET_WEBHOOK_TOKEN ?? '';

const IP_LIMIT = { limit: 120, windowMs: 60_000 };

/** Constant-time string compare. Length is not secret (both are URLs). */
function tokenMatches(candidate: string | null): boolean {
  // Fail closed: with no token configured, nothing is allowed in. An
  // accidentally-unset env var must not silently open this endpoint.
  if (!WEBHOOK_TOKEN || !candidate) return false;
  if (candidate.length !== WEBROCKET_TOKEN_LENGTH) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ WEBHOOK_TOKEN.charCodeAt(i);
  }
  return diff === 0;
}

const WEBROCKET_TOKEN_LENGTH = WEBHOOK_TOKEN.length;

/** Best-effort client IP, for the rate-limit key. */
function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(request: Request) {
  // 1. Authenticate before reading the body.
  const url = new URL(request.url);
  if (!tokenMatches(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  // 2. Bound the flood.
  const limit = rateLimit(`shiprocket-hook:${clientIp(request)}`, IP_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = String(payload.shipment_status ?? payload.event ?? '')
    .trim()
    .toUpperCase();
  // Shiprocket's own id when present; otherwise derive a stable one from the
  // fields that make this event unique, so a retry still dedupes.
  const eventId = String(
    payload.event_id ??
      payload.shipment_id ??
      `${payload.awb ?? ''}:${eventType}:${payload.shipment_date ?? ''}`
  );

  if (!eventId || eventId === ':') {
    // Nothing to key on — acknowledge so the courier stops retrying, rather than
    // accumulating failures on their side.
    return NextResponse.json({ ok: true, ignored: 'no-event-id' });
  }

  // 3. Deduplicate.
  const first = await claimWebhookEvent(
    'shiprocket',
    eventId,
    eventType,
    payload
  );
  if (!first) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    switch (eventType) {
      // --- Outbound leg: the parcel reached the customer. This sets
      //     orders.delivered_at and therefore STARTS the return window.
      case 'DELIVERED':
      case 'DELIVERED_UNDSCANNED': {
        // Our order number was sent as Shiprocket's `order_id` at checkout.
        const orderNumber = String(payload.order_id ?? payload.order_number ?? '');
        if (orderNumber) {
          await handleOrderDelivered({
            orderNumber,
            awb: typeof payload.awb === 'string' ? payload.awb : undefined,
            deliveredAt:
              typeof payload.shipment_date === 'string'
                ? payload.shipment_date
                : undefined,
          });
        }
        break;
      }

      // --- Return leg: the customer's parcel is moving back to us.
      case 'IN_TRANSIT':
      case 'PICKED_UP':
      case 'RMA_IN_TRANSIT': {
        await syncReturnsForRma(String(payload.rma_id ?? ''));
        break;
      }

      // The return parcel reached our warehouse. This is the ONLY courier event
      // that advances a return, and it advances it to RECEIVED — never past.
      // QC and settlement stay human-gated.
      case 'DELIVERED_RTO':
      case 'RMA_DELIVERED':
      case 'RMA_RECEIVED': {
        await syncReturnsForRma(String(payload.rma_id ?? ''));
        break;
      }

      case 'CANCELLED':
      case 'CANCELLED_BY_SELLER':
      case 'RMA_CANCELLED': {
        // The courier cancelled the pickup. Recorded for the queue; a human
        // decides between a retry and the self-ship fallback.
        const rmaId = String(payload.rma_id ?? '');
        if (rmaId) await flagPickupIssue(rmaId, 'Courier cancelled the pickup');
        break;
      }

      default:
        // Every other Shiprocket event (OUT_FOR_DELIVERY, forward-leg
        // IN_TRANSIT, courier-assigned, …) is not our concern here.
        break;
    }

    await completeWebhookEvent('shiprocket', eventId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[shiprocket-webhook] handler failed:', error);
    // Not marked processed, so a manual/cron retry can pick it up. Returning
    // 500 asks the courier to retry, which is the correct signal.
    await failWebhookEvent('shiprocket', eventId, message).catch(() => {});
    return NextResponse.json(
      { error: 'Could not process the event' },
      { status: 500 }
    );
  }
}

/** Reconcile every open return attached to an RMA. */
async function syncReturnsForRma(rmaId: string): Promise<void> {
  if (!rmaId) return;
  const rows = await rawQuery<{ id: string }>(sql`
    SELECT id FROM return_requests
    WHERE shiprocket_return_awb = ${rmaId}
      AND status NOT IN ('REFUNDED','REJECTED','CANCELLED','QC_PASSED','QC_FAILED')
    LIMIT 5
  `);
  for (const row of rows) {
    try {
      await syncReturnFromCourier(row.id);
    } catch (error) {
      // One bad return must not stop the others from syncing.
      console.error(`[shiprocket-webhook] sync failed for ${row.id}:`, error);
    }
  }
}

/**
 * Record a courier-side pickup problem for the admin queue.
 *
 * Moves APPROVED / PICKUP_SCHEDULED to PICKUP_FAILED, which the state machine
 * allows a retry from (while the attempt budget lasts) or a move to
 * SELF_SHIP_PENDING from. It deliberately does NOT jump to IN_TRANSIT or
 * beyond — only Shiprocket's own tracking poll can confirm the parcel is
 * actually moving.
 */
async function flagPickupIssue(rmaId: string, note: string): Promise<void> {
  const rows = await rawQuery<{ id: string }>(sql`
    UPDATE return_requests
    SET status = 'PICKUP_FAILED',
        notes = COALESCE(notes, '') || ${note + ' '},
        updated_at = now()
    WHERE shiprocket_return_awb = ${rmaId}
      AND status IN ('APPROVED','PICKUP_SCHEDULED')
    RETURNING id
  `);
  for (const row of rows) {
    await rawQuery(sql`
      INSERT INTO return_events (id, return_request_id, event, actor, data)
      VALUES (
        ${crypto.randomUUID()},
        ${row.id},
        'courier_pickup_cancelled',
        'system:shiprocket-webhook',
        ${JSON.stringify({ rmaId, note })}
      )
    `).catch(() => {});
  }
}

