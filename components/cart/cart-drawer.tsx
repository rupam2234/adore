'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatPrice } from '@/utils/product-format';
import { PinChecker, usePinCheck } from '@/components/shop/pin-checker';
import { useAuthUser } from '@/components/auth/use-auth-user';
import { PaymentBadges } from '@/components/checkout/payment-badges';
import { useCart } from './cart-provider';

export function CartDrawer() {
  const { cart, drawerOpen, setDrawerOpen, updateItem, removeItem, clear } =
    useCart();
  const pathname = usePathname();

  // The drawer is mounted app-wide (root layout) and survives route changes,
  // so a link tapped inside it (e.g. "Log in") would otherwise leave the
  // drawer, its overlay and the body scroll lock sitting on top of the next
  // page. Close it whenever the route changes; links also close it on click
  // for instant feedback — this is the safety net.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, setDrawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawerOpen, setDrawerOpen]);

  return (
    <div
      aria-hidden={!drawerOpen}
      inert={!drawerOpen ? true : undefined}
      className={`fixed inset-0 z-60 ${drawerOpen ? '' : 'pointer-events-none'}`}
    >
      <div
        onClick={() => setDrawerOpen(false)}
        className={`absolute inset-0 bg-[#2B2620]/60 transition-opacity duration-300 ${
          drawerOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Shopping bag"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-[#FAF8F3] shadow-2xl transition-transform duration-300 ease-out ${
          drawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#2B2620]/10 px-6 py-5">
          <h2 className="font-serif text-xl">
            Bag{' '}
            <span className="text-sm text-[#2B2620]/50">
              ({cart.itemCount})
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close bag"
            className="cursor-pointer text-2xl leading-none text-[#2B2620]/50 transition-colors hover:text-[#2B2620]"
          >
            ×
          </button>
        </div>

        {cart.items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-sm text-[#2B2620]/60">Your bag is empty.</p>
            <Link
              href="/shop"
              onClick={() => setDrawerOpen(false)}
              className="rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
            >
              Shop the collection
            </Link>
          </div>
        ) : (
          <DrawerBody />
        )}
      </aside>
    </div>
  );
}

function PromoSection() {
  const { cart, applyPromo, removePromo, error, setDrawerOpen } = useCart();
  const { user, loading } = useAuthUser();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && !user) {
    return (
      <div className="mt-4 flex items-center justify-between rounded-lg bg-[#E7DFCB]/50 px-3 py-2.5 text-xs">
        <span className="text-[#2B2620]/60">
          Apply Promo Code (Members Only)
        </span>
        <Link
          href="/login"
          onClick={() => setDrawerOpen(false)}
          className="font-medium underline underline-offset-2 hover:text-[#2B2620]"
        >
          Log in
        </Link>
      </div>
    );
  }

  if (cart.promo) {
    return (
      <div className="mt-4 flex items-center justify-between rounded-lg border border-[#5C6B4B]/40 bg-[#5C6B4B]/10 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-wide text-[#5C6B4B]">
            {cart.promo.code}
          </p>
          {cart.promo.description && (
            <p className="truncate text-xs text-[#2B2620]/50">
              {cart.promo.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => removePromo()}
          aria-label={`Remove promo code ${cart.promo.code}`}
          className="cursor-pointer text-xs text-[#2B2620]/50 underline-offset-2 hover:text-[#A45A4B] hover:underline"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={async e => {
        e.preventDefault();
        if (!code.trim() || busy) return;
        setBusy(true);
        const ok = await applyPromo(code);
        if (ok) setCode('');
        setBusy(false);
      }}
      className="mt-4"
    >
      <div className="flex gap-2">
        <input
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="Promo code"
          aria-label="Promo code"
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-[#2B2620]/20 bg-white px-3 py-2 text-sm uppercase
                   placeholder:normal-case placeholder:text-[#2B2620]/30 focus:border-[#2B2620] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="cursor-pointer rounded-lg border border-[#2B2620] px-4 py-2 text-sm transition-colors
                   hover:bg-[#2B2620] hover:text-[#FAF8F3] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? '…' : 'Apply'}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-[#A45A4B]">{error}</p>}
    </form>
  );
}

function DrawerBody() {
  const { cart, setDrawerOpen, updateItem, removeItem, clear } = useCart();
  // PIN deliverability is verified here, before the customer ever reaches
  // checkout — checkout reuses this verified PIN instead of asking again.
  const pinCheck = usePinCheck();
  const pinVerified =
    pinCheck.status.kind === 'result' && pinCheck.status.result.serviceable;
  const pinChecking = pinCheck.status.kind === 'checking';

  return (
    <>
      <ul className="flex-1 divide-y divide-[#2B2620]/10 overflow-y-auto px-6">
        {cart.items.map(item => (
          <li key={item.id} className="flex gap-4 py-4">
            <Link
              href={`/products/${item.slug}`}
              onClick={() => setDrawerOpen(false)}
              className="h-24 w-20 shrink-0 overflow-hidden bg-[#E7DFCB]"
            >
              {item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="h-full w-full object-cover"
                />
              )}
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/products/${item.slug}`}
                  onClick={() => setDrawerOpen(false)}
                  className="truncate text-sm font-medium underline-offset-4 hover:underline"
                >
                  {item.name}
                </Link>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Remove ${item.name} from bag`}
                  className="cursor-pointer text-xs text-[#2B2620]/40 underline-offset-2 transition-colors hover:text-[#A45A4B] hover:underline"
                >
                  Remove
                </button>
              </div>
              <p className="mt-0.5 text-xs text-[#2B2620]/50">
                {item.color} · {item.size}
              </p>
              <div className="mt-auto flex items-center justify-between pt-2">
                <div className="flex items-center border border-[#2B2620]/20">
                  <button
                    type="button"
                    onClick={() => updateItem(item.id, item.quantity - 1)}
                    aria-label="Decrease quantity"
                    disabled={item.quantity <= 1}
                    className="cursor-pointer px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="min-w-6 text-center text-sm">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateItem(item.id, item.quantity + 1)}
                    aria-label="Increase quantity"
                    disabled={item.quantity >= item.stock}
                    title={
                      item.quantity >= item.stock
                        ? 'Only this many in stock'
                        : undefined
                    }
                    className="cursor-pointer px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                <p className="text-sm">
                  {formatPrice(item.lineTotal, item.currency)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-[#2B2620]/10 px-6 py-5">
        <PinChecker pinCheck={pinCheck} />
        <PromoSection />
        <div className="mt-4 space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span>Subtotal</span>
            <span className="font-medium">
              {formatPrice(cart.subtotal, cart.currency!)}
            </span>
          </div>
          {cart.promo && (
            <div className="flex items-center justify-between text-[#5C6B4B]">
              <span>Discount ({cart.promo.code})</span>
              <span className="font-medium">
                −{formatPrice(cart.discount, cart.currency!)}
              </span>
            </div>
          )}
          {Number(cart.shipping) > 0 && (
            <div className="flex items-center justify-between">
              <span>Shipping</span>
              <span className="font-medium">
                {formatPrice(cart.shipping, cart.currency!)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-[#2B2620]/10 pt-2 text-base font-medium">
            <span>Total</span>
            <span>{formatPrice(cart.total, cart.currency!)}</span>
          </div>
        </div>
        <p className="mt-1 text-xs text-[#2B2620]/50">
          Delivery calculated at checkout.
        </p>
        {pinVerified ? (
          <Link
            href="/checkout"
            onClick={() => setDrawerOpen(false)}
            className="mt-4 block w-full cursor-pointer rounded-full bg-[#2B2620] px-6 py-3 text-center text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
          >
            <span className="flex items-center justify-center gap-3">
              Checkout
              <PaymentBadges />
            </span>
          </Link>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void pinCheck.check()}
              disabled={pinChecking || pinCheck.pin.length !== 6}
              aria-disabled="true"
              title="Verify your delivery PIN first"
              className="mt-4 block w-full cursor-pointer rounded-full bg-[#2B2620] px-6 py-3 text-center text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center justify-center gap-3">
                Checkout
                <PaymentBadges />
              </span>
            </button>
            <p className="mt-1.5 text-center text-xs text-[#2B2620]/50">
              {pinChecking
                ? 'Checking delivery…'
                : 'Check your delivery PIN above to continue.'}
            </p>
          </>
        )}
        <button
          type="button"
          onClick={clear}
          className="mt-3 w-full cursor-pointer text-xs text-[#2B2620]/50 underline-offset-4 transition-colors hover:text-[#2B2620] hover:underline"
        >
          Clear bag
        </button>
      </div>
    </>
  );
}
