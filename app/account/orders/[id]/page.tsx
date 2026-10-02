import { requireAccountPage } from '@/utils/account-session';
import {
  ensureCustomerForUserId,
  getOrderDetail,
  checkOrderAvailability,
} from '@/utils/account';
import { formatPrice } from '@/utils/product-format';
import { formatDistanceToNow } from 'date-fns';
import { enIN } from 'date-fns/locale';

import CopyableOrderNumber from '@/components/account/copyable-order-number';
import ReturnRequestForm from '@/components/account/return-request-form';
import { listExchangeVariants } from '@/utils/returns-db';
import Link from 'next/link';
import { retryCheckout } from './actions';

export const metadata = {
  title: 'Order Details',
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

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAccountPage();
  const customer = await ensureCustomerForUserId(user.id);
  const order = await getOrderDetail(id, customer.id);

  if (!order) {
    return (
      <section className="rounded-2xl border border-dashed border-[#2B2620]/20 bg-white px-6 py-16 text-center">
        <h2 className="font-serif text-xl">Order not found</h2>
        <Link
          href="/account/orders"
          className="mt-6 inline-block rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
        >
          Back to Orders
        </Link>
      </section>
    );
  }

  const isPending = order.status === 'PENDING';
  const isStockAvailable =
    isPending && (await checkOrderAvailability(id)).every(a => a.inStock);

  /**
   * Decide up front whether the return form can appear at all.
   *
   * This is UX ONLY. `createReturnRequest` re-runs the full check server-side,
   * so hiding the button here is a courtesy, never the enforcement.
   */
  let returnDisabledReason: string | null = null;
  if (order.status !== 'DELIVERED') {
    returnDisabledReason =
      order.status === 'SHIPPED' || order.status === 'PROCESSING'
        ? 'This order is still on its way. You can return it once it has been delivered.'
        : 'Only delivered orders can be returned or exchanged.';
  } else if (!order.deliveredAt) {
    returnDisabledReason =
      'We could not verify the delivery date for this order yet. Please contact us and we will arrange your return.';
  }

  // Sibling variants power the exchange size picker. Only worth loading when
  // the order can actually be returned.
  const exchangeVariantsByItem = new Map<
    string,
    Awaited<ReturnType<typeof listExchangeVariants>>
  >();
  if (!returnDisabledReason) {
    await Promise.all(
      order.items.map(async item => {
        exchangeVariantsByItem.set(
          item.orderItemId,
          await listExchangeVariants(item.variantId)
        );
      })
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="font-roboto min-w-0 truncate text-sm font-medium tracking-wide">
          <CopyableOrderNumber orderNumber={order.orderNumber} />
        </h2>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[order.status] ?? 'bg-neutral-200 text-neutral-600'}`}
        >
          {order.status}
        </span>
      </div>

      {isPending && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm">
          {isStockAvailable ? (
            <div className="flex flex-col gap-3">
              <p className="text-amber-800">
                Payment for this order wasn&rsquo;t completed, but your items
                are still available. Want to try again?
              </p>
              <form action={retryCheckout} className="flex justify-end">
                <input type="hidden" name="orderId" value={order.id} />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
                >
                  Retry Checkout
                </button>
              </form>
            </div>
          ) : (
            <p className="text-amber-800">
              Payment for this order wasn&rsquo;t completed. Unfortunately, not
              all items are available anymore — stock ran out while your payment
              was pending. Please browse the store for alternatives.
            </p>
          )}
        </div>
      )}

      <article className="overflow-hidden rounded-2xl border border-[#2B2620]/10 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F3EFE6] px-6 py-4">
          <div>
            <p className="font-roboto text-sm font-medium tracking-wide">
              Placed{' '}
              {formatDistanceToNow(new Date(order.createdAt), {
                addSuffix: true,
                locale: enIN,
              })}
            </p>
          </div>
        </div>

        <div className="divide-y divide-[#2B2620]/10">
          {order.items.map((item, idx) => (
            <div
              key={`${order.id}-${item.variantId}-${idx}`}
              className="px-6 py-4"
            >
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-xs text-[#2B2620]/50">
                        Qty {item.quantity} · {item.color} · {item.size}
                      </p>
                    </div>
                    <p className="shrink-0 font-medium">
                      {formatPrice(item.totalPrice, order.currency)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Return/exchange is per order LINE, not per order — a customer
                  may keep one item and return another. */}
              <div className="mt-3">
                {item.returnedQty >= item.quantity ? (
                  <p className="text-xs text-[#2B2620]/50">
                    This item has already been returned in full.
                  </p>
                ) : (
                  <ReturnRequestForm
                    orderId={order.id}
                    orderItemId={item.orderItemId}
                    productName={item.productName}
                    size={item.size}
                    color={item.color}
                    unitPrice={item.unitPrice}
                    currency={order.currency}
                    maxQty={item.quantity - item.returnedQty}
                    exchangeVariants={
                      exchangeVariantsByItem.get(item.orderItemId) ?? []
                    }
                    disabledReason={returnDisabledReason}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1 border-t border-[#2B2620]/10 px-6 py-4 text-sm">
          <div className="flex justify-between text-[#2B2620]/60">
            <span>Subtotal</span>
            <span>{formatPrice(order.subtotal, order.currency)}</span>
          </div>
          {Number(order.discountAmount) > 0 && (
            <div className="flex justify-between text-[#5C6B4B]">
              <span>Discount</span>
              <span>-{formatPrice(order.discountAmount, order.currency)}</span>
            </div>
          )}
          {Number(order.shippingAmount) > 0 && (
            <div className="flex justify-between text-[#2B2620]/60">
              <span>Shipping</span>
              <span>{formatPrice(order.shippingAmount, order.currency)}</span>
            </div>
          )}
          {Number(order.taxAmount) > 0 && (
            <div className="flex justify-between text-[#2B2620]/60">
              <span>Tax</span>
              <span>{formatPrice(order.taxAmount, order.currency)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1 font-medium">
            <span>Total</span>
            <span>{formatPrice(order.totalAmount, order.currency)}</span>
          </div>
        </div>
      </article>

      {order.shippingAddress && (
        <article className="overflow-hidden rounded-2xl border border-[#2B2620]/10 bg-white">
          <div className="border-b border-[#2B2620]/10 px-6 py-3">
            <h3 className="font-medium text-sm">Delivering to</h3>
          </div>
          <div className="px-6 py-4 text-sm">
            <p className="text-[#2B2620]/60 mb-2">
              <span className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/40">
                Address
              </span>
            </p>
            <p className="font-medium">{order.shippingAddress.fullName}</p>
            <p>{order.shippingAddress.addressLine1}</p>
            {order.shippingAddress.addressLine2 && (
              <p>{order.shippingAddress.addressLine2}</p>
            )}
            <p>
              {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
              {order.shippingAddress.postalCode}
            </p>
          </div>
        </article>
      )}

      <Link
        href="/account/orders"
        className="inline-block rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
      >
        Back to Orders
      </Link>
    </section>
  );
}
