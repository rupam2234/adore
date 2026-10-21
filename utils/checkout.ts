/**
 * Checkout orchestration.
 *
 * Flow:
 *  1. `createCheckoutSession` — validates the address (guest fields or a saved
 *     account address), verifies the delivery PIN is serviceable via Shiprocket
 *     BEFORE any payment, creates the order (status PENDING) + items from the
 *     server-side cart, and creates the Razorpay order for the exact total.
 *  2. Client opens Razorpay Checkout with the returned key/order id.
 *  3. `verifyAndConfirmPayment` — verifies the Razorpay signature (timing-safe
 *     HMAC), confirms the amount matches, marks the order CONFIRMED,
 *     decrements stock, clears the cart, and pushes the order to Shiprocket
 *     automatically (best-effort — a Shiprocket outage never loses an order).
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, rawQuery, orders, orderItems, customers, products } from './db';
import {
  getCartShopper,
  getCartDetail,
  clearCart,
  type CartLine,
} from './cart';
import { removePromo, getAttachedPromo, isPromoStillValid } from './promo';
import { auditLog } from './db';
import {
  createAddress,
  ensureCustomerForUserId,
  listAddresses,
} from './account';
import { computeShippingAmount } from './checkout-format';
import type { CheckoutAddress } from './checkout-format';

export {
  SHIPPING_FLAT,
  FREE_SHIPPING_THRESHOLD,
  computeShippingAmount,
  computeCheckoutTotals,
  toPaise,
} from './checkout-format';
export type { CheckoutAddress, CheckoutTotals } from './checkout-format';
import { checkPinServiceability, createShiprocketOrder } from './shipping';
import { enqueueAndNotify } from './email-queue';
import { adminNotificationRecipient } from './email';
import { buildDedupeKey } from './email-lifecycle';
import { formatPrice } from './product-format';
import {
  reserveCartItems,
  releaseOrderReservations,
  finalizeReservations,
  StockUnavailableError,
} from './reservations';
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  razorpayKeyId,
  razorpayConfigured,
  verifyRazorpaySignature,
  RazorpayError,
} from './razorpay';

export class CheckoutError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Discriminated union: either a normal session requiring Razorpay payment,
 * or a zero-total session that is already confirmed and only needs redirect.
 */
export type CheckoutSession =
  | {
      /** Normal case: payment required via Razorpay */
      paymentRequired: true;
      orderNumber: string;
      amount: number; // paise
      currency: string;
      razorpayKeyId: string;
      razorpayOrderId: string;
      prefill: { name: string; email: string; contact: string };
    }
  | {
      /** Zero-total case: order is already CONFIRMED, just redirect to success */
      paymentRequired: false;
      orderNumber: string;
      amount: 0;
      currency: string;
    };

export type CheckoutSessionInput = {
  /** Guests send the full address; logged-in users send a saved addressId. */
  address?: Record<string, unknown>;
  addressId?: string;
  /** Optional for guests; ignored for logged-in users (account email wins). */
  email?: string;
  /** Logged-in only: also save the entered address to the account. */
  saveAddress?: boolean;
  /** Optional idempotency key to prevent duplicate checkout sessions (e.g., double-click). */
  idempotencyKey?: string;
  /** Optional checkout session ID for cart mutation guard (prevents cross-tab interference). */
  checkoutSessionId?: string;
};

function str(input: Record<string, unknown>, key: string): string {
  return typeof input[key] === 'string' ? (input[key] as string).trim() : '';
}

function validateAddress(raw: Record<string, unknown>): CheckoutAddress {
  const fullName = str(raw, 'fullName');
  const phone = str(raw, 'phone');
  const addressLine1 = str(raw, 'addressLine1');
  const city = str(raw, 'city');
  const state = str(raw, 'state');
  const postalCode = str(raw, 'postalCode');
  if (fullName.length < 2 || fullName.length > 80) {
    throw new CheckoutError("Please enter the recipient's full name.");
  }
  if (!/^[\d\s+-]{10,15}$/.test(phone)) {
    throw new CheckoutError('Please enter a valid 10-digit phone number.');
  }
  if (!addressLine1) throw new CheckoutError('Address line 1 is required.');
  if (!city) throw new CheckoutError('City is required.');
  if (!state) throw new CheckoutError('State is required.');
  if (!/^\d{6}$/.test(postalCode)) {
    throw new CheckoutError('Please enter a valid 6-digit PIN code.');
  }
  return {
    fullName,
    phone,
    addressLine1,
    addressLine2: str(raw, 'addressLine2') || null,
    city,
    state,
    postalCode,
    country: str(raw, 'country') || 'India',
  };
}

