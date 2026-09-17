/**
 * Razorpay Orders API adapter (plain REST — no SDK dependency, same style as
 * the Shiprocket adapter).
 *
 * Env:
 * - RAZORPAY_API_KEY    → Key Id (public, safe to send to the browser)
 * - RAZORPAY_API_SECRET → Key Secret (server-side only)
 *
 * Payment verification: Razorpay Checkout returns
 * { razorpay_order_id, razorpay_payment_id, razorpay_signature } where the
 * signature is HMAC-SHA256(order_id + "|" + payment_id, secret). We verify it
 * with a timing-safe comparison before trusting a payment.
 */

import crypto from "node:crypto";

const RAZORPAY_BASE = "https://api.razorpay.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;

export class RazorpayError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export type RazorpayOrder = {
  id: string;
  amount: number; // paise
  currency: string;
  receipt: string | null;
  status: string;
};

export type RazorpayPayment = {
  id: string;
  status: string;
  amount: number;
  order_id: string;
};

export function razorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_API_KEY && process.env.RAZORPAY_API_SECRET,
  );
}

/** Public key id — safe to expose to the browser for Checkout.js. */
export function razorpayKeyId(): string {
  return process.env.RAZORPAY_API_KEY ?? "";
}

function authHeader(): string {
  const key = process.env.RAZORPAY_API_KEY ?? "";
  const secret = process.env.RAZORPAY_API_SECRET ?? "";
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

async function razorpayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!razorpayConfigured()) {
    throw new RazorpayError("Payments are not configured (missing Razorpay keys)", 503);
  }
  let res: Response;
  try {
    res = await fetch(`${RAZORPAY_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        ...init?.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new RazorpayError("Could not reach the payment gateway. Please try again.");
  }
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { description?: string } })
    | null;
  if (!res.ok) {
    throw new RazorpayError(
      body?.error?.description ?? `Payment gateway error (${res.status})`,
    );
  }
  return body as T;
}

/** Create a Razorpay order. Amount is in paise. Receipt ≤ 40 chars. */
export async function createRazorpayOrder(input: {
  amount: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  return razorpayFetch<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency ?? "INR",
      receipt: input.receipt,
      notes: input.notes,
    }),
  });
}

export async function fetchRazorpayOrder(id: string): Promise<RazorpayOrder> {
  return razorpayFetch<RazorpayOrder>(`/orders/${encodeURIComponent(id)}`);
}

export async function fetchRazorpayPayment(id: string): Promise<RazorpayPayment> {
  return razorpayFetch<RazorpayPayment>(`/payments/${encodeURIComponent(id)}`);
}

/** Timing-safe HMAC-SHA256 verification of the Checkout handler payload. */
export function verifyRazorpaySignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_API_SECRET;
  if (!secret || !input.signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(input.signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
