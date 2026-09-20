import { NextResponse } from 'next/server';
import {
  checkPinServiceability,
  ShippingUnavailableError,
} from '@/utils/shipping';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pin = params.get('pin') ?? '';
  if (!/^\d{6}$/.test(pin.trim())) {
    return NextResponse.json(
      { error: 'Enter a valid 6-digit PIN' },
      { status: 400 }
    );
  }
  // Optional cart weight (kg) — rates are weight-slab dependent. Invalid or
  // missing values fall back to the default 0.5 kg quote.
  const rawWeight = Number(params.get('weight'));
  const weightKg =
    Number.isFinite(rawWeight) && rawWeight > 0 && rawWeight <= 50
      ? rawWeight
      : null;

  try {
    const result = await checkPinServiceability(pin, weightKg);
    return NextResponse.json({ pin, ...result });
  } catch (error) {
    console.error('[shipping/pin] check failed:', error);
    if (error instanceof ShippingUnavailableError) {
      return NextResponse.json(
        { error: "Couldn't check delivery right now. Please try again." },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "Couldn't check delivery right now. Please try again." },
      { status: 502 }
    );
  }
}
