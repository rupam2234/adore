'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small ⋯ context menu for an order row in the ledger.
 *
 * Offers navigation to the details page (where the protected cancellation
 * lives) and a deep link into Shiprocket. No destructive action here —
 * cancelling requires the details page's type-to-confirm lock, so a stray
 * click in a busy table can never cancel an order.
 *
 * RENDERING: the ledger table sits in an `overflow-x-auto` wrapper, which
 * would clip any absolutely-positioned dropdown (and start a nested scroll).
 * The menu therefore renders through a PORTAL into document.body with fixed
 * coordinates computed from the button's bounding rect, so it always pops over
 * everything regardless of table scroll.
 */
export default function OrderActionsMenu({
  orderId,
  orderNumber,
  shiprocketOrderId,
}: {
  orderId: string;
  orderNumber: string;
  shiprocketOrderId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // `pos` is only ever set inside a click handler via getBoundingClientRect(),
  // so `open && pos` proves we are client-side — no SSR-mount flag needed.
  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      // Menu is w-52 (13rem = 208px); right-align to the button and clamp so
      // it never overflows the viewport on narrow windows.
      const menuWidth = 208;
      const left = Math.max(
        8,
        Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)
      );
      const top = Math.min(rect.bottom + 6, window.innerHeight - 120);
      setPos({ top, left });
    }
    setOpen(true);
  }

  // Close when anything scrolls or the window resizes — fixed coordinates
  // would otherwise detach from the row.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  // Outside click + Escape. The menu lives in a portal, so document-level
  // listeners must exclude both the button and the menu itself.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        menuRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for order ${orderNumber}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="cursor-pointer rounded-full px-2.5 py-1 text-lg leading-none text-[#2B2620]/60 transition-colors hover:bg-[#2B2620]/5 hover:text-[#2B2620]"
      >
        ⋯
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className="z-50 w-52 overflow-hidden rounded-xl border border-[#2B2620]/10 bg-white py-1 shadow-lg"
          >
            <Link
              href={`/admin/orders/${orderId}`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-[#2B2620] hover:bg-[#FAF8F3]"
            >
              View details
            </Link>
            {shiprocketOrderId && (
              <a
                href="https://app.shiprocket.in/seller/order/new"
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-[#2B2620] hover:bg-[#FAF8F3]"
              >
                Open in Shiprocket ↗
              </a>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
