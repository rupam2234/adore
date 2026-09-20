/**
 * Checkout money math + shared types.
 *
 * Client-safe (no db / no next/headers) so the checkout form can show the exact
 * same totals the server charges — the server remains the source of truth and
 * re-computes every number in ./checkout.ts.
 */

/** Flat shipping (fallback when Shiprocket rates are unavailable); free above the threshold. Tweak freely. */
export const SHIPPING_FLAT = 79;
export const FREE_SHIPPING_THRESHOLD = 1299;

/**
 * Auto-discount offer shown in the checkout ribbon. NOTE: messaging only —
 * the discount itself is not applied yet (wire into the promo flow when ready).
 */
export const AUTO_DISCOUNT_THRESHOLD = 2000;
export const AUTO_DISCOUNT_RATE = 0.05;

/** GST rate — kept for future use but not applied currently. */
export const GST_RATE = 0.18;

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
  gst: number;
  total: number;
};

/**
 * Shipping for an order:
 * - Free above the threshold (discounted subtotal decides).
 * - Otherwise the real Shiprocket courier rate when known, falling back to
 *   the flat rate (e.g. Shiprocket unavailable / PIN not yet verified).
 */
export function computeShippingAmount(
  subtotal: number,
  shiprocketRate?: number | null
): number {
  if (subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  if (shiprocketRate != null && Number.isFinite(shiprocketRate) && shiprocketRate > 0) {
    return shiprocketRate;
  }
  return SHIPPING_FLAT;
}

/** Rupee amounts (not paise). `total` is what Razorpay is asked to charge. */
export function computeCheckoutTotals(
  subtotal: number,
  discount: number,
  shiprocketRate?: number | null
): CheckoutTotals {
  const shipping = computeShippingAmount(
    subtotal - discount,
    shiprocketRate
  );
  return {
    subtotal,
    discount,
    shipping,
    gst: 0, // Not applied currently
    total: Math.max(0, subtotal - discount + shipping),
  };
}

/** Paise, rounded — the exact integer Razorpay expects. */
export function toPaise(rupees: number): number {
  return Math.max(0, Math.round(rupees * 100));
}
