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

import crypto from 'node:crypto';

const RAZORPAY_BASE = 'https://api.razorpay.com/v1';
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
    process.env.RAZORPAY_API_KEY && process.env.RAZORPAY_API_SECRET
  );
}

/** Public key id — safe to expose to the browser for Checkout.js. */
export function razorpayKeyId(): string {
  return process.env.RAZORPAY_API_KEY ?? '';
}

function authHeader(): string {
  const key = process.env.RAZORPAY_API_KEY ?? '';
  const secret = process.env.RAZORPAY_API_SECRET ?? '';
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

async function razorpayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!razorpayConfigured()) {
    throw new RazorpayError(
      'Payments are not configured (missing Razorpay keys)',
      503
    );
  }
  let res: Response;
  try {
    res = await fetch(`${RAZORPAY_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new RazorpayError(
      'Could not reach the payment gateway. Please try again.'
    );
  }
  const body = (await res.json().catch(() => null)) as
    (T & { error?: { description?: string } }) | null;
  if (!res.ok) {
    throw new RazorpayError(
      body?.error?.description ?? `Payment gateway error (${res.status})`
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
  return razorpayFetch<RazorpayOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency ?? 'INR',
      receipt: input.receipt,
      notes: input.notes,
    }),
  });
}

export async function fetchRazorpayOrder(id: string): Promise<RazorpayOrder> {
  return razorpayFetch<RazorpayOrder>(`/orders/${encodeURIComponent(id)}`);
}

export async function fetchRazorpayPayment(
  id: string
): Promise<RazorpayPayment> {
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
    .createHmac('sha256', secret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(input.signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export type RazorpayRefund = {
  id: string;
  payment_id: string;
  amount: number; // paise, actually refunded
  currency: string;
  status: 'pending' | 'processed' | 'failed';
  receipt?: string | null;
};

/**
 * Refund against an original payment.
 *
 * `amountPaise` is deliberately required and never defaulted to the full
 * payment. A partial refund is the normal case in a returns flow (one item out
 * of a three-item order), and a helper that "helpfully" defaults to the full
 * amount is exactly how a ₹4,000 order gets fully refunded by accident.
 *
 * Razorpay's refund is asynchronous: `pending` means accepted, not sent. The
 * caller must treat only `processed` as money gone. See returns-ops.ts, which
 * persists the refund id BEFORE calling this and reconciles via the webhook.
 */
export async function createRazorpayRefund(input: {
  paymentId: string;
  amountPaise: number;
  /** Razorpay caps this at 40 chars. */
  receipt?: string;
  notes?: Record<string, string>;
}): Promise<RazorpayRefund> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    // A zero or negative refund would be rejected by the gateway anyway;
    // failing here keeps the reason in our logs where we can act on it.
    throw new RazorpayError('Refund amount must be a positive whole number of paise', 400);
  }

  return razorpayFetch<RazorpayRefund>(
    `/payments/${encodeURIComponent(input.paymentId)}/refund`,
    {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amountPaise,
        ...(input.receipt ? { receipt: input.receipt.slice(0, 40) } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      }),
    }
  );
}

/** Read a refund back. Used to reconcile a crash mid-refund. */
export async function fetchRazorpayRefund(
  refundId: string
): Promise<RazorpayRefund> {
  return razorpayFetch<RazorpayRefund>(
    `/refunds/${encodeURIComponent(refundId)}`
  );
}

/**
 * Signature verification for the Razorpay webhook.
 *
 * Razorpay signs with HMAC-SHA256 over the RAW request body and sends the hex
 * digest in `x-razorpay-signature`.
 *
 * Two details that are easy to get wrong and expensive to get wrong:
 *
 *  - it must be the RAW body, not a re-serialised JSON.parse(JSON.stringify()),
 *    because key order and whitespace change the bytes and the HMAC. The route
 *    handler reads `request.text()` once and parses from that same string.
 *  - the comparison must be timing-safe, same as the checkout signature.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Build the signature a webhook body should carry. Exists so the test suite can
 * sign a fixture and prove the verification round-trips, rather than asserting
 * that a hard-coded string is "correct".
 */
export function signWebhookPayload(rawBody: string): string {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

