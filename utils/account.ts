import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  db,
  rawQuery,
  customerAddresses,
  customers,
  orders,
  orderItems,
} from './db';
import { finalizeReservations } from './reservations';

export type CustomerAddress = {
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

export type CustomerRow = {
  id: string;
  userId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  createdAt: string;
};

export async function ensureCustomer(user: {
  id: string;
  email: string;
  name: string;
}): Promise<CustomerRow> {
  const byUser = await db
    .select()
    .from(customers)
    .where(eq(customers.userId, user.id))
    .limit(1);
  if (byUser[0]) return mapCustomer(byUser[0]);

  const byEmail = await db
    .select()
    .from(customers)
    .where(eq(customers.email, user.email))
    .limit(1);
  if (byEmail[0]) {
    const [first, ...rest] = user.name.trim().split(' ');
    const adopted = await db
      .update(customers)
      .set({
        userId: user.id,
        firstName: byEmail[0].firstName ?? first,
        lastName: byEmail[0].lastName ?? (rest.join(' ') || null),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, byEmail[0].id))
      .returning();
    return mapCustomer(adopted[0]);
  }

  const [first, ...rest] = user.name.trim().split(' ');
  const inserted = await db
    .insert(customers)
    .values({
      userId: user.id,
      email: user.email,
      firstName: first,
      lastName: rest.join(' ') || null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return mapCustomer(inserted[0]);
  const retry = await db
    .select()
    .from(customers)
    .where(eq(customers.email, user.email))
    .limit(1);
  return mapCustomer(retry[0]);
}

export async function getCustomerByUserId(
  userId: string
): Promise<CustomerRow | null> {
  const rows = await db
    .select()
    .from(customers)
    .where(eq(customers.userId, userId))
    .limit(1);
  return rows[0] ? mapCustomer(rows[0]) : null;
}

export async function updateCustomerProfile(
  customerId: string,
  name: string,
  phone: string | null
): Promise<void> {
  const [first, ...rest] = name.trim().split(' ');
  await db
    .update(customers)
    .set({
      firstName: first,
      lastName: rest.join(' ') || null,
      phone: phone?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));
}

function mapCustomer(row: typeof customers.$inferSelect): CustomerRow {
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAddresses(
  customerId: string
): Promise<CustomerAddress[]> {
  const rows = await db
    .select()
    .from(customerAddresses)
    .where(eq(customerAddresses.customerId, customerId))
    .orderBy(
      desc(customerAddresses.isDefault),
      desc(customerAddresses.createdAt)
    );
  return rows.map(mapAddress);
}

export type AddressPayload = {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  addressType: string | null;
  isDefault: boolean;
};

export async function createAddress(
  customerId: string,
  payload: AddressPayload
): Promise<void> {
  const existing = await listAddresses(customerId);
  const makeDefault = payload.isDefault || existing.length === 0;
  if (makeDefault) await clearDefault(customerId);
  await db.insert(customerAddresses).values({
    customerId,
    fullName: payload.fullName,
    phone: payload.phone,
    addressLine1: payload.addressLine1,
    addressLine2: payload.addressLine2,
    city: payload.city,
    state: payload.state,
    postalCode: payload.postalCode,
    country: payload.country,
    addressType: payload.addressType,
    isDefault: makeDefault,
  });
}

export async function updateAddress(
  customerId: string,
  addressId: string,
  payload: AddressPayload
): Promise<void> {
  if (payload.isDefault) await clearDefault(customerId, addressId);
  await db
    .update(customerAddresses)
    .set({
      fullName: payload.fullName,
      phone: payload.phone,
      addressLine1: payload.addressLine1,
      addressLine2: payload.addressLine2,
      city: payload.city,
      state: payload.state,
      postalCode: payload.postalCode,
      country: payload.country,
      addressType: payload.addressType,
      isDefault: payload.isDefault,
    })
    .where(
      and(
        eq(customerAddresses.id, addressId),
        eq(customerAddresses.customerId, customerId)
      )
    );
}

export async function deleteAddress(
  customerId: string,
  addressId: string
): Promise<void> {
  const removed = await db
    .delete(customerAddresses)
    .where(
      and(
        eq(customerAddresses.id, addressId),
        eq(customerAddresses.customerId, customerId)
      )
    )
    .returning({ isDefault: customerAddresses.isDefault });
  if (removed[0]?.isDefault) {
    const remaining = await db
      .select({ id: customerAddresses.id })
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, customerId))
      .orderBy(asc(customerAddresses.createdAt))
      .limit(1);
    if (remaining[0]) {
      await db
        .update(customerAddresses)
        .set({ isDefault: true })
        .where(eq(customerAddresses.id, remaining[0].id));
    }
  }
}

export async function setDefaultAddress(
  customerId: string,
  addressId: string
): Promise<void> {
  await clearDefault(customerId, addressId);
  await db
    .update(customerAddresses)
    .set({ isDefault: true })
    .where(
      and(
        eq(customerAddresses.id, addressId),
        eq(customerAddresses.customerId, customerId)
      )
    );
}

async function clearDefault(
  customerId: string,
  keepAddressId?: string
): Promise<void> {
  const condition = keepAddressId
    ? and(
        eq(customerAddresses.customerId, customerId),
        sql`${customerAddresses.id} <> ${keepAddressId}`
      )
    : eq(customerAddresses.customerId, customerId);
  await db.update(customerAddresses).set({ isDefault: false }).where(condition);
}

function mapAddress(
  row: typeof customerAddresses.$inferSelect
): CustomerAddress {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    addressType: row.addressType,
    isDefault: row.isDefault,
  };
}

export function parseAddressPayload(
  body: Record<string, unknown>
): AddressPayload | string {
  const str = (key: string) =>
    typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  const fullName = str('fullName');
  const phone = str('phone');
  const addressLine1 = str('addressLine1');
  const city = str('city');
  const state = str('state');
  const postalCode = str('postalCode');
  if (!fullName) return 'Recipient name is required';
  if (!/^[\d\s+-]{10,15}$/.test(phone)) return 'Enter a valid phone number';
  if (!addressLine1) return 'Address line 1 is required';
  if (!city) return 'City is required';
  if (!state) return 'State is required';
  if (!/^\d{6}$/.test(postalCode)) return 'Enter a valid 6-digit PIN code';
  return {
    fullName,
    phone,
    addressLine1,
    addressLine2: str('addressLine2') || null,
    city,
    state,
    postalCode,
    country: str('country') || 'India',
    addressType: str('addressType') || null,
    isDefault: body.isDefault === true,
  };
}

export async function ensureCustomerForUserId(
  userId: string
): Promise<CustomerRow> {
  const { db, users } = await import('./db');
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) throw new Error('User not found');
  return ensureCustomer({ id: user.id, email: user.email, name: user.name });
}

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  items: Array<{
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
  }>;
  shippingAddress: Record<string, string> | null;
};

