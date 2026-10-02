import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/utils/request-user';
import { ensureCustomerForUserId } from '@/utils/account';
import { rateLimit } from '@/utils/rate-limit';
import { getReturnTimeline } from '@/utils/returns-db';
import { cancelReturnByCustomer } from '@/utils/returns-ops';

/**
 * /api/account/returns/[id] — a single request, for the signed-in customer.
 *
 * Two verbs only:
 *   GET    → the plain-English timeline for this one request
 *   DELETE → cancel it, if it is still in a state the customer controls
 *
 * Authorisation is by `customerId` in the SQL of every query, not by a check
 * performed beforehand. A return id belonging to another account therefore
 * behaves exactly like one that does not exist — 404, not 403 — so the endpoint
 * cannot be used to discover that somebody else's return id is real.
 */

/** Cancellation is a state change, so it gets its own (generous) limit. */
const CANCEL_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const customer = await ensureCustomerForUserId(userId);
    const timeline = await getReturnTimeline(customer.id, id);
    if (!timeline.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(timeline);
  } catch {
    return NextResponse.json(
      { error: 'Could not load this return' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/account/returns/[id] — withdraw a request.
 *
 * A customer who changes their mind should not have to call support, and an
 * abandoned REQUESTED row is noise in the admin queue. But this is deliberately
 * narrow: the underlying update only matches `REQUESTED` and `APPROVED`, so a
 * parcel that is already moving cannot be "cancelled" out from under the
 * courier — that would leave a rider booked for a return we no longer intend to
 * accept.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const customer = await ensureCustomerForUserId(userId);

    const limit = rateLimit(`return-cancel:${customer.id}`, CANCEL_LIMIT);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        }
      );
    }

    const result = await cancelReturnByCustomer(customer.id, id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: 'Could not cancel this request' },
      { status: 500 }
    );
  }
}
