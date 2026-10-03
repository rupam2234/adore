'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { AdminReturn } from '@/utils/returns-ops';
import { formatPrice } from '@/utils/product-format';

/**
 * One row in the returns queue, with the actions valid for its current state.
 *
 * The server re-checks every action regardless — this component is a
 * convenience layer, never the enforcement. It is written so that staff cannot
 * click their way into a 422: the buttons shown are exactly the actions that
 * make sense for the status, and the one irreversible action (issuing money)
 * states the amount and requires a browser confirmation.
 */

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Needs review',
  APPROVED: 'Approved, book pickup',
  PICKUP_SCHEDULED: 'Pickup booked',
  PICKUP_FAILED: 'Pickup failed',
  SELF_SHIP_PENDING: 'Waiting on customer',
  IN_TRANSIT: 'In transit to us',
  RECEIVED: 'Received, needs QC',
  QC_PASSED: 'Passed QC, refund due',
  QC_FAILED: 'Failed QC',
  EXCHANGE_SHIPPED: 'Exchange dispatched',
  EXCHANGE_FAILED: 'Exchange failed',
  REFUND_PENDING: 'Refund in flight',
  REFUND_FAILED: 'Refund failed',
};

const STATUS_TONES: Record<string, string> = {
  REQUESTED: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-blue-100 text-blue-900',
  PICKUP_SCHEDULED: 'bg-indigo-100 text-indigo-900',
  PICKUP_FAILED: 'bg-orange-100 text-orange-900',
  SELF_SHIP_PENDING: 'bg-stone-200 text-stone-800',
  IN_TRANSIT: 'bg-indigo-100 text-indigo-900',
  RECEIVED: 'bg-purple-100 text-purple-900',
  QC_PASSED: 'bg-emerald-100 text-emerald-900',
  QC_FAILED: 'bg-rose-100 text-rose-900',
  EXCHANGE_SHIPPED: 'bg-emerald-100 text-emerald-900',
  EXCHANGE_FAILED: 'bg-rose-100 text-rose-900',
  REFUND_PENDING: 'bg-emerald-100 text-emerald-900',
  REFUND_FAILED: 'bg-rose-100 text-rose-900',
};

function riskTone(score: number): string {
  if (score >= 60) return 'bg-rose-600 text-white';
  if (score >= 30) return 'bg-amber-500 text-white';
  return 'bg-stone-200 text-stone-700';
}

/** The exact figure the gateway will be asked to send, for the settle button. */
function payoutFor(request: AdminReturn): number {
  return Math.max(0, Number(request.refundAmount) - Number(request.fee));
}

