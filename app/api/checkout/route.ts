import { NextResponse } from 'next/server';
import { rawQuery, sql } from '@/utils/db';
import { createCheckoutSession, CheckoutError } from '@/utils/checkout';
import { ShippingUnavailableError } from '@/utils/shipping';
import { releaseOrderReservations, clearPendingOrder } from '@/utils/reservations';

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
    });
    return NextResponse.json(session, { status: 201 });
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
