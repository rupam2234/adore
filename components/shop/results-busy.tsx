'use client';

import { useLinkStatus } from 'next/link';
import { ReactNode } from 'react';

/**
 * Inline loading indicator for the product grid. Consumed only by the shop
 * pages — renders nothing until a filter / category / sort navigation is in
 * flight, so the grid can announce "Updating…" without blocking the UI while
 * React flushes the optimistic filter state and the server streams new results.
 *
 * `useLinkStatus` flips `pending` to true for *any* Next.js navigation,
 * including the ones kicked off by the filter panel's `router.push`, so a click
 * on "In stock" (or anything else) yields instant feedback.
 */
export function ResultsBusy(): ReactNode {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <div
      aria-live="polite"
      className="col-span-full flex items-center justify-center gap-2 py-8 text-sm text-[#2B2620]/70"
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx={12} cy={12} r={10} />
        <path d="M12 2v4m8.5 7.5A8.5 8.5 0 0 1 12 20a8.5 8.5 0 0 1 0-17 8.5 8.5 0 0 1 0 17" />
      </svg>
      Updating results…
    </div>
  );
}
