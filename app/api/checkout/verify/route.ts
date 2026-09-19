import { NextResponse } from 'next/server';
import {
  CheckoutError,
  RECENT_ORDER_COOKIE,
  RECENT_ORDER_MAX_AGE,
  verifyAndConfirmPayment,
} from '@/utils/checkout';
import { RazorpayError } from '@/utils/razorpay';

/**
 * Step 2 of checkout: the Razorpay Checkout success handler posts the signature
 * here. We verify it (HMAC + server-to-server amount check), confirm the order,
 * decrement stock, clear the bag and push the order to Shiprocket.
 *
 * On success we set an httpOnly cookie with the order number — that cookie is
 * the only key to the confirmation page, so orders stay private.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const confirmation = await verifyAndConfirmPayment({
      razorpayOrderId:
        typeof body.razorpay_order_id === 'string'
          ? body.razorpay_order_id
          : '',
      razorpayPaymentId:
        typeof body.razorpay_payment_id === 'string'
          ? body.razorpay_payment_id
          : '',
      razorpaySignature:
        typeof body.razorpay_signature === 'string'
          ? body.razorpay_signature
          : '',
    });

    const response = NextResponse.json({
      ok: true,
      orderNumber: confirmation.orderNumber,
      confirmation,
    });
    response.cookies.set({
      name: RECENT_ORDER_COOKIE,
      value: confirmation.orderNumber,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: RECENT_ORDER_MAX_AGE,
    });
    return response;
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    if (error instanceof RazorpayError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error('[checkout] payment verification failed', error);
    return NextResponse.json(
      { error: "We couldn't confirm that payment. Please contact support." },
      { status: 500 }
    );
  }
}
