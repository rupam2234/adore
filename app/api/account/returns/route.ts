import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/utils/request-user';
import { ensureCustomerForUserId } from '@/utils/account';
import { rateLimit } from '@/utils/rate-limit';
import {
  createReturnRequest,
  listReturnRequests,
  ReturnRequestError,
} from '@/utils/returns-db';

/**
 * Return submissions are a write path with real cost behind them (a row, plus a
 * Cloudinary upload for damage claims), so they are bounded per customer. 5 per
 * hour is far above genuine use — a customer with a multi-item order submits
 * once per item — but stops a scripted flood.
 */
const SUBMIT_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };

/** GET /api/account/returns — the signed-in customer's requests. */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const customer = await ensureCustomerForUserId(userId);
    return NextResponse.json({
      returns: await listReturnRequests(customer.id),
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not load your returns' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/account/returns — raise a return or exchange.
 *
 * Eligibility is re-checked on the server (utils/returns-db.ts), so a crafted
 * request cannot bypass the return window, the photo requirement or the
 * exchange fee. Validation failures return 422 with a stable `code` the form
 * branches on; never trust client-side gating alone.
 */
export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  const orderItemId =
    typeof body.orderItemId === 'string' ? body.orderItemId : '';
  const type = body.type === 'EXCHANGE' ? 'EXCHANGE' : 'RETURN';
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const qty = Number(body.qty ?? 1);
  const exchangeVariantId =
    typeof body.exchangeVariantId === 'string' ? body.exchangeVariantId : null;
  const photos = Array.isArray(body.photos)
    ? body.photos.filter((p): p is string => typeof p === 'string').slice(0, 5)
    : [];

  if (!orderId || !orderItemId) {
    return NextResponse.json(
      { error: 'Missing order or item', code: 'BAD_REQUEST' },
      { status: 400 }
    );
  }

  try {
    const customer = await ensureCustomerForUserId(userId);

    // Keyed by customer, not IP: authenticated route, and an IP cap would
    // punish everyone behind one NAT.
    const limit = rateLimit(`return:${customer.id}`, SUBMIT_LIMIT);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error:
            'Too many return requests. Please try again in a little while.',
          code: 'RATE_LIMITED',
        },
        {
          status: 429,
          headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        }
      );
    }

    const created = await createReturnRequest(customer.id, {
      orderId,
      orderItemId,
      type,
      reason,
      qty,
      exchangeVariantId,
      photos,
    });
    return NextResponse.json({ return: created }, { status: 201 });
  } catch (error) {
    if (error instanceof ReturnRequestError) {
      // 422: the request was well-formed but breaks policy. The code lets the
      // form show the right message without string-matching.
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 }
      );
    }
    console.error('return request failed:', error);
    return NextResponse.json(
      { error: 'Could not submit your request. Please try again.' },
      { status: 500 }
    );
  }
}
