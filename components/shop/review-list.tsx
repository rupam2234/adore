"use client";

import {
  FIT_LABELS,
  formatReviewDate,
  type ProductReview,
} from "@/utils/review-format";
import { Stars } from "./stars";

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function ReviewListItem({
  review,
  helpfulClicked,
  onHelpful,
}: {
  review: ProductReview;
  helpfulClicked: boolean;
  onHelpful: () => void;
}) {
  return (
    <li className="flex gap-3 py-5">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2B2620]/10 font-serif text-sm"
      >
        {initials(review.authorName)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Stars value={review.rating} />
          {review.title && <p className="text-sm font-medium">{review.title}</p>}
        </div>
        <p className="mt-0.5 text-xs text-[#2B2620]/50">
          {review.authorName}
          {review.sizePurchased && ` · Size ${review.sizePurchased}`}
          {review.fitFeedback && ` · ${FIT_LABELS[review.fitFeedback]}`}
          {formatReviewDate(review.createdAt) &&
            ` · ${formatReviewDate(review.createdAt)}`}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[#2B2620]/80">
          {review.body}
        </p>
        <button
          type="button"
          onClick={onHelpful}
          disabled={helpfulClicked}
          className="mt-2 cursor-pointer text-xs text-[#2B2620]/50 underline underline-offset-4 transition-colors hover:text-[#2B2620] disabled:cursor-default disabled:no-underline disabled:opacity-60"
        >
          Helpful{review.helpfulCount > 0 && ` (${review.helpfulCount})`}
        </button>
      </div>
    </li>
  );
}
