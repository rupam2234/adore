/**
 * Checkout money math + shared types.
 *
 * Client-safe (no db / no next/headers) so the checkout form can show the exact
 * same totals the server charges — the server remains the source of truth and
 * re-computes every number in ./checkout.ts.
 */

/** Flat shipping; free above the threshold. Tweak freely. */
export const SHIPPING_FLAT = 79;
export const FREE_SHIPPING_THRESHOLD = 999;

export type CheckoutAddress = {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type CheckoutTotals = {
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
};

export function computeShippingAmount(subtotal: number): number {
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT;
}

/** Rupee amounts (not paise). `total` is what Razorpay is asked to charge. */
export function computeCheckoutTotals(
  subtotal: number,
  discount: number
): CheckoutTotals {
  const shipping = computeShippingAmount(subtotal);
  return {
    subtotal,
    discount,
    shipping,
    total: Math.max(0, subtotal - discount + shipping),
  };
}

/** Paise, rounded — the exact integer Razorpay expects. */
export function toPaise(rupees: number): number {
  return Math.max(0, Math.round(rupees * 100));
}
