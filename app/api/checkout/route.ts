import { NextResponse } from 'next/server';
import { rawQuery, sql, db, orders, idempotencyKeys } from '@/utils/db';
import { createCheckoutSession, CheckoutError, RECENT_ORDER_COOKIE, RECENT_ORDER_MAX_AGE } from '@/utils/checkout';
import { ShippingUnavailableError } from '@/utils/shipping';
import {
  releaseOrderReservations,
  clearPendingOrder,
  extendReservation,
} from '@/utils/reservations';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Step 1 of checkout: validate the address, verify the PIN is serviceable via
 * Shiprocket, create the PENDING order and open a Razorpay order for the exact
 * server-computed total. No money moves until the client opens Checkout.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Generate checkout session ID for cart mutation guard
  const checkoutSessionId = body.checkoutSessionId as string | undefined ?? randomUUID();

  // Idempotency key check — prevents duplicate checkout sessions from double-clicks
  const idemKey = request.headers.get('Idempotency-Key');
  if (idemKey) {
    const existing = await db
      .select({ orderId: idempotencyKeys.orderId })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, idemKey))
      .limit(1);
    if (existing.length > 0) {
      const order = await db
        .select()
        .from(orders)
        .where(eq(orders.id, existing[0].orderId))
        .limit(1);
      if (order[0]?.status === 'PENDING') {
        const session = await createCheckoutSession({
          address: body.address as Record<string, unknown> | undefined,
          addressId: body.addressId as string | undefined,
          email: body.email as string | undefined,
          saveAddress: body.saveAddress === true,
          checkoutSessionId,
        });
        const response = NextResponse.json(session, { status: 201 });
        response.cookies.set('checkout_session_id', checkoutSessionId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24, // 24 hours
        });
        return response;
      }
    }
  }

  // Release a reservation (called when Razorpay checkout is dismissed or fails)
  if (body.action === 'releaseReservation') {
    const orderId = typeof body.orderId === 'string' ? body.orderId : undefined;
    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      );
    }
    try {
      await releaseOrderReservations(orderId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error('[checkout] release reservation failed:', err);
      return NextResponse.json(
        { error: 'Could not release reservation' },
        { status: 500 }
      );
    }
  }

  // Retry checkout: release old reservation, delete old pending order, redirect
  if (body.action === 'retryCheckout') {
    const orderId = typeof body.orderId === 'string' ? body.orderId : undefined;
    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      );
    }
    try {
      await clearPendingOrder(orderId);
      return NextResponse.json({ ok: true, redirect: '/checkout' });
    } catch (err) {
      console.error('[checkout] retry checkout failed:', err);
      return NextResponse.json(
        { error: 'Could not retry checkout' },
        { status: 500 }
      );
    }
  }

// Extend reservation (client heartbeat during Razorpay checkout)
  if (body.action === 'extendReservation') {
    const orderId = typeof body.orderId === 'string' ? body.orderId : undefined;
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }
    try {
      await extendReservation(orderId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error('[checkout] extend reservation failed:', err);
      return NextResponse.json(
        { error: 'Could not extend reservation' },
        { status: 500 }
      );
    }
  }

  try {
    const session = await createCheckoutSession({
      address:
        body.address && typeof body.address === 'object'
          ? (body.address as Record<string, unknown>)
          : undefined,
      addressId:
        typeof body.addressId === 'string' ? body.addressId : undefined,
      email: typeof body.email === 'string' ? body.email : undefined,
      saveAddress: body.saveAddress === true,
      idempotencyKey: idemKey ?? undefined,
      checkoutSessionId,
    });

    const response = NextResponse.json(session, { status: 201 });

    // Store idempotency key for deduplication
    if (idemKey && session.orderNumber) {
      const orderRows = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNumber, session.orderNumber))
        .limit(1);
      if (orderRows.length > 0) {
        await db
          .insert(idempotencyKeys)
          .values({ key: idemKey, orderId: orderRows[0].id })
          .onConflictDoNothing();
      }
    }

    // For zero-total orders, set the order cookie so the success page can access it
    if (session.paymentRequired === false) {
      response.cookies.set({
        name: RECENT_ORDER_COOKIE,
        value: session.orderNumber,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: RECENT_ORDER_MAX_AGE,
      });
    }

    return response;
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    if (error instanceof ShippingUnavailableError) {
      return NextResponse.json(
        {
          error: "We couldn't verify delivery for that PIN. Please try again.",
        },
        { status: 502 }
      );
    }
    console.error('[checkout] could not create session', error);
    return NextResponse.json(
      { error: 'Could not start checkout. Please try again.' },
      { status: 500 }
    );
  }
}
