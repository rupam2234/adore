/** Client-safe review types + pure helpers — no DB imports, safe for "use client". */

export type FitFeedback = 'runs_small' | 'true_to_size' | 'runs_large';

export const FIT_LABELS: Record<FitFeedback, string> = {
  runs_small: 'Runs small',
  true_to_size: 'True to size',
  runs_large: 'Runs large',
};

/**
 * Who is allowed to submit a review.
 *
 * Kept here (not in the route) because this file is the only review module that
 * is safe to import from a client component: no DB, no `next/headers`. The API
 * route is the real gate — the UI only mirrors it so a visitor is told *why*
 * they cannot review instead of hitting a wall after filling in the form.
 */
export type ReviewEligibility =
  | 'eligible'
  | 'logged_out'
  | 'not_purchased'
  | 'already_reviewed';

/**
 * Resolve review eligibility from facts already known to the caller.
 *
 * Ordering is the security-relevant part of this function:
 *
 * 1. `logged_out` first — signing in may reveal they DID buy the product, so
 *    we must not accuse a visitor of not being a buyer before we know who they
 *    are.
 * 2. `not_purchased` next, and ahead of the duplicate check. The purchase rule
 *    is the hard gate; the duplicate rule is a soft anti-spam nicety matched on
 *    author name. Letting the soft check win would let a name collision decide
 *    the outcome and mask the real reason a request was denied.
 * 3. `already_reviewed` last, refining the answer for buyers only.
 */
export function evaluateReviewEligibility(input: {
  loggedIn: boolean;
  hasPurchased: boolean;
  alreadyReviewed?: boolean;
}): ReviewEligibility {
  if (!input.loggedIn) return 'logged_out';
  if (!input.hasPurchased) return 'not_purchased';
  return input.alreadyReviewed ? 'already_reviewed' : 'eligible';
}

/** Copy shown when a visitor is not allowed to review. */
export const REVIEW_BLOCK_MESSAGES: Record<
  Exclude<ReviewEligibility, 'eligible'>,
  string
> = {
  logged_out: 'Please log in with your Adore account to share your review.',
  not_purchased:
    'Only verified buyers can review this product. Yours must contain at least one non-cancelled, non-refunded order for it.',
  already_reviewed: 'You have already reviewed this product. Thank you! ♥',
};

export type ProductReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  sizePurchased: string | null;
  fitFeedback: FitFeedback | null;
  helpfulCount: number;
  createdAt: string;
};

export type ReviewSummary = {
  average: number;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
};

export const EMPTY_SUMMARY: ReviewSummary = {
  average: 0,
  count: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

/** e.g. "12 Sep 2026" */
export function formatReviewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}