export type OrderDetailItem = OrderSummary['items'][number] & {
  variantId: string;
  color: string;
  size: string;
  stockQuantity: number;
  /** order_items.id — the unit a return is raised against. */
  orderItemId: string;
  /** How many of this line have already been returned. */
  returnedQty: number;
};

export type OrderDetail = Omit<OrderSummary, 'items'> & {
  items: OrderDetailItem[];
  /**
   * From orders.delivered_at. Null until the Shiprocket DELIVERED webhook sets
   * it — the returns flow refuses to guess a window without it.
   */
  deliveredAt: string | null;
};

export type ItemAvailability = {
  variantId: string;
  available: number;
  required: number;
  inStock: boolean;
};

export async function listOrders(customerId: string): Promise<OrderSummary[]> {
  const rows = await rawQuery<{
    id: string;
    order_number: string;
    status: string;
    subtotal: string;
    discount_amount: string;
    shipping_amount: string;
    tax_amount: string;
    total_amount: string;
    currency: string;
    created_at: string;
    shipping_address_snapshot: Record<string, string> | null;
    items: Array<{
      product_name: string;
      sku: string;
      quantity: number;
      unit_price: string;
      total_price: string;
    }>;
  }>(sql`
    SELECT
      o.id,
      o.order_number,
      o.status,
      o.subtotal,
      o.discount_amount,
      o.shipping_amount,
      o.tax_amount,
      o.total_amount,
      o.currency,
      o.created_at,
      o.shipping_address_snapshot,
      COALESCE(
        (
          SELECT JSON_AGG(
            JSON_BUILD_OBJECT(
              'product_name', oi.product_name,
              'sku', oi.sku,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price,
              'total_price', oi.total_price
            )
            ORDER BY oi.product_name
          )
          FROM order_items oi
          WHERE oi.order_id = o.id
        ),
        '[]'::json
      ) AS items
    FROM orders o
    WHERE o.customer_id = ${customerId}
    ORDER BY o.created_at DESC
  `);
  return rows.map(row => ({
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    subtotal: row.subtotal,
    discountAmount: row.discount_amount,
    shippingAmount: row.shipping_amount,
    taxAmount: row.tax_amount,
    totalAmount: row.total_amount,
    currency: row.currency,
    createdAt: new Date(row.created_at).toISOString(),
    items: (row.items ?? []).map(item => ({
      productName: item.product_name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      totalPrice: item.total_price,
    })),
    shippingAddress: row.shipping_address_snapshot,
  }));
}

