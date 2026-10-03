'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatPrice } from '@/utils/product-format';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { SELF_SHIP } from '@/utils/returns';

/**
 * The customer's returns list, with live status and a cancel button.
 *
 * This answers "where is my return?" — without it a customer has no way to find
 * out that their parcel is sitting in a warehouse awaiting inspection, and no
 * way to withdraw a request they no longer want.
 *
 * Two rules govern what is rendered:
 *
 *  1. NO INTERNALS. The API deliberately does not select risk scores, block
 *     reasons or internal notes (see utils/returns-db.ts). A customer must never
 *     be able to learn they are being scored, or why.
 *  2. NO AMBIGUITY ON MONEY. When a refund is in flight we show the figure that
 *     was actually claimed, not a re-derived estimate, so the number on screen
 *     is the number that will reach the bank.
 */
export type CustomerReturn = {
  id: string;
  orderId: string;
  orderNumber: string;
  productName: string;
  type: string;
  reason: string;
  status: string;
  qty: number;
  fee: string;
  refundAmount: string;
  netRefund: string | null;
  payoutAmount: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  returnAwb: string | null;
  selfShip: boolean;
};

/**
 * Plain-English status, written from the customer's point of view.
 *
 * Deliberately free of internal vocabulary. A customer never sees
 * SELF_SHIP_PENDING or QC_PASSED; they see "waiting for your parcel" and
 * "being checked", which are the parts they can act on.
 */
