'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const CANCEL_REASONS = [
  'Customer requested cancellation',
  'Out of stock / cannot fulfil',
  'Suspected duplicate order',
  'Suspected fraud / verification failed',
  'Address undeliverable',
  'Other (see note)',
] as const;

/**
 * Protected cancellation switch.
 *
 * Deliberately annoying to use: the admin must unlock the panel, type the full
 * order number (type-to-confirm) and pick a reason before the destructive
 * button works, then confirm a dialog on top. An accidental click can never
 * reach Shiprocket — and a reason is always recorded.
 *
 * Renders as a locked panel for non-cancellable orders (shipped, delivered,
 * refunded, already cancelled) with the reason why.
 */
export default function CancelOrderPanel({
  orderId,
  orderNumber,
  status,
  hasCourierBooking,
}: {
  orderId: string;
  orderNumber: string;
  status: string;
  hasCourierBooking: boolean;
}) {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState<string>(CANCEL_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const cancellable = status === 'CONFIRMED' || status === 'PROCESSING';
  const matches = typed.trim().toUpperCase() === orderNumber.toUpperCase();
  const armed = unlocked && matches && !busy;

  if (!cancellable) {
    return (
      <section className="mt-6 rounded-2xl border border-[#2B2620]/10 bg-white p-6">
        <h2 className="font-admin font-semibold text-lg">Cancel order</h2>
        <p className="mt-3 text-sm text-[#2B2620]/60">
          {status === 'CANCELLED'
            ? 'This order is already cancelled.'
            : status === 'SHIPPED' || status === 'DELIVERED'
              ? `This order is already ${status.toLowerCase()} — cancellation is no longer possible. Process a return instead.`
              : `An order in status ${status} cannot be cancelled.`}
        </p>
      </section>
    );
  }

  async function cancelOrder() {
    if (
      !window.confirm(
        `Cancel ${orderNumber}?\n\n` +
          (hasCourierBooking
            ? 'The Shiprocket booking will be cancelled and the items returned to stock.\n\n'
            : 'The items will be returned to stock.\n\n') +
          'This action is logged.'
      )
    ) {
      return;
    }

    setBusy(true);
    setResult(null);

    try {
      const res = await fetch(`/api/admin/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: note.trim() ? `${reason} — ${note.trim()}` : reason,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      if (!res.ok) {
        setResult({
          ok: false,
          text:
            data.error ??
            'Could not cancel this order. Nothing was changed — refresh and try again.',
        });
      } else {
        setResult({ ok: true, text: data.message ?? 'Order cancelled.' });
        // Re-lock the panel and refresh server data.
        setUnlocked(false);
        setTyped('');
        router.refresh();
      }
    } catch {
      setResult({ ok: false, text: 'Network error. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-[#A45A4B]/30 bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-admin font-semibold text-lg">Cancel order</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.15em] ${armed ? 'bg-[#A45A4B] text-white' : 'bg-[#2B2620]/10 text-[#2B2620]/60'}`}
        >
          {armed ? 'Unlocked' : 'Protected'}
        </span>
      </div>

      {hasCourierBooking && (
        <p className="mt-2 text-xs text-amber-700">
          This order has a Shiprocket booking. Cancelling here also cancels the
          courier booking; if the parcel is already dispatched, Shiprocket will
          refuse and nothing here changes.
        </p>
      )}

      {unlocked && (
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-[#2B2620]/60">
              Reason
            </span>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-[#2B2620]/20 bg-white px-3 py-2 text-sm focus:border-[#2B2620] focus:outline-none"
            >
              {CANCEL_REASONS.map(r => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-[#2B2620]/60">
              Note (optional)
            </span>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              disabled={busy}
              maxLength={280}
              placeholder="Extra context for the record"
              className="w-full rounded-lg border border-[#2B2620]/20 bg-white px-3 py-2 text-sm placeholder:text-[#2B2620]/30 focus:border-[#2B2620] focus:outline-none"
            />
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {unlocked ? (
          <>
            <label className="min-w-[240px] flex-1">
              <span className="mb-1 block text-xs uppercase tracking-wider text-[#2B2620]/60">
                Type{' '}
                <span className="font-medium text-[#2B2620]">
                  {orderNumber}
                </span>{' '}
                to confirm
              </span>
              <input
                type="text"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                placeholder={orderNumber}
                className="w-full rounded-lg border border-[#2B2620]/20 bg-white px-3 py-2 text-sm placeholder:text-[#2B2620]/30 focus:border-[#A45A4B] focus:outline-none"
                aria-invalid={typed.length > 0 && !matches}
              />
            </label>
            <button
              type="button"
              onClick={() => void cancelOrder()}
              disabled={!armed}
              className="cursor-pointer rounded-full bg-[#A45A4B] px-6 py-2.5 text-sm text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Cancelling…' : 'Cancel order'}
            </button>
            <button
              type="button"
              onClick={() => {
                setUnlocked(false);
                setTyped('');
              }}
              disabled={busy}
              className="cursor-pointer pb-2.5 text-sm text-[#2B2620]/60 underline-offset-4 hover:underline disabled:opacity-40"
            >
              Re-lock
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setUnlocked(true)}
            className="cursor-pointer rounded-full border border-[#A45A4B]/40 px-6 py-2.5 text-sm text-[#A45A4B] transition-colors hover:bg-[#A45A4B]/5"
          >
            Unlock cancellation
          </button>
        )}
      </div>

      {result && (
        <p
          className={`mt-3 text-sm ${result.ok ? 'text-[#5C6B4B]' : 'text-red-700'}`}
          role="alert"
        >
          {result.text}
        </p>
      )}
    </section>
  );
}
