import { formatPrice } from '@/utils';
import {
  currentPrepDayKey,
  groupByPrepDay,
  ledgerSummary,
  listLedgerOrders,
} from '@/utils/order-ledger';
import { requireAdminPage } from '@/utils/admin-session';

export const metadata = {
  title: 'Order ledger — Admin',
  robots: { index: false, follow: false },
};

// Fetch current data on each visit; never statically cache customer details.
export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  SHIPPED: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-neutral-200 text-neutral-700',
  REFUNDED: 'bg-rose-100 text-rose-700',
};

function formatIstDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export default async function AdminLedgerPage() {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      'Admin authentication must be configured to access the ledger.'
    );
  }
  const admin = await requireAdminPage();
  if (admin.role !== 'admin') throw new Error('Admin access required.');

  let days: Awaited<ReturnType<typeof groupByPrepDay>>['days'] = [];
  let stats: Awaited<ReturnType<typeof groupByPrepDay>>['stats'] = {
    totalRevenue: 0,
    totalOrders: 0,
    totalItems: 0,
  };
  let summary = {
    todayRevenue: 0,
    todayOrders: 0,
    pendingShiprocket: 0,
    openOrders: 0,
  };
  let error: string | null = null;

  try {
    const orders = await listLedgerOrders();
    const grouped = groupByPrepDay(orders);
    days = grouped.days;
    stats = grouped.stats;
    summary = ledgerSummary(orders);
  } catch {
    error = 'Could not load the ledger — check the database connection.';
  }

  const todayKey = currentPrepDayKey();

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-admin font-bold text-2xl">Order ledger</h1>
        <p className="text-xs text-[#2B2620]/50">
          Prep day: Mon–Sat, 9 am–5 pm IST · after-hours orders roll to the next
          working day
        </p>
      </div>

      {error && (
        <p className="mt-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Live stats */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Today's prep revenue",
            value: `₹${summary.todayRevenue.toFixed(2)}`,
            sub: `${summary.todayOrders} order${summary.todayOrders === 1 ? '' : 's'} in today's batch`,
          },
          {
            label: 'Revenue — latest paid orders',
            value: `₹${stats.totalRevenue.toFixed(2)}`,
            sub: `${stats.totalOrders} paid order${stats.totalOrders === 1 ? '' : 's'} · ${stats.totalItems} items · refunds excluded`,
          },
          {
            label: 'Open orders',
            value: String(summary.openOrders),
            sub: 'Confirmed / processing',
          },
          {
            label: 'Pending Shiprocket push',
            value: String(summary.pendingShiprocket),
            sub: 'Not yet booked with courier',
          },
        ].map(card => (
          <div
            key={card.label}
            className="rounded-2xl border border-[#2B2620]/10 bg-white p-5"
          >
            <p className="text-[11px] uppercase tracking-[0.15em] text-[#2B2620]/50">
              {card.label}
            </p>
            <p className="mt-2 font-admin font-bold text-2xl">{card.value}</p>
            <p className="mt-1 text-xs text-[#2B2620]/50">{card.sub}</p>
          </div>
        ))}
      </div>

      {days.length === 0 && !error && (
        <p className="mt-10 text-sm text-[#2B2620]/50">
          No paid orders yet — the ledger fills up as orders are confirmed.
        </p>
      )}

      {/* Prep-day batches */}
      {days.map(day => (
        <div key={day.prepDay} className="mt-10">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-admin font-semibold text-lg">{day.label}</h2>
            {day.isToday && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                prep today
              </span>
            )}
            {!day.isToday && (
              <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                {day.prepDay < todayKey ? 'past batch' : 'upcoming batch'}
              </span>
            )}
            <span className="ml-auto text-xs text-[#2B2620]/60">
              {day.orderCount} order{day.orderCount === 1 ? '' : 's'} ·{' '}
              {day.itemCount} item{day.itemCount === 1 ? '' : 's'} · ₹
              {day.revenue.toFixed(2)}
            </span>
          </div>

          <div className="mt-3 overflow-x-auto rounded-2xl border border-[#2B2620]/10 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-[#FAF8F3] text-left text-[11px] uppercase tracking-[0.15em] text-[#2B2620]/50">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Placed (IST)</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Payment / courier</th>
                </tr>
              </thead>
              <tbody>
                {day.orders.map(order => (
                  <tr
                    key={order.id}
                    className="border-t border-[#2B2620]/10 align-top"
                  >
                    <td className="px-4 py-3 font-medium">
                      {order.orderNumber}
                    </td>
                    <td className="px-4 py-3">
                      {formatIstDateTime(order.placedAt)}
                      {!order.inBusinessHours && (
                        <p className="text-xs text-amber-700">
                          after-hours → next day
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p>{order.customer.name}</p>
                      <p className="text-xs text-[#2B2620]/50">
                        {order.customer.email}
                        {order.customer.phone
                          ? ` · ${order.customer.phone}`
                          : ''}
                      </p>
                      {order.shippingAddress && (
                        <p className="mt-1 text-xs text-[#2B2620]/50">
                          {[
                            order.shippingAddress.addressLine1,
                            order.shippingAddress.addressLine2,
                            order.shippingAddress.city,
                            order.shippingAddress.state,
                            order.shippingAddress.postalCode,
                            order.shippingAddress.country,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-0.5 text-xs">
                        {order.items.map((item, i) => (
                          <li key={`${order.id}-${i}`}>
                            {item.quantity}× {item.productName}
                            <span className="text-[#2B2620]/40">
                              {' '}
                              ({item.sku})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3">
                      {formatPrice(order.totalAmount, order.currency)}
                      {Number(order.discountAmount) > 0 && (
                        <p className="text-xs text-[#2B2620]/50">
                          −{formatPrice(order.discountAmount, order.currency)}{' '}
                          promo
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[order.status] ?? 'bg-neutral-200 text-neutral-600'}`}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#2B2620]/60">
                      <p>
                        {order.status === 'REFUNDED'
                          ? 'Refunded'
                          : order.paymentId
                            ? 'Razorpay paid'
                            : 'Payment reference unavailable'}
                      </p>
                      {order.paymentId && (
                        <p className="break-all">{order.paymentId}</p>
                      )}
                      {order.razorpayOrderId && (
                        <p className="break-all">{order.razorpayOrderId}</p>
                      )}
                      <p>
                        {order.shiprocketOrderId
                          ? `Shiprocket #${order.shiprocketOrderId}`
                          : 'not booked yet'}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
