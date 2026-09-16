import { NextResponse } from "next/server";
import {
  checkPinServiceability,
  ShippingUnavailableError,
} from "@/utils/shipping";

export async function GET(request: Request) {
  const pin = new URL(request.url).searchParams.get("pin") ?? "";
  if (!/^\d{6}$/.test(pin.trim())) {
    return NextResponse.json(
      { error: "Enter a valid 6-digit PIN" },
      { status: 400 },
    );
  }

  try {
    const result = await checkPinServiceability(pin);
    return NextResponse.json({ pin, ...result });
  } catch (error) {
    if (error instanceof ShippingUnavailableError) {
      return NextResponse.json(
        { error: "Couldn't check delivery right now. Please try again." },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Couldn't check delivery right now. Please try again." },
      { status: 502 },
    );
  }
}
