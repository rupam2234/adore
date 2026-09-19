/**
 * Admin order ledger — the "prep board".
 *
 * Every paid order is stamped (on read, not in the DB) with the prep day it
 * belongs to: orders paid during business hours (Mon–Sat, 9:00–17:00 IST)
 * belong to the same working day; anything after 17:00 or on a Sunday rolls
 * over to the next working day. The ledger groups orders by that day so the
 * admin sees exactly which batch to prepare today.
 *
 * No schema changes: prep day is derived from `orders.created_at` so old
 * orders slot into the right batch automatically.
 */

import { desc, eq, inArray } from 'drizzle-orm';
import { db, orderItems, orders, customers } from './db';

/** Orders that represent earned revenue (pending payment excluded). */
export const PAID_STATUSES = [
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'REFUNDED',
] as const;

export type LedgerOrderStatus = (typeof PAID_STATUSES)[number] | 'CANCELLED';

export type LedgerOrder = {
  id: string;
  orderNumber: string;
  status: LedgerOrderStatus;
  paymentId: string | null;
  razorpayOrderId: string | null;
  shiprocketOrderId: string | null;
  placedAt: Date;
  prepDay: string; // YYYY-MM-DD in IST
  preparedToday: boolean; // prep day is the current IST working day
  inBusinessHours: boolean;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  totalAmount: string;
  currency: string;
  customer: { email: string; name: string; phone: string | null };
  shippingAddress: Record<string, string> | null;
  items: {
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
  }[];
};

export type LedgerDay = {
  prepDay: string;
  label: string;
  isToday: boolean;
  orders: LedgerOrder[];
  revenue: number;
  orderCount: number;
  itemCount: number;
};

/* ------------------------------------------------------------------ */
/* IST clock: all prep-day math runs in Asia/Kolkata regardless of     */
/* where the server deploys (Vercel UTC, local dev, etc.).             */
/* ------------------------------------------------------------------ */

const IST_TZ = 'Asia/Kolkata';
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;
const SUNDAY = 0; // Date.getUTCDay(): 0 = Sunday

function istParts(date: Date): {
  dayKey: string;
  weekday: number;
  hour: number;
} {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23', // "00"–"23", never "24" at midnight
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    dayKey: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: weekdays[get('weekday')] ?? 1,
    hour: Number(get('hour')),
  };
}

/** True when the order was paid inside Mon–Sat 9:00–17:00 IST. */
export function isBusinessHours(date: Date): boolean {
  const { weekday, hour } = istParts(date);
  return (
    weekday !== SUNDAY &&
    hour >= BUSINESS_START_HOUR &&
    hour < BUSINESS_END_HOUR
  );
}

