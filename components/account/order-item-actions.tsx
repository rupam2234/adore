'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReturnRequestForm, {
  type ExchangeVariant,
} from '@/components/account/return-request-form';

type TrackingInfo = {
  orderStatus: string | null;
  shipmentStatus: string | null;
  courierName: string | null;
  awb: string | null;
};

type TrackState =
  | { phase: 'loading' }
  | { phase: 'ready'; info: TrackingInfo | null; reason?: string }
  | { phase: 'error' };

type Props = {
  orderId: string;
  orderItemId: string;
  productName: string;
  size: string;
  color: string;
  unitPrice: string;
  currency: string;
  maxQty: number;
  exchangeVariants: ExchangeVariant[];
  /** Set when the order isn't returnable; shown as a hint on the menu item. */
  returnDisabledReason: string | null;
};

/** "OUT_FOR_DELIVERY" → "Out for delivery" — courier strings are shouty. */
function prettyStatus(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Shiprocket's public tracking page — no login, works for any AWB. */
function trackingUrlFor(awb: string): string {
  return `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
}

/**
 * ⋯ context menu for one order line: track the parcel, or start a return.
 *
 * "Return or exchange" is disabled (with the reason) unless the order is
 * delivered and verifiable — the API re-checks eligibility on submit, so this
 * is courtesy, never enforcement. Tracking is fetched on demand from
 * /api/account/orders/[id]/track, which proxies Shiprocket server-side.
 *
 * RENDERING: the menu portals into document.body with fixed coordinates from
 * the button's rect (same approach as the admin ledger menu), so it always
 * pops over the page regardless of scroll.
 */
export default function OrderItemActions({
  orderId,
  orderItemId,
  productName,
  size,
  color,
  unitPrice,
  currency,
  maxQty,
  exchangeVariants,
  returnDisabledReason,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [panel, setPanel] = useState<'none' | 'track' | 'return'>('none');
  const [track, setTrack] = useState<TrackState | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 224;
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - menuWidth - 8)
      );
      const top = Math.min(rect.bottom + 6, window.innerHeight - 140);
      setPos({ top, left });
    }
    setMenuOpen(true);
  }

  // Close when anything scrolls or the window resizes — fixed coordinates
  // would otherwise detach from the page.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menuOpen]);

  // Outside click + Escape. The menu lives in a portal, so document-level
  // listeners must exclude both the button and the menu itself.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        menuRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  async function trackOrder() {
    setMenuOpen(false);
    setPanel('track');
    setTrack({ phase: 'loading' });
    try {
      const res = await fetch(`/api/account/orders/${orderId}/track`);
      const body = (await res.json().catch(() => ({}))) as {
        tracking?: TrackingInfo | null;
        reason?: string;
      };
      if (!res.ok) {
        setTrack({ phase: 'error' });
        return;
      }
      setTrack({
        phase: 'ready',
        info: body.tracking ?? null,
        reason: body.reason,
      });
    } catch {
      setTrack({ phase: 'error' });
    }
  }

  const latestStatus =
    track?.phase === 'ready' && track.info
      ? (track.info.shipmentStatus ?? track.info.orderStatus)
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Order actions"
        title="Order actions"
        onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
        className="cursor-pointer rounded-full bg-orange-200 px-2.5 py-1 text-lg leading-none text-[#2B2620]/60 transition-colors hover:bg-orange-200/50 hover:text-[#2B2620]"
      >
        ⋯
      </button>

      {menuOpen &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className="z-50 w-56 overflow-hidden rounded-xl border border-[#2B2620]/10 bg-white py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={trackOrder}
              className="block w-full cursor-pointer px-4 py-2 text-left text-sm text-[#2B2620] hover:bg-[#FAF8F3]"
            >
              Track order status
            </button>
            {returnDisabledReason ? (
              <div
                role="menuitem"
                aria-disabled="true"
                className="px-4 py-2 opacity-50"
              >
                <p className="text-sm text-[#2B2620]">Return or exchange</p>
                <p className="mt-0.5 text-xs text-[#2B2620]/60">
                  {returnDisabledReason}
                </p>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setPanel('return');
                }}
                className="block w-full cursor-pointer px-4 py-2 text-left text-sm text-[#2B2620] hover:bg-[#FAF8F3]"
              >
                Return or exchange
              </button>
            )}
          </div>,
          document.body
        )}

      {panel === 'track' && (
        <div className="mt-2 rounded-2xl border border-[#2B2620]/10 bg-[#FAF8F3] p-4 text-sm">
          {track?.phase === 'loading' && (
            <p className="text-[#2B2620]/60">Checking with the courier…</p>
          )}
          {track?.phase === 'error' && (
            <p className="text-[#2B2620]/60">
              Couldn&rsquo;t reach the courier right now. Please try again in a
              moment.
            </p>
          )}
          {track?.phase === 'ready' && !track.info && (
            <p className="text-[#2B2620]/60">
              {track.reason === 'NOT_BOOKED'
                ? 'Your parcel hasn’t been handed to the courier yet. Check back once your order is dispatched.'
                : 'Tracking is unavailable right now. Please try again in a moment. Or get in touch with us.'}
            </p>
          )}
          {track?.phase === 'ready' && track.info && (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wider text-[#2B2620]/50">
                  Courier
                </dt>
                <dd className="mt-0.5">{track.info.courierName ?? '—'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wider text-[#2B2620]/50">
                  Tracking no.
                </dt>
                <dd className="mt-0.5 break-all">
                  {track.info.awb ? (
                    // The AWB links to the courier's public tracking page —
                    // the number is the thing people copy, so it doubles as
                    // the link.
                    <a
                      href={trackingUrlFor(track.info.awb)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-[#2B2620]"
                    >
                      {track.info.awb}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-[#2B2620]/50">
                  Status
                </dt>
                <dd className="mt-0.5">
                  {latestStatus ? prettyStatus(latestStatus) : '—'}
                </dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {panel === 'return' && (
        <div className="mt-2">
          <ReturnRequestForm
            orderId={orderId}
            orderItemId={orderItemId}
            productName={productName}
            size={size}
            color={color}
            unitPrice={unitPrice}
            currency={currency}
            maxQty={maxQty}
            exchangeVariants={exchangeVariants}
            onClose={() => setPanel('none')}
          />
        </div>
      )}
    </>
  );
}
