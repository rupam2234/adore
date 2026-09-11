"use client";

import { useState } from "react";

function StarPath({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`h-4 w-4 ${filled ? "fill-[#C9962E]" : "fill-[#2B2620]/15"}`}
    >
      <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
    </svg>
  );
}

/** Read-only stars. Supports fractional values via a clipped overlay. */
export function Stars({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  const pct = Math.min(Math.max(value / 5, 0), 1) * 100;
  return (
    <span
      role="img"
      aria-label={`${value} out of 5 stars`}
      className={`relative inline-flex shrink-0 ${className}`}
    >
      <span className="flex gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <StarPath key={i} filled={false} />
        ))}
      </span>
      <span
        className="absolute inset-0 flex gap-0.5 overflow-hidden"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <StarPath key={i} filled={true} />
        ))}
      </span>
    </span>
  );
}

/** Interactive star picker for the review form. */
export function StarInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div
      className="flex gap-1"
      role="radiogroup"
      aria-label="Your rating"
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          className="cursor-pointer p-0.5 transition-transform hover:scale-110"
        >
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className={`h-7 w-7 transition-colors ${
              n <= shown ? "fill-[#C9962E]" : "fill-[#2B2620]/15"
            }`}
          >
            <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
          </svg>
        </button>
      ))}
    </div>
  );
}
