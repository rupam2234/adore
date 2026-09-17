import { NextResponse } from "next/server";
import { createCheckoutSession, CheckoutError } from "@/utils/checkout";
import { ShippingUnavailableError } from "@/utils/shipping";

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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const session = await createCheckoutSession({
      address:
        body.address && typeof body.address === "object"
          ? (body.address as Record<string, unknown>)
          : undefined,
      addressId: typeof body.addressId === "string" ? body.addressId : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      saveAddress: body.saveAddress === true,
    });
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ShippingUnavailableError) {
      return NextResponse.json(
        { error: "We couldn't verify delivery for that PIN. Please try again." },
        { status: 502 },
      );
    }
    console.error("[checkout] could not create session", error);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 },
    );
  }
}
