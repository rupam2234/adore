import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatPrice } from '@/utils';
import { requireAdminPage } from '@/utils/admin-session';
import { getLedgerOrder } from '@/utils/order-ledger';
import {
  fetchShiprocketDocuments,
  fetchShiprocketOrderStatus,
} from '@/utils/shipping';
import CancelOrderPanel from './cancel-order-panel';

export const metadata = {
  title: 'Order details | Admin',
  robots: { index: false, follow: false },
};

// Live customer + courier data on every visit.
export const dynamic = 'force-dynamic';

function formatIstDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  SHIPPED: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-neutral-200 text-neutral-700',
  CANCELLED: 'bg-neutral-200 text-neutral-600',
  REFUNDED: 'bg-rose-100 text-rose-700',
};

/**
 * Admin order details — the single view an admin lands on from the ledger's
 * ⋯ menu. Read everything first; the destructive action (cancel) lives at the
 * bottom behind a type-to-confirm lock, so the eye travels information →
 * action, never the other way around.
 */
export default async function AdminOrderDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();

  const { id } = await params;
  const order = await getLedgerOrder(id);
  if (!order) notFound();

  // Live courier status + documents when the order was booked. Both best-effort:
  // a Shiprocket outage renders the stored booking id with "status unavailable"
  // and no download links, never a broken page. Documents are generated on the
  // visit rather than at booking time — Shiprocket only has a label/invoice
  // once a courier is assigned, which happens in their dashboard.
  const [courier, documents] = order.shiprocketOrderId
    ? await Promise.all([
        fetchShiprocketOrderStatus(order.shiprocketOrderId),
        fetchShiprocketDocuments(order.shiprocketOrderId),
      ])
    : [null, null];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      {/* Header: back link, order number, status */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/ledger"
          className="text-sm text-[#2B2620]/50 underline-offset-4 hover:text-[#2B2620] hover:underline"
        >
          ← Ledger
        </Link>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[order.status] ?? 'bg-neutral-200 text-neutral-600'}`}
        >
          {order.status}
        </span>
        {order.preparedToday && order.status !== 'CANCELLED' && (
          <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs text-green-700">
            prep today
          </span>
        )}
      </div>
      <h1 className="mt-2 font-sans font-semibold text-2xl tracking-tight">
        {order.orderNumber}
      </h1>
      <p className="mt-1 text-sm text-[#2B2620]/60">
        Placed {formatIstDateTime(order.placedAt)} · prep batch {order.prepDay}
        {!order.inBusinessHours && ' (after-hours → next working day)'}
      </p>

      {/* Shipping / courier status */}
      <section className="mt-8 rounded-2xl border border-[#2B2620]/10 bg-white p-6">
        <h2 className="font-admin font-semibold text-lg">Shipping</h2>
        {order.shiprocketOrderId ? (
          <>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/50">
                Shiprocket booking
              </dt>
              <dd className="mt-1">#{order.shiprocketOrderId}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/50">
                Courier status
              </dt>
              <dd className="mt-1">
                {courier?.shipmentStatus ??
                  courier?.orderStatus ??
                  'Status unavailable'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/50">
                Courier
              </dt>
              <dd className="mt-1">{courier?.courierName ?? 'Not assigned'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/50">
                AWB
              </dt>
              <dd className="mt-1 break-all">{courier?.awb || 'Not assigned'}</dd>
            </div>
          </dl>
          {(documents?.labelUrl || documents?.invoiceUrl) && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-[#2B2620]/10 pt-4">
              {documents.labelUrl && (
                <a
                  href={documents.labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-[#2B2620]/20 px-3 py-1.5 text-sm text-[#2B2620] hover:bg-[#FAF8F3]"
                >
                  Shipping label ↗
                </a>
              )}
              {documents.invoiceUrl && (
                <a
                  href={documents.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-[#2B2620]/20 px-3 py-1.5 text-sm text-[#2B2620] hover:bg-[#FAF8F3]"
                >
                  Invoice ↗
                </a>
              )}
            </div>
          )}
          </>
        ) : (
          <p className="mt-3 text-sm text-[#2B2620]/60">
            Not booked with a courier yet.
            {order.status === 'CANCELLED'
              ? ' Order was cancelled before dispatch.'
              : ''}
          </p>
        )}
      </section>

      {/* Items + totals */}
      <section className="mt-6 rounded-2xl border border-[#2B2620]/10 bg-white p-6">
        <h2 className="font-admin font-semibold text-lg">Items</h2>
        <ul className="mt-4 divide-y divide-[#2B2620]/10 text-sm">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-4 py-3">
              <span>
                <span className="block font-medium">{item.productName}</span>
                <span className="mt-0.5 block text-xs text-[#2B2620]/50">
                  {item.sku} · Qty {item.quantity} ·{' '}
                  {formatPrice(item.unitPrice, order.currency)} each
                </span>
              </span>
              <span className="whitespace-nowrap">
                {formatPrice(item.totalPrice, order.currency)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-5 space-y-2 border-t border-[#2B2620]/10 pt-5 text-sm">
          <div className="flex justify-between">
            <dt className="text-[#2B2620]/60">Subtotal</dt>
            <dd>{formatPrice(order.subtotal, order.currency)}</dd>
          </div>
          {Number(order.discountAmount) > 0 && (
            <div className="flex justify-between text-[#5C6B4B]">
              <dt>Discount</dt>
              <dd>−{formatPrice(order.discountAmount, order.currency)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-[#2B2620]/60">Shipping</dt>
            <dd>
              {Number(order.shippingAmount) === 0
                ? 'Free'
                : formatPrice(order.shippingAmount, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-[#2B2620]/10 pt-3 font-medium">
            <dt>Total</dt>
            <dd className="font-serif text-lg">
              {formatPrice(order.totalAmount, order.currency)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Customer + payment */}
      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-[#2B2620]/10 bg-white p-6">
          <h2 className="font-admin font-semibold text-lg">Customer</h2>
          <p className="mt-3 text-sm font-medium">{order.customer.name}</p>
          <p className="mt-1 text-sm text-[#2B2620]/60">
            {order.customer.email}
          </p>
          {order.customer.phone && (
            <p className="text-sm text-[#2B2620]/60">{order.customer.phone}</p>
          )}
          {order.shippingAddress && (
            <div className="mt-4 border-t border-[#2B2620]/10 pt-4 text-sm text-[#2B2620]/70">
              <p className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/50">
                Delivering to
              </p>
              <p className="mt-2">{order.shippingAddress.addressLine1}</p>
              {order.shippingAddress.addressLine2 && (
                <p>{order.shippingAddress.addressLine2}</p>
              )}
              <p>
                {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
                {order.shippingAddress.postalCode}
              </p>
              <p>{order.shippingAddress.country}</p>
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-[#2B2620]/10 bg-white p-6">
          <h2 className="font-admin font-semibold text-lg">Payment</h2>
          <p className="mt-3 text-sm">
            {order.status === 'REFUNDED'
              ? 'Refunded'
              : order.paymentId
                ? 'Razorpay — paid'
                : order.status === 'PENDING'
                  ? 'Awaiting payment'
                  : 'Payment reference unavailable'}
          </p>
          {order.paymentId && (
            <p className="mt-2 break-all text-xs text-[#2B2620]/50">
              {order.paymentId}
            </p>
          )}
          {order.razorpayOrderId && (
            <p className="mt-1 break-all text-xs text-[#2B2620]/50">
              Order id: {order.razorpayOrderId}
            </p>
          )}
        </div>
      </section>

      {/* Destructive action — last on the page, behind a lock. */}
      <CancelOrderPanel
        orderId={order.id}
        orderNumber={order.orderNumber}
        status={order.status}
        hasCourierBooking={Boolean(order.shiprocketOrderId)}
      />
    </div>
  );
}
