'use client';

import { useState } from 'react';
import { formatPrice } from '@/utils/product-format';
import {
  FREE_EXCHANGES_PER_ORDER,
  RETURN_FEE,
  RETURN_REASONS,
} from '@/utils/returns';

export type ExchangeVariant = { id: string; size: string; color: string };

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
  /** Set when the order isn't returnable; explains why. */
  disabledReason?: string | null;
};

const REASONS_NEEDING_PHOTOS = new Set([
  'Damaged on arrival',
  'Wrong item delivered',
]);

/**
 * Return / exchange form.
 *
 * Server-authoritative by design: eligibility is re-checked by the API, so the
 * button appearing is a convenience, never the enforcement. Hiding it based on
 * client-side logic would only give a false sense of security.
 */
export default function ReturnRequestForm({
  orderId,
  orderItemId,
  productName,
  size,
  color,
  unitPrice,
  currency,
  maxQty,
  exchangeVariants,
  disabledReason,
}: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'RETURN' | 'EXCHANGE'>('RETURN');
  const [reason, setReason] = useState<string>(RETURN_REASONS[0]);
  const [qty, setQty] = useState(1);
  const [exchangeVariantId, setExchangeVariantId] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ fee: string } | null>(null);

  const needsPhotos = REASONS_NEEDING_PHOTOS.has(reason);

  if (done) {
    return (
      <div className="rounded-2xl border border-[#5C6B4B]/30 bg-[#5C6B4B]/5 p-5">
        <p className="font-medium text-[#5C6B4B]">Request received</p>
        <p className="mt-1 text-sm text-[#2B2620]/70">
          We&rsquo;ve logged your {type === 'EXCHANGE' ? 'exchange' : 'return'}{' '}
          for {productName}. We&rsquo;ll email you within 24 hours to confirm
          and book the reverse pickup.
          {Number(done.fee) > 0 && (
            <>
              {' '}
              A handling fee of {formatPrice(done.fee, currency)} applies and is
              deducted from your refund.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => setDone(null)}
          className="mt-4 text-sm underline underline-offset-4 hover:text-[#5C6B4B]"
        >
          Submit another request
        </button>
      </div>
    );
  }

  if (disabledReason) {
    return (
      <p className="rounded-2xl border border-[#2B2620]/10 bg-[#FAF8F3] p-4 text-sm text-[#2B2620]/60">
        {disabledReason}
      </p>
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/account/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          orderItemId,
          type,
          reason,
          qty,
          exchangeVariantId: type === 'EXCHANGE' ? exchangeVariantId : null,
          photos: photoUrls,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Surface the server's own message: it knows the real reason (window
        // expired, photo missing, size gone), which the client cannot know.
        setError(body.error ?? 'Something went wrong. Please try again.');
        return;
      }
      setDone({ fee: body.return.fee });
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-[#2B2620]/20 px-4 py-2 text-sm text-[#2B2620] transition-colors hover:border-[#5C6B4B] hover:text-[#5C6B4B]"
      >
        Return or exchange
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[#2B2620]/12 bg-[#FAF8F3] p-5">
      <div>
        <p className="text-sm font-medium">
          Return or exchange: {productName}
        </p>
        <p className="text-xs text-[#2B2620]/50">
          {color} · {size} · {formatPrice(unitPrice, currency)} each
        </p>
      </div>

      <div className="flex gap-2">
        {(['RETURN', 'EXCHANGE'] as const).map(option => (
          <button
            key={option}
            type="button"
            onClick={() => setType(option)}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              type === option
                ? 'bg-[#2B2620] text-[#FAF8F3]'
                : 'border border-[#2B2620]/20 text-[#2B2620]/70 hover:border-[#5C6B4B]'
            }`}
          >
            {option === 'RETURN' ? 'Refund' : 'Exchange'}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-sm">Reason</span>
        <select
          value={reason}
          onChange={e => setReason(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[#2B2620]/15 bg-white px-3 py-2 text-sm"
        >
          {RETURN_REASONS.map(r => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      {maxQty > 1 && (
        <label className="block">
          <span className="text-sm">Quantity</span>
          <select
            value={qty}
            onChange={e => setQty(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-[#2B2620]/15 bg-white px-3 py-2 text-sm"
          >
            {Array.from({ length: maxQty }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}

      {type === 'EXCHANGE' && (
        <label className="block">
          <span className="text-sm">Exchange for size</span>
          <select
            value={exchangeVariantId}
            onChange={e => setExchangeVariantId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#2B2620]/15 bg-white px-3 py-2 text-sm"
          >
            <option value="">Choose a size…</option>
            {exchangeVariants.map(v => (
              <option key={v.id} value={v.id}>
                {v.color} in {v.size}
              </option>
            ))}
          </select>
          {exchangeVariants.length === 0 && (
            <p className="mt-1 text-xs text-[#2B2620]/50">
              No other sizes are in stock right now. A refund may be a better
              option.
            </p>
          )}
        </label>
      )}

      {needsPhotos && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            Please attach a photo of the item and its packaging. Claims without
            a photo can&rsquo;t be verified.
          </p>
          <label className="mt-2 inline-block cursor-pointer text-sm underline underline-offset-4">
            {photoUrls.length
              ? `${photoUrls.length} photo(s) added`
              : 'Add photo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async e => {
                const file = e.target.files?.[0];
                e.target.value = ''; // allow re-picking the same file
                if (!file) return;
                setUploading(true);
                setError(null);
                try {
                  // Uploads go to Cloudinary via the session-scoped endpoint —
                  // never base64 into the database.
                  const body = new FormData();
                  body.append('file', file);
                  const res = await fetch('/api/account/returns/photos', {
                    method: 'POST',
                    body,
                  });
                  const json = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    setError(json.error ?? 'Could not upload that photo.');
                    return;
                  }
                  setPhotoUrls(prev => [...prev, json.url].slice(0, 5));
                } catch {
                  setError('Could not upload that photo. Please try again.');
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
          {uploading && (
            <p className="mt-2 text-xs text-amber-800">Uploading photo…</p>
          )}
        </div>
      )}

      <p className="text-xs text-[#2B2620]/60">
        {type === 'RETURN' ? (
          <>
            A {formatPrice(String(RETURN_FEE), currency)} handling fee applies
            and is deducted from your refund.
          </>
        ) : (
          <>
            Your first {FREE_EXCHANGES_PER_ORDER} exchange on this order is
            free. Any further exchange costs{' '}
            {formatPrice(String(RETURN_FEE), currency)}.
          </>
        )}
      </p>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="rounded-full bg-[#2B2620] px-5 py-2 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-3 py-2 text-sm text-[#2B2620]/60 hover:text-[#2B2620]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
