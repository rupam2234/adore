import { requireAccountPage } from '@/utils/account-session';
import { ensureCustomerForUserId, listOrders } from '@/utils/account';
import { formatPrice } from '@/utils/product-format';
import Link from 'next/link';
import CopyableOrderNumber from '@/components/account/copyable-order-number';

export const metadata = {
  title: 'Orders',
  robots: { index: false, follow: false },
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  SHIPPED: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-neutral-200 text-neutral-600',
  REFUNDED: 'bg-neutral-200 text-neutral-600',
};

export default async function AccountOrdersPage() {
  const user = await requireAccountPage();
  const customer = await ensureCustomerForUserId(user.id);
  const orders = await listOrders(customer.id);

  if (orders.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-[#2B2620]/20 bg-white px-6 py-16 text-center">
        <h2 className="font-serif text-xl">No orders yet</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-[#2B2620]/60">
          Your order history and tracking will appear here once you place an
          order.
        </p>
        <a
          href="/shop"
          className="mt-6 inline-block rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
        >
          Start shopping
        </a>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="font-serif text-xl">Orders</h2>
      {orders.map(order => (
        <article
          key={order.id}
          className="overflow-hidden rounded-2xl border border-[#2B2620]/10 bg-white"
        >
          <Link
            href={`/account/orders/${order.id}`}
            className="flex flex-wrap items-center justify-between gap-3 bg-[#F3EFE6] px-6 py-4 transition-colors hover:bg-[#E8E4DB]"
          >
            <div>
              <p className="font-roboto text-sm font-medium tracking-wide">
              <CopyableOrderNumber orderNumber={order.orderNumber} />
              </p>
              <p className="text-xs text-[#2B2620]/50">
                Placed{' '}
                {new Date(order.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[order.status] ?? 'bg-neutral-200 text-neutral-600'}`}
            >
              {order.status}
            </span>
          </Link>
          <ul className="divide-y divide-[#2B2620]/10 px-6">
            {order.items.map(item => (
              <li
                key={`${order.id}-${item.sku}`}
                className="flex items-center justify-between gap-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate">{item.productName}</p>
                  <p className="text-xs text-[#2B2620]/50">
                    Qty {item.quantity} ·{' '}
                    {formatPrice(item.unitPrice, order.currency)} each
                  </p>
                </div>
                <p className="shrink-0">
                  {formatPrice(item.totalPrice, order.currency)}
                </p>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-[#2B2620]/10 px-6 py-4 text-sm">
            <div className="flex justify-between text-[#2B2620]/60">
              <span>Subtotal</span>
              <span>{formatPrice(order.subtotal, order.currency)}</span>
            </div>
            {Number(order.discountAmount) > 0 && (
              <div className="flex justify-between text-[#5C6B4B]">
                <span>Discount</span>
                <span>
                  −{formatPrice(order.discountAmount, order.currency)}
                </span>
              </div>
            )}
            {Number(order.shippingAmount) > 0 && (
              <div className="flex justify-between text-[#2B2620]/60">
                <span>Shipping</span>
                <span>{formatPrice(order.shippingAmount, order.currency)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 font-medium">
              <span>Total</span>
              <span>{formatPrice(order.totalAmount, order.currency)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#2B2620]/10 px-6 py-4 text-sm">
            <div className="min-w-0 text-[#2B2620]/60">
              <p className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/40">
                Delivering to
              </p>
              {order.shippingAddress ? (
                <p className="truncate">
                  {order.shippingAddress.fullName}, {order.shippingAddress.city}{' '}
                  {order.shippingAddress.postalCode}
                </p>
              ) : (
                <p>Address captured at checkout</p>
              )}
            </div>
            {(order.status === 'SHIPPED' || order.status === 'PROCESSING') && (
              <span className="rounded-full border border-[#2B2620]/20 px-4 py-1.5 text-xs text-[#2B2620]/50">
                Tracking coming soon
              </span>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