/**
 * Get detailed order information including stock availability for each item.
 * When `customerId` is provided the order is only returned if it belongs to
 * that customer (prevents viewing other customers' orders by id guessing).
 */
export async function getOrderDetail(
  orderId: string,
  customerId?: string
): Promise<OrderDetail | null> {
  const rows = await rawQuery<{
    id: string;
    order_number: string;
    status: string;
    subtotal: string;
    discount_amount: string;
    shipping_amount: string;
    tax_amount: string;
    total_amount: string;
    currency: string;
    created_at: string;
    delivered_at: string | null;
    shipping_address_snapshot: Record<string, string> | null;
    items: Array<{
      product_name: string;
      sku: string;
      quantity: number;
      unit_price: string;
      total_price: string;
      variant_id: string;
      color: string;
      size: string;
      stock_quantity: number;
      order_item_id: string;
      returned_qty: number | null;
    }>;
  }>(sql`
    SELECT
      o.id,
      o.order_number,
      o.status,
      o.subtotal,
      o.discount_amount,
      o.shipping_amount,
      o.tax_amount,
      o.total_amount,
      o.currency,
      o.created_at,
      o.delivered_at,
      o.shipping_address_snapshot,
      COALESCE(
        (
          SELECT JSON_AGG(
            JSON_BUILD_OBJECT(
              'product_name', oi.product_name,
              'sku', oi.sku,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price,
              'total_price', oi.total_price,
              'variant_id', oi.variant_id,
              'color', v.color,
              'size', v.size,
              'stock_quantity', v.stock_quantity,
              'order_item_id', oi.id,
              'returned_qty', oi.returned_qty
            )
            ORDER BY oi.product_name
          )
          FROM order_items oi
          JOIN product_variants v ON v.id = oi.variant_id
          WHERE oi.order_id = o.id
        ),
        '[]'::json
      ) AS items
    FROM orders o
    WHERE o.id = ${orderId}
      ${customerId ? sql`AND o.customer_id = ${customerId}` : sql``}
    LIMIT 1
  `);

  if (!rows[0]) return null;

  const order = rows[0];
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    subtotal: order.subtotal,
    discountAmount: order.discount_amount,
    shippingAmount: order.shipping_amount,
    taxAmount: order.tax_amount,
    totalAmount: order.total_amount,
    currency: order.currency,
    createdAt: new Date(order.created_at).toISOString(),
    deliveredAt: order.delivered_at
      ? new Date(order.delivered_at).toISOString()
      : null,
    items: (order.items ?? []).map(item => ({
      productName: item.product_name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      totalPrice: item.total_price,
      variantId: item.variant_id,
      color: item.color,
      size: item.size,
      stockQuantity: item.stock_quantity,
      orderItemId: item.order_item_id,
      returnedQty: item.returned_qty ?? 0,
    })),
    shippingAddress: order.shipping_address_snapshot,
  };
}

/**
 * Check if all items in a pending order are still available.
 */
export async function checkOrderAvailability(
  orderId: string
): Promise<ItemAvailability[]> {
  const rows = await rawQuery<{
    variant_id: string;
    stock_quantity: number;
    quantity: number;
  }>(sql`
    SELECT
      oi.variant_id,
      v.stock_quantity,
      oi.quantity
    FROM order_items oi
    JOIN product_variants v ON v.id = oi.variant_id
    WHERE oi.order_id = ${orderId}
  `);

  return rows.map(r => ({
    variantId: r.variant_id,
    available: r.stock_quantity,
    required: r.quantity,
    inStock: r.stock_quantity >= r.quantity,
  }));
}