/** The next working day (IST) strictly after `dayKey`. Skips Sundays. */
function nextWorkingDay(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  while (date.getUTCDay() === SUNDAY) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in IST, even outside working hours. */
export function currentPrepDayKey(now = new Date()): string {
  return istParts(now).dayKey;
}

/**
 * The prep day an order belongs to:
 * - paid Mon–Sat 9:00–17:00 IST → same day
 * - paid after 17:00 (or before 9:00) → next working day
 * - paid Sunday → Monday
 */
export function prepDayFor(placedAt: Date): {
  prepDay: string;
  inBusinessHours: boolean;
} {
  const { dayKey, weekday, hour } = istParts(placedAt);
  const inBusinessHours =
    weekday !== SUNDAY &&
    hour >= BUSINESS_START_HOUR &&
    hour < BUSINESS_END_HOUR;

  if (inBusinessHours) return { prepDay: dayKey, inBusinessHours };
  // After close on a working day, or any time on Sunday → next working day.
  return { prepDay: nextWorkingDay(dayKey), inBusinessHours };
}

/** Human label for a day key: "Wed 17 Sep" in IST. */
function labelForDay(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

/** All paid orders with their prep-day stamp, newest first. */
export async function listLedgerOrders(): Promise<LedgerOrder[]> {
  const rows = await db
    .select({
      order: orders,
      customerEmail: customers.email,
      firstName: customers.firstName,
      lastName: customers.lastName,
      customerPhone: customers.phone,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(inArray(orders.status, [...PAID_STATUSES]))
    .orderBy(desc(orders.createdAt))
    .limit(500);

  if (rows.length === 0) return [];

  const itemsByOrder = await db
    .select()
    .from(orderItems)
    .where(
      inArray(
        orderItems.orderId,
        rows.map(r => r.order.id)
      )
    );

  const todayKey = istParts(new Date()).dayKey;

  return rows.map(
    ({ order, customerEmail, firstName, lastName, customerPhone }) => {
      const { prepDay, inBusinessHours } = prepDayFor(order.createdAt);
      const snap = order.shippingAddressSnapshot ?? null;
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status as LedgerOrderStatus,
        paymentId: order.razorpayPaymentId,
        razorpayOrderId: order.razorpayOrderId,
        shiprocketOrderId: order.shiprocketOrderId,
        placedAt: order.createdAt,
        prepDay,
        preparedToday: prepDay === todayKey,
        inBusinessHours,
        subtotal: order.subtotal,
        discountAmount: order.discountAmount,
        shippingAmount: order.shippingAmount,
        totalAmount: order.totalAmount,
        currency: order.currency,
        customer: {
          email: customerEmail ?? '',
          name:
            snap?.fullName ||
            [firstName, lastName].filter(Boolean).join(' ') ||
            customerEmail ||
            'Customer',
          phone: snap?.phone || customerPhone || null,
        },
        shippingAddress: snap,
        items: itemsByOrder
          .filter(i => i.orderId === order.id)
          .map(i => ({
            productName: i.productName,
            sku: i.sku,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            totalPrice: i.totalPrice,
          })),
      };
    }
  );
}

/** Group ledger orders into prep-day batches (newest first) + totals. */
export function groupByPrepDay(ledgerOrders: LedgerOrder[]): {
  days: LedgerDay[];
  stats: { totalRevenue: number; totalOrders: number; totalItems: number };
} {
  const dayMap = new Map<string, LedgerOrder[]>();
  for (const order of ledgerOrders) {
    const list = dayMap.get(order.prepDay) ?? [];
    list.push(order);
    dayMap.set(order.prepDay, list);
  }

  const days: LedgerDay[] = [...dayMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([prepDay, list]) => ({
      prepDay,
      label: labelForDay(prepDay),
      isToday: list.some(o => o.preparedToday),
      orders: list,
      // Refunded money is returned to the customer — not revenue.
      revenue: list.reduce(
        (s, o) => (o.status === 'REFUNDED' ? s : s + Number(o.totalAmount)),
        0
      ),
      orderCount: list.length,
      itemCount: list.reduce(
        (s, o) => s + o.items.reduce((x, i) => x + i.quantity, 0),
        0
      ),
    }));

  const stats = {
    // Refunds excluded: refunded orders were placed (and still show in the
    // table/counts) but their money went back to the customer.
    totalRevenue: ledgerOrders.reduce(
      (s, o) => (o.status === 'REFUNDED' ? s : s + Number(o.totalAmount)),
      0
    ),
    totalOrders: ledgerOrders.length,
    totalItems: ledgerOrders.reduce(
      (s, o) => s + o.items.reduce((x, i) => x + i.quantity, 0),
      0
    ),
  };
  return { days, stats };
}

/** Compact summary for the dashboard card. */
export function ledgerSummary(
  all: LedgerOrder[],
  now = new Date()
): {
  todayRevenue: number;
  todayOrders: number;
  pendingShiprocket: number;
  openOrders: number;
} {
  const todayKey = currentPrepDayKey(now);

  let todayRevenue = 0;
  let todayOrders = 0;
  let pendingShiprocket = 0;
  let openOrders = 0;

  for (const o of all) {
    if (o.prepDay === todayKey) {
      if (o.status !== 'REFUNDED') todayRevenue += Number(o.totalAmount);
      todayOrders += 1;
    }
    if (!o.shiprocketOrderId && o.status !== 'REFUNDED') pendingShiprocket += 1;
    if (o.status === 'CONFIRMED' || o.status === 'PROCESSING') openOrders += 1;
  }

  return { todayRevenue, todayOrders, pendingShiprocket, openOrders };
}
