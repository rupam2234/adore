'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useCart } from '@/components/cart/cart-provider';
import { formatPrice } from '@/utils/product-format';
import {
  computeCheckoutTotals,
  FREE_SHIPPING_THRESHOLD,
  SHIPPING_FLAT,
} from '@/utils/checkout-format';
import { PIN_STORAGE_KEY } from '@/components/shop/pin-checker';

/** Saved account address handed down from the server page. */
export type CheckoutAddressOption = {
  id: string;
  fullName: string | null;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  addressType: string | null;
  isDefault: boolean;
};

export type CheckoutMember = { name: string; email: string };

type CheckoutSessionResponse = {
  orderNumber: string;
  amount: number;
  currency: string;
  razorpayKeyId: string;
  razorpayOrderId: string;
  prefill: { name: string; email: string; contact: string };
};

type RazorpayHandlerResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const EMPTY_FORM = {
  fullName: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
};

type AddressForm = typeof EMPTY_FORM;
type FieldErrors = Partial<Record<keyof AddressForm | 'email', string>>;

type PinState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; eta: string | null; cod: boolean | null }
  | { kind: 'bad'; message: string };

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

/** Inject Checkout.js once, resolve when `window.Razorpay` is ready. */
function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof window === 'undefined') return resolve(false);
    if (window.Razorpay) return resolve(true);
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SCRIPT}"]`
    );
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(Boolean(window.Razorpay)));
    script.addEventListener('error', () => resolve(false));
    if (!existing) {
      script.src = RAZORPAY_SCRIPT;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

/** Mirrors utils/checkout.ts validation so users get instant feedback. */
function validateForm(form: AddressForm): FieldErrors {
  const errors: FieldErrors = {};
  if (form.fullName.trim().length < 2)
    errors.fullName = "Enter the recipient's full name.";
  if (!/^[\d\s+-]{10,15}$/.test(form.phone.trim()))
    errors.phone = 'Enter a valid 10-digit phone number.';
  if (!form.addressLine1.trim())
    errors.addressLine1 = 'Address line 1 is required.';
  if (!form.city.trim()) errors.city = 'City is required.';
  if (!form.state.trim()) errors.state = 'State is required.';
  if (!/^\d{6}$/.test(form.postalCode.trim()))
    errors.postalCode = 'Enter a valid 6-digit PIN code.';
  return errors;
}

function etaLine(pin: PinState): string | null {
  if (pin.kind !== 'ok') return null;
  const parts: string[] = [`Delivery to this PIN is available`];
  if (pin.eta) parts.push(pin.eta);
  parts.push(pin.cod ? 'Cash on Delivery available' : 'Prepaid only');
  return parts.join(' · ');
}
export default function CheckoutForm({
  member,
  addresses,
}: {
  member: CheckoutMember | null;
  addresses: CheckoutAddressOption[];
}) {
  const { cart, loading } = useCart();
  const [form, setForm] = useState<AddressForm>(EMPTY_FORM);
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState<PinState>({ kind: 'idle' });
  // Members: which saved address to ship to ("new" = enter one now).
  const [addressChoice, setAddressChoice] = useState<string>(
    addresses[0]?.id ?? 'new'
  );
  const [saveAddress, setSaveAddress] = useState(false);
  // The PIN was verified in the bag — lock it here (no re-entry) until the
  // customer taps "Change".
  const [pinLocked, setPinLocked] = useState(false);

  const usingSaved = Boolean(member) && addressChoice !== 'new';
  const saved = addresses.find(a => a.id === addressChoice) ?? null;

  const currency = cart.currency ?? 'INR';
  const totals = useMemo(
    () =>
      computeCheckoutTotals(
        Number(cart.subtotal || 0),
        Number(cart.discount || 0)
      ),
    [cart.subtotal, cart.discount]
  );
  const freeShippingGap = FREE_SHIPPING_THRESHOLD - Number(cart.subtotal || 0);
  const update = (key: keyof AddressForm, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
    if (fieldErrors[key]) setFieldErrors(e => ({ ...e, [key]: undefined }));
  };

  /** Shiprocket serviceability look-up (same PIN cache the PinChecker uses). */
  /** Shiprocket serviceability look-up (same cache the PinChecker uses). */
  const checkPin = async (rawPin: string): Promise<PinState> => {
    const value = rawPin.trim();
    if (!/^\d{6}$/.test(value)) {
      setPin({ kind: 'idle' });
      return { kind: 'idle' };
    }
    setPin({ kind: 'checking' });
    try {
      const res = await fetch(`/api/shipping/pin?pin=${value}`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const bad: PinState = {
          kind: 'bad',
          message: data?.error ?? "Couldn't verify this PIN right now.",
        };
        setPin(bad);
        return bad;
      }
      if (!data.serviceable) {
        const bad: PinState = {
          kind: 'bad',
          message: `We don't deliver to ${value} yet. We're expanding to new PIN codes soon.`,
        };
        setPin(bad);
        return bad;
      }
      const etaDay = data.estimatedDelivery
        ? formatDateOnly(data.estimatedDelivery)
        : null;
      const eta = etaDay
        ? `by ${etaDay}`
        : data.etaDays
          ? `in ${data.etaDays} days`
          : null;
      const ok: PinState = { kind: 'ok', eta, cod: data.cod ?? null };
      setPin(ok);
      return ok;
    } catch {
      const bad: PinState = {
        kind: 'bad',
        message: "Couldn't verify this PIN right now.",
      };
      setPin(bad);
      return bad;
    }
  };

  // Reuse the PIN verified on the bag so checkout never asks for it again.
  // Runs once on mount; the setStates here are the whole point of the effect.
  useEffect(() => {
    const saved = localStorage.getItem(PIN_STORAGE_KEY);
    if (!saved || !/^\d{6}$/.test(saved)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(f => (f.postalCode ? f : { ...f, postalCode: saved }));
    setPinLocked(true);
    void checkPin(saved);
  }, []);

  /** Razorpay Checkout success → verify server-side, then show the receipt. */
  const confirmPayment = async (response: RazorpayHandlerResponse) => {
    try {
      const res = await fetch('/api/checkout/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data?.error ??
            "We couldn't confirm that payment. Please contact support."
        );
        setBusy(false);
        return;
      }
      // The verify route set the order cookie; hard-nav so the server-rendered
      // receipt loads fresh (no stale client cache).
      window.location.href = '/checkout/success';
    } catch {
      setError(
        "We couldn't confirm that payment. Please contact support before paying again."
      );
      setBusy(false);
    }
  };

  const pay = async () => {
    setError(null);
    setNotice(null);

    if (!usingSaved) {
      const errors = validateForm(form);
      const trimmedEmail = email.trim();
      if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        errors.email = "That email address doesn't look right.";
      }
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;
      if (pin.kind === 'bad') {
        setError(pin.message);
        return;
      }
      // PIN is re-verified server-side before any charge; this is just a hint.
      if (pin.kind !== 'ok') {
        const result = await checkPin(form.postalCode);
        if (result.kind !== 'ok') {
          setError(
            result.kind === 'bad'
              ? result.message
              : 'Please verify your delivery PIN before continuing.'
          );
          return;
        }
      }
    }
    setBusy(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          usingSaved
            ? { addressId: addressChoice }
            : {
                address: form,
                email: email.trim() || undefined,
                saveAddress: Boolean(member) && saveAddress,
              }
        ),
      });
      const session = (await res
        .json()
        .catch(() => ({}))) as Partial<CheckoutSessionResponse> & {
        error?: string;
      };
      if (!res.ok || !session.razorpayOrderId || !session.razorpayKeyId) {
        setError(
          session.error ?? 'Could not start checkout. Please try again.'
        );
        setBusy(false);
        return;
      }

      const ready = await loadRazorpayScript();
      if (!ready || !window.Razorpay) {
        setError(
          'Could not load the payment window. Please check your connection and try again.'
        );
        setBusy(false);
        return;
      }

      const checkout = new window.Razorpay({
        key: session.razorpayKeyId,
        amount: session.amount,
        currency: session.currency,
        name: 'Adore',
        description: `Order ${session.orderNumber}`,
        order_id: session.razorpayOrderId,
        prefill: session.prefill,
        theme: { color: '#2B2620' },
        modal: {
          ondismiss: () => {
            setBusy(false);
            setNotice(
              "Payment cancelled — your bag is saved. Try again whenever you're ready."
            );
          },
        },
        handler: (response: RazorpayHandlerResponse) => {
          void confirmPayment(response);
        },
      });

      checkout.on('payment.failed', (payload: unknown) => {
        const description = (payload as { error?: { description?: string } })
          ?.error?.description;
        setError(
          description ?? "That payment didn't go through. Please try again."
        );
        setBusy(false);
      });

      checkout.open();
    } catch {
      setError('Something went wrong. Please try again.');
      setBusy(false);
    }
  };
  if (!loading && cart.items.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-[#2B2620]/20 bg-white px-6 py-16 text-center">
        <h2 className="font-serif text-xl">Your bag is empty</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-[#2B2620]/60">
          Add a piece to your bag and checkout will be waiting here for you.
        </p>
        <Link
          href="/shop"
          className="mt-6 inline-block rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
        >
          Shop the collection
        </Link>
      </section>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_20rem] lg:items-start">
      <form
        onSubmit={e => {
          e.preventDefault();
          void pay();
        }}
        noValidate
        className="min-w-0 space-y-6"
      >
        <section className="rounded-2xl border border-[#2B2620]/10 bg-white p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-xl">Delivery details</h2>
            {member ? (
              <Link
                href="/account/addresses"
                className="text-xs text-[#2B2620]/50 underline-offset-4 hover:text-[#2B2620] hover:underline"
              >
                Manage addresses
              </Link>
            ) : (
              <Link
                href="/login?next=%2Fcheckout"
                className="text-xs text-[#2B2620]/50 underline-offset-4 hover:text-[#2B2620] hover:underline"
              >
                Log in for saved addresses
              </Link>
            )}
          </div>

          {member && addresses.length > 0 && (
            <ul className="mt-5 space-y-3">
              {addresses.map(option => (
                <li key={option.id}>
                  <label
                    className={`flex cursor-pointer gap-3 rounded-xl border p-4 text-sm transition-colors ${
                      addressChoice === option.id
                        ? 'border-[#2B2620] bg-[#F3EFE6]'
                        : 'border-[#2B2620]/15 hover:border-[#2B2620]/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="addressChoice"
                      value={option.id}
                      checked={addressChoice === option.id}
                      onChange={() => setAddressChoice(option.id)}
                      className="mt-1 accent-[#2B2620]"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-medium">
                          {option.fullName || member.name}
                        </span>
                        {option.isDefault && (
                          <span className="rounded-full bg-[#E7DFCB] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#2B2620]/70">
                            Default
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-[#2B2620]/60">
                        {option.addressLine1}
                        {option.addressLine2
                          ? `, ${option.addressLine2}`
                          : ''}, {option.city}, {option.state}{' '}
                        {option.postalCode}
                      </span>
                      {option.phone && (
                        <span className="mt-0.5 block text-xs text-[#2B2620]/50">
                          {option.phone}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
              <li>
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-sm transition-colors ${
                    addressChoice === 'new'
                      ? 'border-[#2B2620] bg-[#F3EFE6]'
                      : 'border-[#2B2620]/15 hover:border-[#2B2620]/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="addressChoice"
                    value="new"
                    checked={addressChoice === 'new'}
                    onChange={() => setAddressChoice('new')}
                    className="accent-[#2B2620]"
                  />
                  <span>Deliver to a new address</span>
                </label>
              </li>
            </ul>
          )}
          {member && addresses.length === 0 && (
            <p className="mt-4 rounded-lg bg-[#E7DFCB]/50 px-3 py-2.5 text-xs text-[#2B2620]/60">
              No saved addresses yet — enter one below and we&apos;ll keep it on
              your account.
            </p>
          )}

          {!member && (
            <p className="mt-4 rounded-lg bg-[#E7DFCB]/50 px-3 py-2.5 text-xs text-[#2B2620]/60">
              Checking out as a guest? No account needed. Add an email below for
              delivery updates, or{' '}
              <Link
                href="/login?next=%2Fcheckout"
                className="font-medium underline underline-offset-2"
              >
                log in
              </Link>{' '}
              to use your saved addresses.
            </p>
          )}

          {usingSaved && saved ? (
            <div className="mt-5 rounded-xl border border-[#2B2620]/10 bg-[#FAF8F3] p-4 text-sm">
              <p className="font-medium">
                {saved.fullName || member?.name || 'Recipient'}
              </p>
              <p className="mt-1 text-[#2B2620]/60">
                {saved.addressLine1}
                {saved.addressLine2 ? `, ${saved.addressLine2}` : ''},{' '}
                {saved.city}, {saved.state} {saved.postalCode},{' '}
                {saved.country || 'India'}
              </p>
              {saved.phone && (
                <p className="mt-1 text-xs text-[#2B2620]/50">{saved.phone}</p>
              )}
            </div>
          ) : (
            <>
              <AddressFields
                form={form}
                errors={fieldErrors}
                onChange={update}
                pinLocked={pinLocked}
                onUnlockPin={() => setPinLocked(false)}
                onPinBlur={value => void checkPin(value)}
                pinNote={
                  pin.kind === 'checking' ? (
                    <span className="text-[#2B2620]/50">
                      Checking delivery to {form.postalCode}…
                    </span>
                  ) : pin.kind === 'ok' ? (
                    <span className="text-[#5C6B4B]">✓ {etaLine(pin)}</span>
                  ) : pin.kind === 'bad' ? (
                    <span className="text-[#A45A4B]">{pin.message}</span>
                  ) : null
                }
              />

              {!member && (
                <div className="mt-4">
                  <label htmlFor="checkout-email" className={LABEL_CLASS}>
                    Email (optional — for delivery updates)
                  </label>
                  <input
                    id="checkout-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    aria-invalid={!!fieldErrors.email}
                    className={inputClass(fieldErrors.email)}
                  />
                  {fieldErrors.email && (
                    <p className="mt-1.5 text-xs text-[#A45A4B]">
                      {fieldErrors.email}
                    </p>
                  )}
                </div>
              )}

              {member && (
                <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-[#2B2620]/70">
                  <input
                    type="checkbox"
                    checked={saveAddress}
                    onChange={e => setSaveAddress(e.target.checked)}
                    className="accent-[#2B2620]"
                  />
                  Save this address to my account
                </label>
              )}
            </>
          )}

          {member && (
            <p className="mt-4 text-xs text-[#2B2620]/50">
              Delivery updates for this order go to {member.email}.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-[#A45A4B]/30 bg-[#A45A4B]/10 px-4 py-3 text-sm text-[#A45A4B]"
            >
              {error}
            </p>
          )}
          {notice && !error && (
            <p className="mt-5 rounded-lg border border-[#2B2620]/15 bg-[#F3EFE6] px-4 py-3 text-sm text-[#2B2620]/70">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || loading}
            className="mt-6 w-full cursor-pointer rounded-full bg-[#2B2620] px-6 py-3 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? 'Opening secure payment…'
              : `Pay ${formatPrice(String(totals.total), currency)}`}
          </button>
          <p className="mt-3 text-center text-xs text-[#2B2620]/50">
            Payments are processed securely by Razorpay. Your PIN is verified
            before the charge.
          </p>
        </section>
      </form>

      <aside className="rounded-2xl border border-[#2B2620]/10 bg-white p-6 lg:sticky lg:top-28">
        <h2 className="font-serif text-xl">Order summary</h2>

        <ul className="mt-5 space-y-4">
          {cart.items.map(item => (
            <li key={item.id} className="flex gap-3 text-sm">
              {item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt=""
                  className="h-16 w-12 shrink-0 rounded-lg object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.name}</p>
                <p className="mt-0.5 text-xs text-[#2B2620]/50">
                  {item.color} · {item.size} · Qty {item.quantity}
                </p>
              </div>
              <p className="whitespace-nowrap">
                {formatPrice(
                  String(Number(item.unitPrice) * item.quantity),
                  currency
                )}
              </p>
            </li>
          ))}
        </ul>

        <dl className="mt-6 space-y-2 border-t border-[#2B2620]/10 pt-5 text-sm">
          <div className="flex justify-between">
            <dt className="text-[#2B2620]/60">Subtotal</dt>
            <dd>{formatPrice(cart.subtotal, currency)}</dd>
          </div>
          {Number(cart.discount) > 0 && (
            <div className="flex justify-between text-[#5C6B4B]">
              <dt>Promo{cart.promo ? ` (${cart.promo.code})` : ''}</dt>
              <dd>−{formatPrice(cart.discount, currency)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-[#2B2620]/60">Shipping</dt>
            <dd>
              {totals.shipping === 0
                ? 'Free'
                : formatPrice(String(totals.shipping), currency)}
            </dd>
          </div>
        </dl>

        {freeShippingGap > 0 && (
          <p className="mt-3 text-xs text-[#5C6B4B]">
            Add {formatPrice(String(freeShippingGap), currency)} more for free
            shipping (orders over{' '}
            {formatPrice(String(FREE_SHIPPING_THRESHOLD), currency)}, otherwise{' '}
            {formatPrice(String(SHIPPING_FLAT), currency)}).
          </p>
        )}

        <div className="mt-5 flex justify-between border-t border-[#2B2620]/10 pt-5">
          <span className="font-medium">Total</span>
          <span className="font-serif text-xl">
            {formatPrice(String(totals.total), currency)}
          </span>
        </div>

        {pin.kind === 'ok' && (
          <p className="mt-4 rounded-lg bg-[#E7DFCB]/60 px-3 py-2 text-xs text-[#2B2620]/70">
            {etaLine(pin)}
          </p>
        )}
      </aside>
    </div>
  );
}

/** Shared field primitives (matches the login/account form styling). */
const LABEL_CLASS =
  'mb-1.5 block text-xs uppercase tracking-[0.15em] text-[#2B2620]/60';

function inputClass(invalid?: string | boolean) {
  return `w-full rounded-lg border bg-white px-4 py-3 text-sm transition-colors placeholder:text-[#2B2620]/30 focus:outline-none ${
    invalid
      ? 'border-[#A45A4B] focus:border-[#A45A4B]'
      : 'border-[#2B2620]/20 focus:border-[#2B2620]'
  }`;
}

/** "2026-09-24" → "Wed, 24 Sep" (null when unparseable). */
function formatDateOnly(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Indian states + UTs — a datalist, so any typed value still works. */
const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];
/**
 * Address inputs shared by guests and by members entering a new address. The
 * PIN field asks Shiprocket for serviceability on blur, so the delivery point
 * is verified before the payment window ever opens.
 */
function AddressFields({
  form,
  errors,
  onChange,
  onPinBlur,
  pinNote,
  pinLocked,
  onUnlockPin,
}: {
  form: AddressForm;
  errors: FieldErrors;
  onChange: (key: keyof AddressForm, value: string) => void;
  onPinBlur: (value: string) => void;
  pinNote: React.ReactNode;
  /** PIN came from the bag (already verified) — show it read-only. */
  pinLocked: boolean;
  onUnlockPin: () => void;
}) {
  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="co-name" className={LABEL_CLASS}>
          Full name
        </label>
        <input
          id="co-name"
          name="name"
          autoComplete="name"
          value={form.fullName}
          onChange={e => onChange('fullName', e.target.value)}
          placeholder="As it should appear on the parcel"
          aria-invalid={!!errors.fullName}
          className={inputClass(errors.fullName)}
        />
        {errors.fullName && (
          <p className="mt-1.5 text-xs text-[#A45A4B]">{errors.fullName}</p>
        )}
      </div>

      <div>
        <label htmlFor="co-phone" className={LABEL_CLASS}>
          Phone
        </label>
        <input
          id="co-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={e => onChange('phone', e.target.value)}
          placeholder="98765 43210"
          aria-invalid={!!errors.phone}
          className={inputClass(errors.phone)}
        />
        {errors.phone && (
          <p className="mt-1.5 text-xs text-[#A45A4B]">{errors.phone}</p>
        )}
      </div>

      <div>
        <label htmlFor="co-pin" className={LABEL_CLASS}>
          PIN code
        </label>
        {pinLocked ? (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border border-[#5C6B4B]/40 bg-[#F3EFE6] px-3 py-2 text-sm"
            data-testid="locked-pin"
          >
            <span>
              <span className="text-[#5C6B4B]">✓</span> Delivering to{' '}
              <span className="font-medium tracking-widest">
                {form.postalCode}
              </span>{' '}
              <span className="text-[#2B2620]/50">(verified in your bag)</span>
            </span>
            <button
              type="button"
              onClick={onUnlockPin}
              className="shrink-0 cursor-pointer text-xs underline underline-offset-2 transition-colors hover:text-[#2B2620]"
            >
              Change
            </button>
          </div>
        ) : (
          <input
            id="co-pin"
            name="postalCode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            value={form.postalCode}
            onChange={e =>
              onChange('postalCode', e.target.value.replace(/\D/g, ''))
            }
            onBlur={e => onPinBlur(e.target.value)}
            placeholder="560001"
            aria-invalid={!!errors.postalCode}
            className={inputClass(errors.postalCode)}
          />
        )}
        {errors.postalCode ? (
          <p className="mt-1.5 text-xs text-[#A45A4B]">{errors.postalCode}</p>
        ) : (
          pinNote && <p className="mt-1.5 text-xs">{pinNote}</p>
        )}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="co-line1" className={LABEL_CLASS}>
          Address line 1
        </label>
        <input
          id="co-line1"
          name="addressLine1"
          autoComplete="address-line1"
          value={form.addressLine1}
          onChange={e => onChange('addressLine1', e.target.value)}
          placeholder="House / flat, building, street"
          aria-invalid={!!errors.addressLine1}
          className={inputClass(errors.addressLine1)}
        />
        {errors.addressLine1 && (
          <p className="mt-1.5 text-xs text-[#A45A4B]">{errors.addressLine1}</p>
        )}
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="co-line2" className={LABEL_CLASS}>
          Address line 2 (optional)
        </label>
        <input
          id="co-line2"
          name="addressLine2"
          autoComplete="address-line2"
          value={form.addressLine2}
          onChange={e => onChange('addressLine2', e.target.value)}
          placeholder="Area, landmark, apartment"
          className={inputClass()}
        />
      </div>

      <div>
        <label htmlFor="co-city" className={LABEL_CLASS}>
          City
        </label>
        <input
          id="co-city"
          name="city"
          autoComplete="address-level2"
          value={form.city}
          onChange={e => onChange('city', e.target.value)}
          aria-invalid={!!errors.city}
          className={inputClass(errors.city)}
        />
        {errors.city && (
          <p className="mt-1.5 text-xs text-[#A45A4B]">{errors.city}</p>
        )}
      </div>

      <div>
        <label htmlFor="co-state" className={LABEL_CLASS}>
          State
        </label>
        <input
          id="co-state"
          name="state"
          list="co-states"
          autoComplete="address-level1"
          value={form.state}
          onChange={e => onChange('state', e.target.value)}
          aria-invalid={!!errors.state}
          className={inputClass(errors.state)}
        />
        <datalist id="co-states">
          {INDIAN_STATES.map(state => (
            <option key={state} value={state} />
          ))}
        </datalist>
        {errors.state && (
          <p className="mt-1.5 text-xs text-[#A45A4B]">{errors.state}</p>
        )}
      </div>
    </div>
  );
}
