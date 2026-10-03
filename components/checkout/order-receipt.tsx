import Link from 'next/link';
import type { OrderConfirmation } from '@/utils/checkout';
import { formatPrice } from '@/utils/product-format';
import CopyableOrderNumber from '@/components/account/copyable-order-number';

const STATUS_COPY: Record<string, string> = {
  CONFIRMED: 'Payment received · preparing your parcel',
  PROCESSING: 'Payment received · preparing your parcel',
  SHIPPED: 'On its way',
  DELIVERED: 'Delivered',
  PENDING: 'Awaiting payment confirmation',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Post-payment receipt. Rendered from the order snapshot on the server, so it
 * shows exactly what was charged — no client-side money math.
 */
export default function OrderReceipt({
  orderNumber,
  confirmation,
}: {
  orderNumber: string;
  confirmation: OrderConfirmation | null;
}) {
  if (!confirmation) {
    return (
      <section className="rounded-2xl border border-[#2B2620]/10 bg-white p-8 text-center">
        <h1 className="font-roboto text-sm font-medium tracking-wide">
          <CopyableOrderNumber orderNumber={orderNumber} />
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-[#2B2620]/60">
          We have your order, but couldn&apos;t load the receipt just now. Keep
          this order number handy and write to us if anything looks off.
          We&apos;ll sort it out.
        </p>
        <Link
          href="/shop"
          className="mt-6 inline-block rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
        >
          Continue shopping
        </Link>
      </section>
    );
  }

  const address = confirmation.shippingAddress;
  const status =
    STATUS_COPY[confirmation.status] ??
    `Order ${confirmation.status.toLowerCase()}`;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#2B2620]/10 bg-white p-8">
        <p className="text-sm text-[#5C6B4B]">Thank you</p>
        <h1 className="mt-1 font-serif text-3xl">Your order is confirmed</h1>
        <p className="mt-3 text-sm text-[#2B2620]/70">{status}</p>

        <dl className="mt-6 grid gap-4 border-t border-[#2B2620]/10 pt-6 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/50">
              Order number
            </dt>
            <dd className="mt-1 font-medium">{confirmation.orderNumber}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/50">
              Placed on
            </dt>
            <dd className="mt-1">{formatDate(confirmation.placedAt)}</dd>
          </div>
          {confirmation.paymentId && (
            <div>
              <dt className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/50">
                Payment id
              </dt>
              <dd className="mt-1 break-all text-[#2B2620]/70">
                {confirmation.paymentId}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs uppercase tracking-[0.15em] text-[#2B2620]/50">
              Shipping
            </dt>
            <dd className="mt-1 text-[#2B2620]/70">
              {confirmation.shiprocketOrderId
                ? `Booked with our courier partner (#${confirmation.shiprocketOrderId})`
                : 'Being booked with our courier partner'}
            </dd>
          </div>
        </dl>

        {confirmation.shiprocketError && (
          <p className="mt-4 rounded-lg bg-[#E7DFCB]/60 px-3 py-2 text-xs text-[#2B2620]/70">
            Your order is safe and paid. Courier booking is retrying on our side.
            No action needed.
          </p>
        )}
      </section>
      <section className="rounded-2xl border border-[#2B2620]/10 bg-white p-8">
        <h2 className="font-serif text-xl">What&apos;s on the way</h2>
        <ul className="mt-5 divide-y divide-[#2B2620]/10">
          {confirmation.items.map((item, index) => (
            <li
              key={`${item.sku}-${index}`}
              className="flex justify-between gap-4 py-3 text-sm"
            >
              <span>
                <span className="block font-medium">{item.productName}</span>
                <span className="mt-0.5 block text-xs text-[#2B2620]/50">
                  {item.sku} · Qty {item.quantity}
                </span>
              </span>
              <span className="whitespace-nowrap">
                {formatPrice(item.totalPrice, confirmation.currency)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-5 space-y-2 border-t border-[#2B2620]/10 pt-5 text-sm">
          <div className="flex justify-between">
            <dt className="text-[#2B2620]/60">Subtotal</dt>
            <dd>{formatPrice(confirmation.subtotal, confirmation.currency)}</dd>
          </div>
          {Number(confirmation.discountAmount) > 0 && (
            <div className="flex justify-between text-[#5C6B4B]">
              <dt>Discount</dt>
              <dd>
                −
                {formatPrice(
                  confirmation.discountAmount,
                  confirmation.currency
                )}
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-[#2B2620]/60">Shipping</dt>
            <dd>
              {Number(confirmation.shippingAmount) === 0
                ? 'Free'
                : formatPrice(
                    confirmation.shippingAmount,
                    confirmation.currency
                  )}
            </dd>
          </div>
          <div className="flex justify-between border-t border-[#2B2620]/10 pt-3 font-medium">
            <dt>Total paid</dt>
            <dd className="font-serif text-lg">
              {formatPrice(confirmation.totalAmount, confirmation.currency)}
            </dd>
          </div>
        </dl>
      </section>

      {address && (
        <section className="rounded-2xl border border-[#2B2620]/10 bg-white p-8">
          <h2 className="font-serif text-xl">Delivering to</h2>
          <p className="mt-3 text-sm font-medium">{address.fullName}</p>
          <p className="mt-1 text-sm text-[#2B2620]/70">
            {address.addressLine1}
            {address.addressLine2 ? `, ${address.addressLine2}` : ''},{' '}
            {address.city}, {address.state} {address.postalCode}
          </p>
          {address.phone && (
            <p className="mt-1 text-xs text-[#2B2620]/50">{address.phone}</p>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          href="/shop"
          className="rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
        >
          Continue shopping
        </Link>
        <Link
          href="/account/orders"
          className="rounded-full border border-[#2B2620]/30 px-6 py-2.5 text-sm transition-colors hover:border-[#2B2620]"
        >
          Track in my account
        </Link>
      </div>
    </div>
  );
}
