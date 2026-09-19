'use client';

import { useState } from 'react';

/**
 * Shows the first half of an order number (e.g. "AD-MU5R…") with a copy
 * button that copies the full number to the clipboard.
 */
export default function CopyableOrderNumber({
  orderNumber,
  className = '',
}: {
  orderNumber: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const half = Math.max(4, Math.ceil(orderNumber.length / 2));
  const preview = `${orderNumber.slice(0, half)}…`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(orderNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — ignore.
    }
  };

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span title={orderNumber}>{preview}</span>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy order number"
        className="rounded p-0.5 text-[#2B2620]/40 transition-colors hover:text-[#2B2620]"
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#5C6B4B]">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </span>
  );
}