const STATUS_COPY: Record<string, { label: string; detail: string; tone: string }> = {
  REQUESTED: {
    label: 'Received',
    detail: 'We have your request and will confirm within 24 hours.',
    tone: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  APPROVED: {
    label: 'Approved',
    detail: 'We are arranging the reverse pickup from your address.',
    tone: 'bg-blue-50 text-blue-900 border-blue-200',
  },
  PICKUP_SCHEDULED: {
    label: 'Pickup booked',
    detail:
      'Our courier will collect the parcel. Please keep it packed and your phone on.',
    tone: 'bg-indigo-50 text-indigo-900 border-indigo-200',
  },
  PICKUP_FAILED: {
    label: 'Pickup not completed',
    detail:
      'We could not collect the parcel. Our team will contact you to arrange another attempt or a self-ship.',
    tone: 'bg-orange-50 text-orange-900 border-orange-200',
  },
  SELF_SHIP_PENDING: {
    label: 'Waiting for your parcel',
    detail: `Reverse pickup is not available at your PIN code. Please send the parcel to us and we will reimburse ₹${SELF_SHIP.returnReimbursement} of the return shipping. Your handling fee has been waived.`,
    tone: 'bg-stone-100 text-stone-800 border-stone-300',
  },
  IN_TRANSIT: {
    label: 'On its way to us',
    detail: 'Your parcel is travelling to our warehouse.',
    tone: 'bg-indigo-50 text-indigo-900 border-indigo-200',
  },
  RECEIVED: {
    label: 'Received, being checked',
    detail: 'Your parcel reached us and is waiting for inspection.',
    tone: 'bg-purple-50 text-purple-900 border-purple-200',
  },
  QC_PASSED: {
    label: 'Checked, refund in progress',
    detail: 'Your item passed inspection and your refund is being processed.',
    tone: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  },
  QC_FAILED: {
    label: 'Did not pass inspection',
    detail:
      'We could not accept the item. The reason is below. Reply to us and a person, not an automated rule, will review it.',
    tone: 'bg-rose-50 text-rose-900 border-rose-200',
  },
  EXCHANGE_SHIPPED: {
    label: 'Replacement dispatched',
    detail: 'Your replacement is on its way to you.',
    tone: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  },
  EXCHANGE_FAILED: {
    label: 'Replacement unavailable',
    detail:
      'We could not send the replacement. Your refund is being processed instead.',
    tone: 'bg-rose-50 text-rose-900 border-rose-200',
  },
  REFUND_PENDING: {
    label: 'Refund on its way',
    detail:
      'Your refund has been sent to your payment provider. Allow a few working days.',
    tone: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  },
  REFUNDED: {
    label: 'Refunded',
    detail: 'The money has been returned to your original payment method.',
    tone: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  },
  REFUND_FAILED: {
    label: 'Refund issue',
    detail:
      'We could not process the refund automatically. Our team is on it. You do not need to do anything.',
    tone: 'bg-rose-50 text-rose-900 border-rose-200',
  },
  REJECTED: {
    label: 'Not accepted',
    detail: 'We were not able to accept this return. The reason is below.',
    tone: 'bg-rose-50 text-rose-900 border-rose-200',
  },
  CANCELLED: {
    label: 'Cancelled',
    detail: 'This request was cancelled.',
    tone: 'bg-stone-100 text-stone-700 border-stone-300',
  },
};

export default function CustomerReturnsList({
  returns,
}: {
  returns: CustomerReturn[];
}) {
  if (returns.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-[#2B2620]/20 bg-white px-6 py-16 text-center">
        <h2 className="font-serif text-xl">No returns yet</h2>
        <p className="mt-2 text-sm text-[#2B2620]/60">
          When you request a return or exchange, you will be able to track it
          here.
        </p>
        <Link
          href="/account/orders"
          className="mt-6 inline-block rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
        >
          View your orders
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="font-serif text-xl">Your returns</h2>
      <div className="space-y-4">
        {returns.map(item => (
          <ReturnCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function ReturnCard({ item }: { item: CustomerReturn }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const copy = STATUS_COPY[item.status] ?? {
    label: item.status,
    detail: '',
    tone: 'bg-stone-100 text-stone-800 border-stone-300',
  };

  // Cancellation is only offered while the request is still in a state the
  // customer controls. Once a rider is booked or the parcel is moving, closing
  // it is an operations decision — see cancelReturnByCustomer.
  const canCancel = item.status === 'REQUESTED' || item.status === 'APPROVED';

  // The figure shown is the one that was CLAIMED, not a re-derivation. If they
  // differ, the customer would be quoted a number we are not going to pay.
  const payout = item.payoutAmount ?? item.netRefund ?? item.refundAmount;

  async function cancel() {
    if (
      !window.confirm(
        'Cancel this return request? You can raise a new one later while the window is open.'
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/account/returns/${item.id}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not cancel this request.');
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError('Network error. Please try again.');
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-[#2B2620]/10 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#2B2620]/10 px-6 py-4">
        <div className="min-w-0">
          <p className="font-medium">{item.productName}</p>
          <p className="text-xs text-[#2B2620]/50">
            Order {item.orderNumber} · qty {item.qty} ·{' '}
            {item.type === 'EXCHANGE' ? 'Exchange' : 'Return'}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${copy.tone}`}
        >
          {copy.label}
        </span>
      </div>

      <div className="space-y-3 px-6 py-4">
        {copy.detail && (
          <p className="text-sm leading-relaxed text-[#2B2620]/80">
            {copy.detail}
          </p>
        )}

        {item.rejectionReason && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {item.rejectionReason}
          </p>
        )}

        {item.status === 'SELF_SHIP_PENDING' && (
          <p className="rounded-lg bg-[#FAF8F3] px-3 py-2 text-xs text-[#2B2620]/70">
            Tip: keep your tracking receipt. We will reimburse ₹
            {SELF_SHIP.returnReimbursement} toward the return shipping once the
            parcel reaches us.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-[#2B2620]/50">Item value</dt>
            <dd className="font-medium">
              {formatPrice(item.refundAmount, 'INR')}
            </dd>
          </div>
          {Number(item.fee) > 0 && (
            <div>
              <dt className="text-[#2B2620]/50">Handling fee</dt>
              <dd className="font-medium">
                &minus;{formatPrice(item.fee, 'INR')}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-[#2B2620]/50">
              {['REFUNDED', 'REFUND_PENDING', 'QC_PASSED'].includes(item.status)
                ? 'Refund amount'
                : 'You will receive'}
            </dt>
            <dd className="font-medium text-emerald-800">
              {formatPrice(payout, 'INR')}
            </dd>
          </div>
          <div>
            <dt className="text-[#2B2620]/50">Raised</dt>
            <dd className="font-medium">
              {formatDistanceToNow(parseISO(item.createdAt), {
                addSuffix: true,
              })}
            </dd>
          </div>
        </dl>

        {item.returnAwb && (
          <p className="text-xs text-[#2B2620]/50">
            Return tracking reference: {item.returnAwb}
          </p>
        )}

        {error && <p className="text-sm text-rose-700">{error}</p>}
      </div>

      {canCancel && (
        <div className="border-t border-[#2B2620]/10 px-6 py-3">
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="text-sm text-[#2B2620]/60 underline underline-offset-4 transition-colors hover:text-rose-700 disabled:opacity-50"
          >
            {pending ? 'Cancelling…' : 'Cancel this request'}
          </button>
        </div>
      )}
    </article>
  );
}
