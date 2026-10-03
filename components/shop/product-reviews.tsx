'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  REVIEW_BLOCK_MESSAGES,
  type ProductReview,
  type ReviewEligibility,
  type ReviewSummary,
} from '@/utils/review-format';
import { useAuthUser } from '@/components/auth/use-auth-user';
import { Stars } from './stars';
import { ReviewForm } from './review-form';
import { ReviewListItem } from './review-list';

type Props = {
  slug: string;
  initialSummary: ReviewSummary;
  initialReviews: ProductReview[];
  initialTotal: number;
  sizes: string[];
};

const PAGE_SIZE = 5;

/**
 * Where a blocked reviewer's orders actually live.
 *
 * Named once because these two links are the only paths this file owns, and a
 * hand-typed `/orders` here 404s: the account section is namespaced under
 * /account. Getting this wrong sends a customer who is trying to prove they
 * bought something to a dead end, which is the worst possible outcome here.
 */
const ORDERS_PATH = '/account/orders';

export default function ProductReviews({
  slug,
  initialSummary,
  initialReviews,
  initialTotal,
  sizes,
}: Props) {
  // Resolve the logged-in reviewer client-side so this component (and the
  // page that renders it) can be ISR-cached. useAuthUser() verifies the JWT
  // (no DB) and fetches the profile on `/api/auth/me` on demand.
  const { user, loading: authLoading } = useAuthUser();
  const authorName = user
    ? user.name?.trim() || user.email.split('@')[0]
    : null;

  /**
   * Whether THIS visitor may review, resolved by the server.
   *
   * `null` means "not known yet" — deliberately distinct from `false`, so the
   * UI never flashes "only verified buyers" at a real customer while their
   * session is still being verified. The POST route re-checks regardless, so
   * this is presentation only, never the gate.
   */
  const [eligibility, setEligibility] = useState<ReviewEligibility | null>(
    null
  );

  const [summary, setSummary] = useState(initialSummary);
  const [reviews, setReviews] = useState(initialReviews);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(
    Math.max(1, Math.ceil(initialTotal / PAGE_SIZE))
  );
  const [sort, setSort] = useState<'recent' | 'helpful'>('recent');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [helpfulClicked, setHelpfulClicked] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLDivElement>(null);

  // Eligibility is session-dependent, so it is re-fetched once the user is
  // known and on every slug change.
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    fetch(`/api/products/${slug}/reviews?page=1&limit=1&sort=recent`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(res => (res.ok ? res.json() : null))
      .then((data: { eligibility?: ReviewEligibility } | null) => {
        if (!cancelled) setEligibility(data?.eligibility ?? null);
      })
      .catch(() => {
        if (!cancelled) setEligibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, user?.id, authLoading]);

  const canReview = eligibility === 'eligible';

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/products/${slug}/reviews?page=1&limit=1&sort=recent`
      );
      if (!res.ok) return;
      const data = await res.json();
      setSummary(data.summary);
      setTotal(data.total);
      setTotalPages(Math.max(1, Math.ceil(data.total / PAGE_SIZE)));
    } catch {
      // keep old summary
    }
  }, [slug]);

  const fetchPage = useCallback(
    async (p: number, s: 'recent' | 'helpful', append: boolean) => {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await fetch(
          `/api/products/${slug}/reviews?page=${p}&limit=${PAGE_SIZE}&sort=${s}`
        );
        if (!res.ok) throw new Error('load failed');
        const data = await res.json();
        setSummary(data.summary);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setPage(data.page);
        setReviews(prev =>
          append ? [...prev, ...data.reviews] : data.reviews
        );
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [slug]
  );

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    fetchPage(1, sort, false);
  }, [sort, fetchPage]);

  const openForm = () => {
    setFormOpen(true);
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    );
  };

  const handlePosted = useCallback(
    (review: ProductReview) => {
      setSort('recent');
      setReviews(prev => [review, ...prev]);
      setTotal(t => t + 1);
      fetchSummary();
    },
    [fetchSummary]
  );

  const markHelpful = async (id: string) => {
    if (helpfulClicked.has(id)) return;
    setHelpfulClicked(prev => new Set(prev).add(id));
    setReviews(prev =>
      prev.map(r =>
        r.id === id ? { ...r, helpfulCount: r.helpfulCount + 1 } : r
      )
    );
    try {
      await fetch(`/api/products/${slug}/reviews/${id}/helpful`, {
        method: 'POST',
      });
    } catch {
      // optimistic — keep the +1 anyway
    }
  };

  return (
    <section id="reviews" aria-label="Customer reviews" className="w-full">
      <div className="border-t border-[#2B2620]/10 pt-10">
        <h2 className="font-serif text-2xl sm:text-3xl">Reviews</h2>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-4">
          {summary.count > 0 ? (
            <>
              <p className="font-serif text-5xl">
                {summary.average.toFixed(1)}
              </p>
              <div>
                <Stars value={summary.average} />
                <p className="mt-1 text-sm text-[#2B2620]/60">
                  Based on {summary.count} review
                  {summary.count === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex min-w-52 flex-1 flex-col gap-1 sm:max-w-xs">
                {([5, 4, 3, 2, 1] as const).map(star => {
                  const n = summary.distribution[star];
                  const pct = summary.count > 0 ? (n / summary.count) * 100 : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs">
                      <span className="w-6 shrink-0 text-[#2B2620]/60">
                        {star} ★
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#2B2620]/10">
                        <div
                          className="h-full rounded-full bg-[#C9962E]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-6 shrink-0 text-right text-[#2B2620]/60">
                        {n}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-[#2B2620]/60">
              No reviews yet. Be the first to share your love.
            </p>
          )}
          {/*
            The CTA tracks eligibility so the section never invites a review
            the API would reject. While `eligibility` is null we show nothing
            rather than guessing — a wrong "Write a review" is worse than a
            button that appears a moment later.
          */}
          {eligibility === 'eligible' && (
            <button
              type="button"
              onClick={openForm}
              className="ml-auto cursor-pointer rounded-full border border-[#2B2620] px-6 py-3 text-sm transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3]"
            >
              Write a review
            </button>
          )}
        </div>
        {formOpen && (
          <div
            ref={formRef}
            className="mt-8 scroll-mt-24 border border-[#2B2620]/15 bg-white/40 p-5 sm:p-6"
          >
            {canReview && authorName ? (
              <ReviewForm
                slug={slug}
                sizes={sizes}
                authorName={authorName}
                onPosted={handlePosted}
              />
            ) : (
              <div className="py-2 text-center">
                <p className="font-serif text-xl">
                  Reviews are only available to verified buyers
                </p>
                <p className="mt-1 text-sm text-[#2B2620]/60">
                  {eligibility === 'already_reviewed'
                    ? REVIEW_BLOCK_MESSAGES.already_reviewed
                    : REVIEW_BLOCK_MESSAGES.not_purchased}
                </p>
                {eligibility !== 'already_reviewed' && (
                  <>
                    <a
                      href={ORDERS_PATH}
                      className="mt-4 inline-block cursor-pointer rounded-full border border-[#2B2620] px-6 py-3 text-sm transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3]"
                    >
                      View your orders
                    </a>
                    <a
                      href={`/login?next=${encodeURIComponent(
                        `/products/${slug}`
                      )}`}
                      className="mt-4 ml-3 inline-block cursor-pointer text-sm underline underline-offset-4"
                    >
                      Not you? Log in
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {/* Signed-in visitors who are not verified buyers are told up front,
            without having to open a form they cannot submit. */}
        {eligibility === 'not_purchased' && !formOpen && (
          <p className="mt-6 text-sm text-[#2B2620]/60">
            Reviews are only available to verified buyers.{' '}
            <a
              href={ORDERS_PATH}
              className="underline underline-offset-4 hover:text-[#2B2620]"
            >
              See your orders
            </a>
          </p>
        )}
        {reviews.length > 0 ? (
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
                {total} review{total === 1 ? '' : 's'}
              </p>
              <label className="flex items-center gap-2 text-xs text-[#2B2620]/60">
                Sort
                <select
                  value={sort}
                  onChange={e =>
                    setSort(e.target.value as 'recent' | 'helpful')
                  }
                  className="cursor-pointer border border-[#2B2620]/20 bg-transparent px-2 py-1.5 text-xs outline-none"
                >
                  <option value="recent">Most recent</option>
                  <option value="helpful">Most helpful</option>
                </select>
              </label>
            </div>
            <ul className="mt-4 flex flex-col divide-y divide-[#2B2620]/10">
              {reviews.map(r => (
                <ReviewListItem
                  key={r.id}
                  review={r}
                  helpfulClicked={helpfulClicked.has(r.id)}
                  onHelpful={() => markHelpful(r.id)}
                />
              ))}
            </ul>
            {loadError && (
              <p role="alert" className="mt-2 text-sm text-[#A45A4B]">
                Couldn&apos;t load reviews.{' '}
                <button
                  type="button"
                  onClick={() => fetchPage(page, sort, false)}
                  className="cursor-pointer underline underline-offset-4"
                >
                  Retry
                </button>
              </p>
            )}
            {page < totalPages && (
              <button
                type="button"
                onClick={() => fetchPage(page + 1, sort, true)}
                disabled={loading}
                className="mt-4 w-full cursor-pointer rounded-full border border-[#2B2620]/20 px-6 py-3 text-sm transition-colors hover:border-[#2B2620] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Loading…' : 'Load more reviews'}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
