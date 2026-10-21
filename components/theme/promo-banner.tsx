'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthUser } from '@/components/auth/use-auth-user';
import {
  WELCOME_DISCOUNT_PERCENT,
  WELCOME_MIN_ORDER,
  WELCOME_VALIDITY_LABEL,
} from '@/utils/welcome-promo-config';

const DISMISS_KEY = 'adore_promo_banner_dismissed_at';
/** Re-show the stripe this long after the visitor dismissed it. */
const RESHOW_AFTER_MS = 1 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Global promo stripe.
 *
 * Placement rules:
 *  - Pages with <SiteHeader /> get it automatically: the header renders it
 *    right below itself.
 *  - The homepage renders its own instance below the hero instead, so this
 *    component renders null on `/` unless `force` is passed.
 *  - Hidden for signed-in members (they already have their welcome code).
 *  - Dismissible; comes back after RESHOW_AFTER_MS.
 */
export default function PromoBanner({ force = false }: { force?: boolean }) {
  const pathname = usePathname();
  const { user, loading } = useAuthUser();
  const [dismissed, setDismissed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      setDismissed(at > 0 && Date.now() - at < RESHOW_AFTER_MS);
    } catch {
      // storage unavailable — always show
    }
    setReady(true);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  // Homepage mounts its own instance below the hero (it passes `force`).
  if (!force && pathname === '/') return null;
  // Wait for storage + auth resolution so the stripe doesn't flash and
  // doesn't nag members who already have their code.
  if (!ready || loading || dismissed) return null;
  if (user) return null;

  return (
    <div
      role="region"
      aria-label="Promotion"
      className="relative w-full bg-[#5C6B4B] text-[#FAF8F3]"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-10 py-2.5 text-center text-xs sm:text-sm">
        <p className="leading-snug">
          <span className="font-semibold">
            Create a free account for {WELCOME_DISCOUNT_PERCENT}% off your first
            order
          </span>
          .{' '}
          {/* <span className="hidden text-[#FAF8F3]/80 sm:inline">
            (min {WELCOME_MIN_ORDER}) — your code arrives instantly, valid{' '}
            {WELCOME_VALIDITY_LABEL}.
          </span> */}
        </p>
        <Link
          href="/signup"
          className="shrink-0 rounded-full bg-[#FAF8F3] px-3 py-1 text-xs font-semibold text-[#5C6B4B] transition-colors hover:bg-white"
        >
          Sign up
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss promotion"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#FAF8F3]/70 transition-colors hover:bg-[#FAF8F3]/10 hover:text-[#FAF8F3]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