export default function ReturnRow({ request }: { request: AdminReturn }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(
    action: string,
    extra: Record<string, unknown> = {},
    confirmMessage?: string
  ) {
    // The irreversible actions pass a confirmation string. `window.confirm` is
    // crude, but the server cannot distinguish a deliberate refund from a
    // mis-click on the right row, so this is the last line of defence for the
    // one mistake that costs real money.
    if (confirmMessage && !window.confirm(confirmMessage)) return;

    setError(null);
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/returns/${request.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `confirm` is stripped: it is a UI affordance, never sent to the server.
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'That did not work. Please try again.');
        return;
      }
      setNote('');
      setShowReject(false);
      startTransition(() => router.refresh());
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setBusy(null);
    }
  }


  const canSettle = request.status === 'QC_PASSED' && request.type === 'RETURN';
  const canFulfil = request.status === 'QC_PASSED' && request.type === 'EXCHANGE';
  const working = pending || busy !== null;

  return (
    <tr className="border-t border-[#2B2620]/10 align-top">
      <td className="px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
              STATUS_TONES[request.status] ?? 'bg-stone-200 text-stone-800'
            }`}
          >
            {STATUS_LABELS[request.status] ?? request.status}
          </span>
          {request.type === 'EXCHANGE' && (
            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] text-stone-700">
              Exchange
            </span>
          )}
        </div>
        <p className="mt-2 font-medium">{request.productName}</p>
        <p className="text-xs text-[#2B2620]/50">
          {request.sku} · qty {request.qty} · {request.reason}
        </p>
      </td>

      <td className="px-4 py-4 text-xs">
        <p className="font-medium">{request.orderNumber}</p>
        <p className="text-[#2B2620]/60">{request.customerName}</p>
        <p className="text-[#2B2620]/50">{request.customerEmail}</p>
        {request.customerPhone && (
          <p className="text-[#2B2620]/50">{request.customerPhone}</p>
        )}
      </td>

      <td className="px-4 py-4 text-xs">
        {/* Gross and net shown together on purpose: an admin approving a refund
            should see exactly what is deducted and what is paid, not compute it. */}
        <p className="font-medium">
          Refund {formatPrice(request.refundAmount, 'INR')}
        </p>
        {Number(request.fee) > 0 && (
          <p className="text-[#2B2620]/60">
            less fee {formatPrice(request.fee, 'INR')}
          </p>
        )}
        <p className="mt-1 font-medium text-emerald-800">
          pays {formatPrice(String(payoutFor(request)), 'INR')}
        </p>
        {request.pickupAttempts > 0 && (
          <p className="mt-1 text-[#2B2620]/50">
            {request.pickupAttempts} pickup attempt
            {request.pickupAttempts === 1 ? '' : 's'}
          </p>
        )}
        {request.returnAwb && (
          <p className="text-[#2B2620]/50">RMA {request.returnAwb}</p>
        )}
      </td>

      <td className="px-4 py-4">
        <span
          className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${riskTone(
            request.riskScore
          )}`}
          title={request.riskReasons?.join('\n') || 'No risk signals'}
        >
          {request.riskScore}
        </span>
        {request.isBlocked && (
          <p className="mt-2 max-w-[16rem] text-[11px] leading-snug text-rose-700">
            {request.blockedReason}
          </p>
        )}
        {!request.isBlocked &&
          request.riskReasons &&
          request.riskReasons.length > 0 && (
            <ul className="mt-2 max-w-[16rem] space-y-1 text-[11px] leading-snug text-[#2B2620]/55">
              {request.riskReasons.slice(0, 3).map(reason => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        {request.photos.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {request.photos.map(url => (
              // Evidence photos are pinned to our own Cloudinary host and
              // length-checked server-side before they are ever stored.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt="Customer evidence"
                className="h-12 w-12 rounded object-cover"
              />
            ))}
          </div>
        )}
      </td>

      <td className="px-4 py-4">
        {working ? (
          <p className="text-xs text-[#2B2620]/50">Working…</p>
        ) : (
          <div className="flex flex-col items-start gap-2">
            {request.status === 'REQUESTED' && (
              <>
                <ActionButton onClick={() => act('approve')}>Approve</ActionButton>
                <ActionButton tone="danger" onClick={() => setShowReject(v => !v)}>
                  Refuse
                </ActionButton>
              </>
            )}

            {request.status === 'APPROVED' && (
              <ActionButton onClick={() => act('book_pickup')}>
                Book pickup
              </ActionButton>
            )}

            {request.status === 'PICKUP_FAILED' && (
              <ActionButton onClick={() => act('book_pickup')}>
                Retry pickup
              </ActionButton>
            )}

            {(request.status === 'IN_TRANSIT' ||
              request.status === 'SELF_SHIP_PENDING') && (
              <ActionButton onClick={() => act('mark_received')}>
                Mark received
              </ActionButton>
            )}

            {request.status === 'RECEIVED' && (
              <>
                <ActionButton onClick={() => act('qc_pass')}>Pass QC</ActionButton>
                <ActionButton tone="danger" onClick={() => setShowReject(v => !v)}>
                  Fail QC
                </ActionButton>
              </>
            )}

            {canFulfil && (
              <ActionButton onClick={() => act('fulfil_exchange')}>
                Send replacement
              </ActionButton>
            )}

            {canSettle && (
              <ActionButton
                tone="money"
                onClick={() =>
                  act(
                    'settle',
                    {},
                    // The one irreversible action in the system. A browser
                    // confirm() is a weak guard, but it costs nothing and stops
                    // the fat-finger case the server cannot detect.
                    `Refund ${formatPrice(
                      String(payoutFor(request)),
                      'INR'
                    )} to ${request.customerName}? This cannot be undone.`
                  )
                }
              >
                Refund {formatPrice(String(payoutFor(request)), 'INR')}
              </ActionButton>
            )}

            {request.status === 'REFUND_FAILED' && (
              <ActionButton onClick={() => act('settle')}>Retry refund</ActionButton>
            )}

            {(request.status === 'QC_FAILED' ||
              request.status === 'EXCHANGE_FAILED') && (
              <ActionButton tone="danger" onClick={() => setShowReject(v => !v)}>
                Refuse
              </ActionButton>
            )}

            {showReject && (
              <div className="mt-1 w-full space-y-2">
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Reason shown to the customer"
                  rows={2}
                  className="w-full rounded border border-[#2B2620]/20 p-2 text-xs"
                />
                <ActionButton
                  tone="danger"
                  onClick={() => act('reject', { reason: note })}
                >
                  Confirm refusal
                </ActionButton>
              </div>
            )}

            {error && <p className="text-xs text-rose-700">{error}</p>}
          </div>
        )}
      </td>
    </tr>
  );
}

function ActionButton({
  children,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'danger' | 'money';
}) {
  const tones = {
    default:
      'border-[#2B2620]/25 hover:border-[#5C6B4B] hover:text-[#5C6B4B]',
    danger: 'border-rose-300 text-rose-800 hover:bg-rose-50',
    money: 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700',
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${tones[tone]}`}
    >
      {children}
    </button>
  );
}
