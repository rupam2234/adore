'use client';

import { useCart } from '@/components/cart/cart-provider';

/**
 * The bag lives in a drawer, not on its own page — so "back to bag" re-opens
 * the drawer instead of navigating away from checkout.
 */
export default function BackToBag() {
  const { setDrawerOpen } = useCart();

  return (
    <button
      type="button"
      onClick={() => setDrawerOpen(true)}
      className="cursor-pointer text-sm text-[#2B2620]/50 underline-offset-4 transition-colors hover:text-[#2B2620] hover:underline"
    >
      Back to bag
    </button>
  );
}
