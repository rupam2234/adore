import { requireAdminPage } from '@/utils/admin-session';
import { listAdminReturns } from '@/utils/returns-ops';
import { formatPrice } from '@/utils/product-format';
import ReturnRow from '@/components/admin/return-row';
import Link from 'next/link';

export const metadata = {
  title: 'Returns queue',
  robots: { index: false, follow: false },
};

/**
 * The returns work queue.
 *
 * This page is the operational half of the flow that was missing: without it a
 * return request sits at REQUESTED forever, because nothing in the customer
 * path can approve a pickup, pass an item through inspection, or issue a
 * refund.
 *
 * The ordering is done in SQL (see listAdminReturns): first by what needs a
 * human, then by risk score descending. That combination is the whole point —
 * "needs a decision" and "most likely to be fraudulent" are different axes, and
 * a purely chronological list would let a batch of ordinary returns bury the one
 * request that would have cost the most if approved carelessly.
 */
export default async function AdminReturnsPage() {
  await requireAdminPage();

  const requests = await listAdminReturns({ limit: 200 });

  // Headline numbers, so an operator can see the shape of the queue without
  // scrolling. Refunds "due" is the money-shaped one: every one of those needs
  // a deliberate click before it moves.
  const counts = {
    needsReview: requests.filter(r => r.status === 'REQUESTED').length,
    needsQc: requests.filter(r => r.status === 'RECEIVED').length,
    needsPickup: requests.filter(r => r.status === 'APPROVED').length,
    refundDue: requests
      .filter(r => r.status === 'QC_PASSED' && r.type === 'RETURN')
      .reduce(
        (sum, r) => sum + Math.max(0, Number(r.refundAmount) - Number(r.fee)),
        0
      ),
    blocked: requests.filter(r => r.isBlocked).length,
    highRisk: requests.filter(r => r.riskScore >= 60).length,
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Returns &amp; exchanges
        </h1>
        <p className="mt-1 text-sm text-[#2B2620]/60">
          Ordered by what needs you first, then by risk. Money only moves after
          an item has been received and inspected.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          {
            label: 'Needs review',
            value: String(counts.needsReview),
            tone: 'text-amber-700',
          },
          {
            label: 'Needs QC',
            value: String(counts.needsQc),
            tone: 'text-purple-700',
          },
          {
            label: 'Needs pickup',
            value: String(counts.needsPickup),
            tone: 'text-blue-700',
          },
          {
            label: 'Refunds due',
            value: formatPrice(String(counts.refundDue), 'INR'),
            tone: 'text-emerald-700',
          },
          {
            label: 'Blocked',
            value: String(counts.blocked),
            tone: 'text-rose-700',
          },
          {
            label: 'High risk',
            value: String(counts.highRisk),
            tone: 'text-rose-700',
          },
        ].map(card => (
          <div
            key={card.label}
            className="rounded-xl border border-[#2B2620]/10 bg-white p-4"
          >
            <dt className="text-xs uppercase tracking-wide text-[#2B2620]/50">
              {card.label}
            </dt>
            <dd className={`mt-1 text-xl font-semibold ${card.tone}`}>
              {card.value}
            </dd>
          </div>
        ))}
      </dl>

      {requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#2B2620]/20 bg-white px-6 py-16 text-center">
          <p className="text-[#2B2620]/60">Nothing in the queue.</p>
          <Link
            href="/admin/ledger"
            className="mt-4 inline-block text-sm underline underline-offset-4"
          >
            Back to the order ledger
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#2B2620]/10 bg-white">
          <table className="w-full min-w-5xl text-left text-sm">
            <thead>
              <tr className="border-b border-[#2B2620]/10 text-xs uppercase tracking-wide text-[#2B2620]/50">
                <th className="px-4 py-3 font-medium">Request</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Money</th>
                <th className="px-4 py-3 font-medium">Risk &amp; evidence</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(request => (
                <ReturnRow key={request.id} request={request} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
