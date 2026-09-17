"use client";

import { useState } from "react";
import { FIT_LABELS, type FitFeedback, type ProductReview } from "@/utils/review-format";
import { StarInput } from "./stars";

type Props = {
  slug: string;
  sizes: string[];
  /** Account display name when logged in — read-only for members, editable for guests. */
  authorName: string | null;
  onPosted: (review: ProductReview) => void;
};

export function ReviewForm({ slug, sizes, authorName, onPosted }: Props) {
  const isLoggedIn = authorName !== null;

  const [rating, setRating] = useState(0);
  const [reviewerName, setReviewerName] = useState(isLoggedIn ? authorName! : "");
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sizePurchased, setSizePurchased] = useState("");
  const [fitFeedback, setFitFeedback] = useState<FitFeedback | "">("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formOk, setFormOk] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (rating < 1) {
      setFormError("Please select a star rating.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/products/${slug}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          title,
          body,
          sizePurchased: sizePurchased || null,
          fitFeedback: fitFeedback || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submit failed");
      if (data.review) onPosted(data.review);
      setPending(data.approved === false);
      setRating(0);
      setTitle("");
      setBody("");
      setSizePurchased("");
      setFitFeedback("");
      setFormOk(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (formOk) {
    return (
      <div className="py-2 text-center">
        <p className="font-serif text-xl">Thank you! ♥</p>
        <p className="mt-1 text-sm text-[#2B2620]/60">
          {pending
            ? "Your review has been submitted and will appear once it's approved."
            : "Your review is live below."}
        </p>
        <button
          type="button"
          onClick={() => setFormOk(false)}
          className="mt-3 cursor-pointer text-sm underline underline-offset-4"
        >
          Write another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h3 className="font-serif text-xl">Write a review</h3>
      <div>
        <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[#2B2620]/50">
          Your rating *
        </p>
        <StarInput value={rating} onChange={setRating} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {isLoggedIn ? (
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
              Posting as
            </span>
            <p className="border border-dashed border-[#2B2620]/20 bg-transparent px-3 py-2.5 text-sm text-[#2B2620]/70">
              {authorName}
            </p>
          </div>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
              Your name *
            </span>
            <input
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              placeholder="How should we call you?"
              maxLength={100}
              required
              className="border border-[#2B2620]/20 bg-[#FAF8F3] px-3 py-2.5 text-sm outline-none placeholder:text-[#2B2620]/35 focus:border-[#2B2620]"
            />
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
            Headline
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sum it up in a line"
            maxLength={120}
            className="border border-[#2B2620]/20 bg-[#FAF8F3] px-3 py-2.5 text-sm outline-none placeholder:text-[#2B2620]/35 focus:border-[#2B2620]"
          />
        </label>
      </div>
      {!isLoggedIn && (
        <p className="text-xs text-[#2B2620]/50">
          Guest reviews are held for moderation before they appear publicly.
        </p>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
          Your review *
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="How did it fit? How does the fabric feel?"
          rows={4}
          maxLength={2000}
          required
          className="resize-y border border-[#2B2620]/20 bg-[#FAF8F3] px-3 py-2.5 text-sm outline-none placeholder:text-[#2B2620]/35 focus:border-[#2B2620]"
        />
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {sizes.length > 0 && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
              Size purchased
            </span>
            <select
              value={sizePurchased}
              onChange={(e) => setSizePurchased(e.target.value)}
              className="cursor-pointer border border-[#2B2620]/20 bg-[#FAF8F3] px-3 py-2.5 text-sm outline-none focus:border-[#2B2620]"
            >
              <option value="">Select…</option>
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
            Fit
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(["runs_small", "true_to_size", "runs_large"] as const).map(
              (f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() =>
                    setFitFeedback((prev) => (prev === f ? "" : f))
                  }
                  className={`cursor-pointer border px-3 py-2 text-xs transition-colors ${
                    fitFeedback === f
                      ? "border-[#2B2620] bg-[#2B2620] text-[#FAF8F3]"
                      : "border-[#2B2620]/20 hover:border-[#2B2620]"
                  }`}
                >
                  {FIT_LABELS[f]}
                </button>
              ),
            )}
          </div>
        </div>
      </div>
      {formError && (
        <p role="alert" className="text-sm text-[#A45A4B]">
          {formError}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={submitting}
          className="cursor-pointer rounded-full bg-[#2B2620] px-6 py-3 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Posting…" : "Post review"}
        </button>
      </div>
    </form>
  );
}