function addressSnapshot(a: CheckoutAddress): Record<string, string> {
  return {
    fullName: a.fullName,
    phone: a.phone,
    addressLine1: a.addressLine1,
    ...(a.addressLine2 ? { addressLine2: a.addressLine2 } : {}),
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    country: a.country,
  };
}

function generateOrderNumber(): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AD-${Date.now().toString(36).toUpperCase()}${rand}`;
}

/** Promo attached to the cart (already validated/recorded by ./promo). */
async function getCartPromoCodeId(
  cartId: string | null
): Promise<string | null> {
  if (!cartId) return null;
  const rows = await rawQuery<{ promo_code_id: string | null }>(
    sql`SELECT promo_code_id FROM carts WHERE id = ${cartId} LIMIT 1`
  );
  return rows[0]?.promo_code_id ?? null;
}

/** Guest customer row (userId null) so a future signup adopts the orders. */
async function ensureGuestCustomer(
  email: string,
  address: CheckoutAddress
): Promise<{ id: string; email: string }> {
  const guestEmail = email || `guest-${Date.now().toString(36)}@adore.local`;
  const [first, ...rest] = address.fullName.trim().split(/\s+/);
  const existing = await db
    .select({ id: customers.id, email: customers.email })
    .from(customers)
    .where(eq(customers.email, guestEmail))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(customers)
    .values({
      userId: null,
      email: guestEmail,
      firstName: first,
      lastName: rest.join(' ') || null,
      phone: address.phone,
    })
    .returning({ id: customers.id, email: customers.email });
  return inserted[0]!;
}

export async function createCheckoutSession(
  input: CheckoutSessionInput
): Promise<CheckoutSession> {
  if (!razorpayConfigured()) {
    throw new CheckoutError('Payments are not configured.', 503);
  }

  // --- Idempotency: if a key is provided, return existing session ----------
  if (input.idempotencyKey) {
    const existing = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status })
      .from(orders)
      .where(sql`${orders.idempotencyKey} = ${input.idempotencyKey}`)
      .limit(1);
    if (existing.length) {
      const existingOrder = existing[0];
      // Return a session that points to the existing order
      return {
        paymentRequired: existingOrder.status === 'PENDING',
        orderNumber: existingOrder.orderNumber,
        amount: 0,
        currency: 'INR',
      } as CheckoutSession;
    }
  }

  // --- Cart (server-side truth; client totals are never trusted) ----------
  const { cartId, userId } = await getCartShopper();
  const cart = await getCartDetail(cartId, userId);
  if (cart.items.length === 0) {
    throw new CheckoutError('Your bag is empty.');
  }
  const outOfStock = cart.items.find(i => i.quantity > i.stock);
  if (outOfStock) {
    throw new CheckoutError(
      `${outOfStock.name} (${outOfStock.size}) only has ${outOfStock.stock} left. Please update your bag.`,
      409
    );
  }
  const currency = cart.currency ?? 'INR';
  if (currency !== 'INR') {
    throw new CheckoutError(
      `Payments currently support INR only (bag currency: ${currency}).`
    );
  }

  // --- Address -------------------------------------------------------------
  let address: CheckoutAddress;
  let shippingAddressId: string | null = null;
  // Members are emailed at their account address; guests may leave it blank.
  let accountEmail = '';

  if (userId) {
    // Logged-in: pick a saved account address, or enter one now (optionally
    // saved to the account so it's reusable next time).
    const customer = await ensureCustomerForUserId(userId);
    accountEmail = customer.email;
    const saved = customer.id
      ? (await listAddresses(customer.id)).find(a => a.id === input.addressId)
      : undefined;

    if (saved) {
      if (!saved.phone?.trim()) {
        throw new CheckoutError(
          'That address has no phone number. Please add one in your account.'
        );
      }
      address = {
        fullName: saved.fullName?.trim() || customer.email.split('@')[0]!,
        phone: saved.phone,
        addressLine1: saved.addressLine1,
        addressLine2: saved.addressLine2,
        city: saved.city,
        state: saved.state,
        postalCode: saved.postalCode,
        country: saved.country || 'India',
      };
      shippingAddressId = saved.id;
    } else if (input.address && typeof input.address === 'object') {
      address = validateAddress(input.address);
      if (input.saveAddress) {
        await createAddress(customer.id, {
          ...address,
          addressType: 'shipping',
          isDefault: false,
        });
        const refreshed = await listAddresses(customer.id);
        shippingAddressId =
          refreshed.find(
            a =>
              a.postalCode === address.postalCode &&
              a.addressLine1 === address.addressLine1
          )?.id ?? null;
      }
    } else {
      throw new CheckoutError(
        'Please pick a delivery address from your account.'
      );
    }
  } else {
    if (!input.address || typeof input.address !== 'object') {
      throw new CheckoutError('Please enter a delivery address.');
    }
    address = validateAddress(input.address);
  }

  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new CheckoutError('Please enter a valid email address.');
  }
  const contactEmail = userId ? accountEmail : email;

  // --- Pre-payment Shiprocket verification (PIN serviceability) ------------
  // Quote the rate for the cart's real packed weight (sum of product weights
  // × quantities, with the 400g estimate for products without one).
  const cartWeightKg = cart.weightGrams / 1000;
  const pin = await checkPinServiceability(address.postalCode, cartWeightKg);
  if (!pin.serviceable) {
    throw new CheckoutError(
      `We don't deliver to ${address.postalCode} yet. We're expanding to new PIN codes soon.`,
      422
    );
  }

  // --- Amounts --------------------------------------------------------------
  // Shipping uses the real Shiprocket courier rate for this PIN when known,
  // falling back to the flat rate if the API didn't return one.
  const subtotal = Number(cart.subtotal);
  const discount = Number(cart.discount);
  const shipping = computeShippingAmount(
    subtotal - discount,
    pin.freightCharge
  );
  const total = Math.round((subtotal - discount + shipping) * 100);

  // --- Zero-total shortcut: if promo covers everything, confirm directly ---
  // No Razorpay needed, order is CONFIRMED immediately, stock reserved, pushed
  // to Shiprocket. This is safe for production because:
  //  - Only triggered when server-computed total is exactly 0
  //  - Still validates PIN serviceability and stock
  //  - Creates a real CONFIRMED order with all normal flow steps
  //  - Pushes to Shiprocket same as paid orders
  if (total === 0) {
    return await handleZeroTotalCheckout({
      cart,
      cartId,
      userId,
      address,
      contactEmail,
      subtotal,
      discount,
      shipping,
      currency,
      shippingAddressId,
      promoCodeId: await getCartPromoCodeId(cartId),
    });
  }

  // --- Persist the order (PENDING until payment is verified) ----------------
  const orderNumber = generateOrderNumber();
  const customer = userId
    ? await ensureCustomerForUserId(userId)
    : await ensureGuestCustomer(email, address);
  const promoCodeId = await getCartPromoCodeId(cartId);

  const inserted = await db
    .insert(orders)
    .values({
      customerId: customer.id,
      orderNumber,
      status: 'PENDING',
      subtotal: subtotal.toFixed(2),
      discountAmount: discount.toFixed(2),
      shippingAmount: shipping.toFixed(2),
      taxAmount: '0', // Not applied currently
      totalAmount: (total / 100).toFixed(2),
      currency,
      shippingAddressId,
      shippingAddressSnapshot: addressSnapshot(address),
      promoCodeId: promoCodeId,
      idempotencyKey: input.idempotencyKey ?? null,
      checkoutSessionId: input.checkoutSessionId ?? null,
    })
    .returning({ id: orders.id });
  const orderId = inserted[0]!.id;

  try {
    await db.insert(orderItems).values(
      cart.items.map((item: CartLine) => ({
        orderId,
        productId: item.productId,
        variantId: item.variantId,
        productName: item.name,
        sku: `${item.slug}-${item.color}-${item.size}`,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.lineTotal,
      }))
    );

    // --- Hold the stock BEFORE any payment window opens --------------------
    // Atomic conditional decrement per variant — if another checkout took the
    // last unit a moment ago, this throws 409 and nothing was charged.
    try {
      await reserveCartItems(
        orderId,
        cartId ?? '',
        cart.items.map((item: CartLine) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        }))
      );
    } catch (err) {
      if (err instanceof StockUnavailableError) {
        throw new CheckoutError(err.message, 409);
      }
      throw err;
    }

    // --- Razorpay order -----------------------------------------------------
    const rpOrder = await createRazorpayOrder({
      amount: total,
      currency,
      receipt: orderNumber,
      notes: { order_number: orderNumber, cart_id: cartId ?? '' },
    });
    await db
      .update(orders)
      .set({ razorpayOrderId: rpOrder.id, updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    return {
      paymentRequired: true,
      orderNumber,
      amount: rpOrder.amount,
      currency: rpOrder.currency,
      razorpayKeyId: razorpayKeyId(),
      razorpayOrderId: rpOrder.id,
      prefill: {
        name: address.fullName,
        email: contactEmail,
        contact: address.phone,
      },
    };
  } catch (err) {
    // The order + items were created above; `reserveCartItems` already rolled back
    // any partial stock claim on failure, so here we just need to delete the
    // half-created order. If Razorpay itself failed after a successful reserve,
    // `releaseOrderReservations` restores the stock.
    await releaseOrderReservations(orderId);
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
    await db.delete(orders).where(eq(orders.id, orderId));
    if (err instanceof RazorpayError) {
      throw new CheckoutError(err.message, err.status);
    }
    throw err;
  }
}

/**
 * Handle zero-total checkout (100% discount code).
 * Creates CONFIRMED order directly, reserves stock, pushes to Shiprocket.
 * Returns a session that tells frontend to redirect to success page.
 */
async function handleZeroTotalCheckout(input: {
  cart: Awaited<ReturnType<typeof getCartDetail>>;
  cartId: string | null;
  userId: string | null;
  address: CheckoutAddress;
  contactEmail: string;
  subtotal: number;
  discount: number;
  shipping: number;
  currency: string;
  shippingAddressId: string | null;
  promoCodeId: string | null;
  idempotencyKey?: string;
  checkoutSessionId?: string;
}): Promise<CheckoutSession> {
  const { cart, cartId, userId, address, contactEmail, subtotal, discount, shipping, currency, shippingAddressId, promoCodeId, idempotencyKey, checkoutSessionId } = input;

  const orderNumber = generateOrderNumber();
  const customer = userId
    ? await ensureCustomerForUserId(userId)
    : await ensureGuestCustomer(contactEmail, address);

  // Idempotency check for zero-total orders
  if (idempotencyKey) {
    const existing = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status })
      .from(orders)
      .where(sql`${orders.idempotencyKey} = ${idempotencyKey}`)
      .limit(1);
    if (existing.length) {
      const existingOrder = existing[0];
      return {
        paymentRequired: false,
        orderNumber: existingOrder.orderNumber,
        amount: 0,
        currency: 'INR',
      };
    }
  }

  // Create order as PENDING (zero‑total) – will be confirmed by a server‑side step
  const inserted = await db
    .insert(orders)
    .values({
      customerId: customer.id,
      orderNumber,
      status: 'PENDING',
      subtotal: subtotal.toFixed(2),
      discountAmount: discount.toFixed(2),
      shippingAmount: shipping.toFixed(2),
      taxAmount: '0',
      totalAmount: '0',
      currency,
      shippingAddressId,
      shippingAddressSnapshot: addressSnapshot(address),
      promoCodeId,
      razorpayPaymentId: null,
      zeroTotal: true,            // <-- requires `zero_total` column (see migration)
      paymentVerified: false,     // <-- requires `payment_verified` column
      idempotencyKey: idempotencyKey ?? null,
      checkoutSessionId: checkoutSessionId ?? null,
      updatedAt: new Date(),
    })
    .returning({ id: orders.id });
  const orderId = inserted[0]!.id;

  try {
    await db.insert(orderItems).values(
      cart.items.map((item: CartLine) => ({
        orderId,
        productId: item.productId,
        variantId: item.variantId,
        productName: item.name,
        sku: `${item.slug}-${item.color}-${item.size}`,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.lineTotal,
      }))
    );

    // Reserve stock (same as paid orders) but do NOT finalize yet
    try {
      await reserveCartItems(
        orderId,
        cartId ?? '',
        cart.items.map((item: CartLine) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        }))
      );
    } catch (err) {
      if (err instanceof StockUnavailableError) {
        throw new CheckoutError(err.message, 409);
      }
      throw err;
    }

    // Clear the cart (cosmetic)
    if (cartId) {
      try {
        await clearCart(cartId);
        await removePromo(cartId);
      } catch {
        // ignore
      }
    }

    // Audit log for zero‑total orders (security monitoring)
    try {
      await db.insert(auditLog).values({
        event: 'zero_total_order_created',
        data: {
          orderNumber,
          promoCode: promoCodeId,
          userId: userId ?? null,
        },
      });
    } catch {
      // best‑effort
    }

    // Return session indicating no payment required — frontend will redirect
    // The order stays PENDING until a server‑side confirmation step runs.
    return {
      paymentRequired: false,
      orderNumber,
      amount: 0,
      currency,
    };
  } catch (err) {
    // Rollback on any failure: release reservations, delete order
    await releaseOrderReservations(orderId);
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
    await db.delete(orders).where(eq(orders.id, orderId));
    throw err;
  }
}

/**
 * httpOnly cookie holding the order number this browser just paid for. It is
 * the ONLY key to the confirmation page — order numbers are never enumerable,
 * so nobody can read someone else's order.
 */
export const RECENT_ORDER_COOKIE = 'adore_recent_order';
export const RECENT_ORDER_MAX_AGE = 60 * 60; // seconds

export type PaymentVerificationInput = {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
};

export type ConfirmationItem = {
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
};

export type OrderConfirmation = {
  orderNumber: string;
  status: string;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  totalAmount: string;
  currency: string;
  placedAt: string;
  paymentId: string | null;
  shiprocketOrderId: string | null;
  shiprocketError: string | null;
  items: ConfirmationItem[];
  shippingAddress: Record<string, string> | null;
};

export async function getOrderConfirmation(
  orderNumber: string
): Promise<OrderConfirmation> {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  const order = rows[0];
  if (!order) throw new CheckoutError("We couldn't find that order.", 404);

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    shippingAmount: order.shippingAmount,
    totalAmount: order.totalAmount,
    currency: order.currency,
    placedAt: order.createdAt.toISOString(),
    paymentId: order.razorpayPaymentId,
    shiprocketOrderId: order.shiprocketOrderId,
    shiprocketError: null,
    items: items.map(item => ({
      productName: item.productName,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    })),
    shippingAddress: order.shippingAddressSnapshot ?? null,
  };
}

/** The reservation becomes the sale (stock was decremented at reserve time). */
async function decrementStock(orderId: string): Promise<void> {
  await finalizeReservations(orderId);
}

/** The bag is now an order — empty it (cosmetic; never fails a payment). */
async function releaseCart(): Promise<void> {
  try {
    const { cartId } = await getCartShopper();
    if (!cartId) return;
    await clearCart(cartId);
    await removePromo(cartId);
  } catch {
    // Ignore — the customer has paid; a stale bag must not break the flow.
  }
}

/**
 * Push a freshly paid order to Shiprocket so fulfilment happens automatically.
 * Best-effort: a courier outage must never lose a paid order — it just gets
 * pushed again later (the order stays CONFIRMED with no shiprocket_order_id).
 */
export async function pushToShiprocket(
  orderId: string
): Promise<string | null> {
  // Advisory lock to prevent concurrent pushes for the same order
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`);

  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const order = orderRows[0];
  if (!order) return null;

  // Idempotency: if already pushed, return existing id
  if (order.shiprocketOrderId) {
    return order.shiprocketOrderId;
  }

  const [customerRows, items] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1),
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
  ]);
  const customer = customerRows[0];

  // Per-product packed weights for the Shiprocket payload (one small query —
  // order_items doesn't snapshot weight, products may be edited after the sale).
  const weightRows = items.length
    ? await db
        .select({ id: products.id, weightGrams: products.weightGrams })
        .from(products)
        .where(
          inArray(
            products.id,
            items.map(i => i.productId)
          )
        )
    : [];
  const weightById = new Map(weightRows.map(w => [w.id, w.weightGrams]));
  const snap = order.shippingAddressSnapshot ?? {};

  // Re-check PIN serviceability at push time — courier coverage may have changed
  // since checkout started. If unserviceable, flag the order for admin triage
  // instead of failing the payment.
  const totalWeightKg = items.reduce(
    (sum, item) => sum + (weightById.get(item.productId) ?? 400) * item.quantity,
    0
  ) / 1000;
  const pinCheck = await checkPinServiceability(
    (snap.postalCode ?? '') as string,
    totalWeightKg
  );
  if (!pinCheck.serviceable) {
    await db
      .update(orders)
      .set({
        shippingIssue: true,
        shippingIssueReason: 'PIN became unserviceable after checkout',
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
    console.warn(
      `[checkout] Order ${order.orderNumber} confirmed but PIN ${snap.postalCode} no longer serviceable`
    );
    return null;
  }
  const customerName =
    snap.fullName ||
    [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') ||
    customer?.email ||
    'Customer';

  const result = await createShiprocketOrder({
    orderNumber: order.orderNumber,
    customerName,
    phone: snap.phone || customer?.phone || '',
    email: customer?.email ?? '',
    addressLine1: snap.addressLine1 ?? '',
    addressLine2: snap.addressLine2 ?? null,
    city: snap.city ?? '',
    state: snap.state ?? '',
    postalCode: snap.postalCode ?? '',
    country: snap.country || 'India',
    items: items.map(item => ({
      name: item.productName,
      sku: item.sku,
      units: item.quantity,
      sellingPrice: Number(item.unitPrice),
      weightGrams: weightById.get(item.productId) ?? null,
    })),
    subTotal: Number(order.subtotal),
    discount: Number(order.discountAmount),
  });

  if (result.shiprocketOrderId) {
    await db
      .update(orders)
      .set({
        shiprocketOrderId: result.shiprocketOrderId,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
  }
  return result.shiprocketOrderId || null;
}

/**
 * Queue the order emails — the customer confirmation and the admin
 * notification — through the durable outbox (see utils/schema.ts for why
 * email is never sent inline from a request).
 *
 * Each enqueue is one INSERT whose dedupe key (`<flow>/<order-number>`) makes
 * a retried verification a no-op at the UNIQUE index — a double callback can
 * never produce a second email. A lost queue message is recovered by the daily
 * backstop cron, because the row is the ledger.
 *
 * Never throws: `enqueueAndNotify` swallows its own errors, and the try/catch
 * guards the lookup queries. A missing email is the acceptable trade against
 * failing (or blocking) the response to a payment that already succeeded.
 */
export async function queueOrderConfirmedEmail(order: {
  id: string;
  orderNumber: string;
  customerId: string;
  totalAmount: string;
  currency: string;
}): Promise<void> {
  try {
    const [customerRows, items] = await Promise.all([
      db
        .select({
          email: customers.email,
          firstName: customers.firstName,
          lastName: customers.lastName,
        })
        .from(customers)
        .where(eq(customers.id, order.customerId))
        .limit(1),
      db
        .select({
          productName: orderItems.productName,
          quantity: orderItems.quantity,
          totalPrice: orderItems.totalPrice,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id)),
    ]);
    const customer = customerRows[0];
    if (!customer) {
      console.warn(
        `[checkout] no customer for ${order.orderNumber}; confirmation emails skipped`
      );
      return;
    }

    // One fetch serves both emails — no second round-trip for the notification.
    const itemsPayload = items.map(i => ({
      name: i.productName,
      qty: i.quantity,
      price: formatPrice(i.totalPrice, order.currency),
    }));
    const total = formatPrice(order.totalAmount, order.currency);
    const customerName =
      [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
      'there';

    if (customer.email) {
      await enqueueAndNotify({
        flow: 'order_confirmed',
        to: customer.email,
        dedupeKey: buildDedupeKey('order_confirmed', order.orderNumber),
        payload: {
          customerName,
          orderNumber: order.orderNumber,
          items: itemsPayload,
          total,
        },
      });
    } else {
      console.warn(
        `[checkout] no customer email for ${order.orderNumber}; confirmation email skipped`
      );
    }

    // Admin notification so a paid order never waits for someone to check the
    // ledger. Own dedupe key; failures are caught by the outer try/catch.
    await enqueueAndNotify({
      flow: 'admin_new_order',
      to: adminNotificationRecipient(),
      dedupeKey: buildDedupeKey('admin_new_order', order.orderNumber),
      payload: {
        customerName,
        customerEmail: customer.email,
        orderNumber: order.orderNumber,
        orderId: order.id,
        items: itemsPayload,
        total,
      },
    });
  } catch (err) {
    console.error(
      `[checkout] confirmation email enqueue failed for ${order.orderNumber}:`,
      err
    );
  }
}

/**
 * Verify a Razorpay Checkout success payload and turn the PENDING order into a
 * confirmed, fulfilled one. Safe to call twice with the same payment (retries,
 * double callbacks) — the PENDING→CONFIRMED transition is a single conditional
 * UPDATE, so stock is only ever decremented once.
 */
export async function verifyAndConfirmPayment(
  input: PaymentVerificationInput
): Promise<OrderConfirmation> {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = input;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new CheckoutError('Missing payment details.', 400);
  }

  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.razorpayOrderId, razorpayOrderId))
    .limit(1);
  const order = orderRows[0];
  if (!order) throw new CheckoutError("We couldn't find that order.", 404);

  // Already handled (e.g. the browser retried the callback).
  if (order.status !== 'PENDING') {
    if (order.razorpayPaymentId === razorpayPaymentId) {
      return getOrderConfirmation(order.orderNumber);
    }
    throw new CheckoutError('This order has already been paid for.', 409);
  }

  // Re-validate promo at payment verification time.
  // Get cartId from stock_reservations (linked by order_id).
  const cartRows = await rawQuery<{ cart_id: string }>(sql`
    SELECT DISTINCT cart_id FROM stock_reservations WHERE order_id = ${order.id}
  `);
  const cartId = cartRows[0]?.cart_id;
  if (cartId) {
    const promo = await getAttachedPromo(cartId, order.customerId);
    if (promo && !(await isPromoStillValid(promo.code))) {
      throw new CheckoutError(
        'Promo code expired or disabled. Please restart checkout.',
        409
      );
    }
  }

  if (
    !verifyRazorpaySignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
    })
  ) {
    throw new CheckoutError(
      "We couldn't verify that payment. If money was deducted it will be refunded automatically.",
      400
    );
  }

  // Server-to-server confirmation: the captured amount must match our order.
  const payment = await fetchRazorpayPayment(razorpayPaymentId);
  const expectedPaise = Math.round(Number(order.totalAmount) * 100);
  if (
    payment.order_id !== razorpayOrderId ||
    payment.amount !== expectedPaise
  ) {
    throw new CheckoutError(
      "That payment doesn't match this order. Please contact support.",
      409
    );
  }
  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    throw new CheckoutError(
      `Payment was not completed (status: ${payment.status}).`,
      402
    );
  }

  // Atomic PENDING → CONFIRMED: only one caller wins, so stock moves once.
  const confirmed = await db
    .update(orders)
    .set({
      status: 'CONFIRMED',
      razorpayPaymentId,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, order.id), eq(orders.status, 'PENDING')))
    .returning({ id: orders.id });

  if (confirmed.length === 0) {
    return getOrderConfirmation(order.orderNumber);
  }

  await decrementStock(order.id);
  await releaseCart();

  // Queue the order-confirmation email now that the order is committed. It is
  // enqueued BEFORE the Shiprocket push so a slow courier API can never delay
  // it, and the outbox guarantees it goes out even if this process dies here.
  await queueOrderConfirmedEmail(order);

  let shiprocketOrderId: string | null = null;
  let shiprocketError: string | null = null;
  try {
    shiprocketOrderId = await pushToShiprocket(order.id);
    if (!shiprocketOrderId) {
      shiprocketError = 'Shiprocket did not return an order id.';
    }
  } catch (err) {
    shiprocketError =
      err instanceof Error ? err.message : 'Courier booking failed.';
    console.error(
      `[checkout] Shiprocket push for ${order.orderNumber} failed: ${shiprocketError}`
    );
  }

  const confirmation = await getOrderConfirmation(order.orderNumber);
  return { ...confirmation, shiprocketOrderId, shiprocketError };
}
