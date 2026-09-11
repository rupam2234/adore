/** Client-safe review types + pure helpers — no DB imports, safe for "use client". */

export type FitFeedback = "runs_small" | "true_to_size" | "runs_large";

export const FIT_LABELS: Record<FitFeedback, string> = {
  runs_small: "Runs small",
  true_to_size: "True to size",
  runs_large: "Runs large",
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
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}
