/**
 * Drizzle schema — mirrors the existing Postgres tables. No migrations are
 * introduced; drizzle-kit can later generate/apply schema changes from here.
 *
 * Note on column typing choices:
 * - Ids are declared `text` (string in TS) regardless of the underlying
 *   uuid/text type — Postgres casts the bound parameter automatically.
 * - `status` and `fit_feedback` are DB enum columns typed via $type<> so we
 *   don't have to redeclare pgEnum values; the builder still sends plain
 *   string params that Postgres casts to the enum type.
 * - Money columns are `numeric` (Drizzle returns string, matching existing code).
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
// `sql` lives in drizzle-orm proper; only used for the partial index predicate.
import { sql } from 'drizzle-orm';
import type { ProductStatus } from './admin-schema';
import type { FitFeedback } from './review-format';

// Client-generated ids: the original SQL never supplied ids (the DB has its
// own defaults), so Drizzle generates them app-side. A string param casts
// cleanly whether the column is text or uuid.
const randomId = () => crypto.randomUUID();

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(randomId),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').$type<'admin' | 'user'>().notNull().default('user'),
  avatarUrl: text('avatar_url'),
  metadata: jsonb('metadata')
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable('sessions', {
  userId: text('user_id').notNull(),
  token: text('token').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const products = pgTable('products', {
  id: text('id').primaryKey().$defaultFn(randomId),
  // Length notes (verified against the live DB — keep these in sync, they are
  // NOT enforced by Drizzle, only by Postgres):
  //   name     varchar(200)
  //   slug     varchar(180)
  //   material varchar(150)
  //   fit      text (was varchar(50) — see scripts/add-product-text-limits.sql;
  //            50 was too small for the prose rendered on product pages)
  //   short_description / story / care_instructions are unlimited text.
  // validateProductPayload() in utils/admin-schema.ts mirrors these limits.
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  shortDescription: text('short_description'),
  details: jsonb('details').$type<string[]>(),
  story: text('story'),
  material: text('material'),
  fit: text('fit'),
  careInstructions: text('care_instructions'),
  status: text('status').$type<ProductStatus>().notNull().default('DRAFT'),
  isFeatured: boolean('is_featured').notNull().default(false),
  /** Packed weight per unit (grams) — feeds Shiprocket rate + order payloads. */
  weightGrams: integer('weight_grams'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const productVariants = pgTable(
  'product_variants',
  {
    id: text('id').primaryKey().$defaultFn(randomId),
    productId: text('product_id').notNull(),
    sku: text('sku'),
    color: text('color').notNull(),
    colorHex: text('color_hex'),
    size: text('size').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    compareAtPrice: numeric('compare_at_price', { precision: 10, scale: 2 }),
    currency: text('currency').notNull().default('INR'),
    stockQuantity: integer('stock_quantity').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    uniqueIndex('product_variants_product_color_size_key').on(
      t.productId,
      t.color,
      t.size
    ),
    // Every product-page/listing subquery reads `WHERE product_id = ? AND
    // is_active` (colors, sizes, variants, total_stock and the min-price
    // LATERAL). `price` as the 3rd column lets the LATERAL's
    // `ORDER BY price ASC LIMIT 1` be satisfied by the index order, which
    // removes both the Sort and the `is_active` Filter node.
    index('idx_product_variants_product_active').on(
      t.productId,
      t.isActive,
      t.price
    ),
  ]
);

export const categories = pgTable('categories', {
  id: text('id').primaryKey().$defaultFn(randomId),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  parentId: text('parent_id'),
});

export const productCategories = pgTable('product_categories', {
  productId: text('product_id').notNull(),
  categoryId: text('category_id').notNull(),
});

export const productImages = pgTable(
  'product_images',
  {
    id: text('id').primaryKey().$defaultFn(randomId),
    productId: text('product_id').notNull(),
    publicId: text('public_id').notNull(),
    secureUrl: text('secure_url'),
    altText: text('alt_text'),
    width: integer('width'),
    height: integer('height'),
    sortOrder: integer('sort_order').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  t => [
    // The images aggregate is resolved per product on every product page
    // and every listing card. Without this the planner has no choice but a
    // seq scan on product_images (the largest of the product tables).
    index('idx_product_images_product_id').on(t.productId),
  ]
);

export const productReviews = pgTable('product_reviews', {
  id: text('id').primaryKey().$defaultFn(randomId),
  productId: text('product_id').notNull(),
  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body').notNull(),
  authorName: text('author_name').notNull(),
  sizePurchased: text('size_purchased'),
  fitFeedback: text('fit_feedback').$type<FitFeedback>(),
  helpfulCount: integer('helpful_count').notNull().default(0),
  isApproved: boolean('is_approved').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const carts = pgTable(
  'carts',
  {
    id: text('id').primaryKey().$defaultFn(randomId),
    token: text('token').notNull().unique(),
    // Set once the shopper logs in: the cart then follows the account
    // across devices/browsers instead of just this browser's cookie.
    userId: text('user_id').unique(),
    promoCodeId: text('promo_code_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [index('idx_carts_user_id').on(t.userId)]
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: text('id').primaryKey().$defaultFn(randomId),
    cartId: text('cart_id').notNull(),
    variantId: text('variant_id').notNull(),
    quantity: integer('quantity').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [uniqueIndex('cart_items_cart_variant_key').on(t.cartId, t.variantId)]
);

export const promoCodes = pgTable('promo_codes', {
  id: text('id').primaryKey().$defaultFn(randomId),
  code: text('code').notNull().unique(),
  description: text('description'),
  discountType: text('discount_type').$type<'PERCENT' | 'FIXED'>().notNull(),
  discountValue: numeric('discount_value', {
    precision: 10,
    scale: 2,
  }).notNull(),
  minSubtotal: numeric('min_subtotal', { precision: 10, scale: 2 }),
  maxRedemptions: integer('max_redemptions'),
  redemptionCount: integer('redemption_count').notNull().default(0),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const promoRedemptions = pgTable(
  'promo_redemptions',
  {
    id: text('id').primaryKey().$defaultFn(randomId),
    promoCodeId: text('promo_code_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    uniqueIndex('promo_redemptions_code_user_key').on(t.promoCodeId, t.userId),
  ]
);

export const customers = pgTable('customers', {
  id: text('id').primaryKey().$defaultFn(randomId),
  userId: text('user_id').unique(),
  email: text('email').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customerAddresses = pgTable('customer_addresses', {
  id: text('id').primaryKey().$defaultFn(randomId),
  customerId: text('customer_id').notNull(),
  fullName: text('full_name'),
  phone: text('phone'),
  addressLine1: text('address_line_1').notNull(),
  addressLine2: text('address_line_2'),
  city: text('city').notNull(),
  state: text('state').notNull(),
  postalCode: text('postal_code').notNull(),
  country: text('country').notNull().default('India'),
  addressType: text('address_type'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orders = pgTable('orders', {
  id: text('id').primaryKey().$defaultFn(randomId),
  customerId: text('customer_id').notNull(),
  orderNumber: text('order_number').notNull().unique(),
  status: text('status')
    .$type<
      | 'PENDING'
      | 'CONFIRMED'
      | 'PROCESSING'
      | 'SHIPPED'
      | 'DELIVERED'
      | 'CANCELLED'
      | 'REFUNDED'
    >()
    .notNull()
    .default('PENDING'),
  subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
  discountAmount: numeric('discount_amount', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  shippingAmount: numeric('shipping_amount', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  taxAmount: numeric('tax_amount', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('INR'),
  shippingAddressId: text('shipping_address_id'),
  shippingAddressSnapshot: jsonb('shipping_address_snapshot').$type<
    Record<string, string>
  >(),
  promoCodeId: text('promo_code_id'),
  razorpayOrderId: text('razorpay_order_id'),
  razorpayPaymentId: text('razorpay_payment_id'),
  shiprocketOrderId: text('shiprocket_order_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: text('id').primaryKey().$defaultFn(randomId),
  orderId: text('order_id').notNull(),
  productId: text('product_id').notNull(),
  variantId: text('variant_id').notNull(),
  productName: text('product_name').notNull(),
  sku: text('sku').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
  totalPrice: numeric('total_price', { precision: 10, scale: 2 }).notNull(),
});

/**
 * Stock reservations: holds inventory while a PENDING order is being paid
 * for (TTL 10 minutes). Stock is PHYSICALLY decremented from
 * `product_variants.stock_quantity` when the reservation is created, so
 * `stock_quantity` always reflects what is actually buyable everywhere.
 * See utils/reservations.ts for the lifecycle.
 */
export const stockReservations = pgTable('stock_reservations', {
  id: text('id').primaryKey().$defaultFn(randomId),
  orderId: text('order_id').notNull().unique(),
  cartId: text('cart_id'),
  variantId: text('variant_id').notNull(),
  quantity: integer('quantity').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Returns & exchanges.
 *
 * Mirrors scripts/add-returns.sql (applied to production 2026-10-02). There is
 * no drizzle-kit migration pipeline in this repo, so the .sql file is the
 * runnable record — keep the two in sync.
 *
 * The unit of return is the ORDER LINE, not the order: a customer may keep one
 * item and return another. `orderItems.returnedQty` tracks what has already
 * come back, which is what allows partial returns.
 */
export const returnRequests = pgTable(
  'return_requests',
  {
    id: text('id').primaryKey().$defaultFn(randomId),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    orderItemId: text('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    type: text('type').$type<'RETURN' | 'EXCHANGE'>().notNull(),
    reason: text('reason').notNull(),
    status: text('status')
      .$type<
        | 'REQUESTED'
        | 'APPROVED'
        | 'PICKUP_SCHEDULED'
        | 'PICKUP_FAILED'
        | 'SELF_SHIP_PENDING'
        | 'IN_TRANSIT'
        | 'RECEIVED'
        | 'QC_PASSED'
        | 'QC_FAILED'
        | 'EXCHANGE_SHIPPED'
        | 'EXCHANGE_FAILED'
        | 'REFUND_PENDING'
        | 'REFUNDED'
        | 'REFUND_FAILED'
        | 'REJECTED'
        | 'CANCELLED'
      >()
      .notNull()
      .default('REQUESTED'),

    qty: integer('qty').notNull().default(1),
    exchangeVariantId: text('exchange_variant_id').references(
      () => productVariants.id,
      { onDelete: 'set null' }
    ),

    fee: numeric('fee', { precision: 10, scale: 2 }).notNull().default('0'),
    refundAmount: numeric('refund_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    /** Gross − fee − shipping, clamped to the order-level headroom. */
    netRefund: numeric('net_refund', { precision: 10, scale: 2 }),
    /** The figure actually sent to Razorpay, in rupees. */
    payoutAmount: numeric('payout_amount', { precision: 10, scale: 2 }),

    shiprocketAwb: text('shiprocket_awb'),
    shiprocketReturnAwb: text('shiprocket_return_awb'),
    exchangeShiprocketOrderId: text('exchange_shiprocket_order_id'),
    pickupAttempts: integer('pickup_attempts').notNull().default(0),
    pickupExhausted: boolean('pickup_exhausted').notNull().default(false),
    selfShip: boolean('self_ship').notNull().default(false),

    photos: jsonb('photos').$type<string[]>(),
    rejectionReason: text('rejection_reason'),
    notes: text('notes'),

    // Fraud signals. `riskScore` reorders the admin queue; `isBlocked` is the
    // hard stop and is deliberately separate, so raising the score threshold can
    // never start blocking customers by accident.
    riskScore: integer('risk_score').notNull().default(0),
    riskReasons: jsonb('risk_reasons').$type<string[]>(),
    isBlocked: boolean('is_blocked').notNull().default(false),
    blockedReason: text('blocked_reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  t => [
    index('idx_return_requests_customer').on(t.customerId, t.createdAt),
    index('idx_return_requests_status').on(t.status, t.createdAt),
  ]
);

/**
 * Append-only audit log for the return lifecycle.
 *
 * Every state change writes here. It is the source for the customer-facing
 * timeline, the admin's per-request history, and the forensic record used when a
 * refund is disputed — so it is deliberately append-only and never updated.
 */
export const returnEvents = pgTable(
  'return_events',
  {
    id: text('id').primaryKey().$defaultFn(randomId),
    returnRequestId: text('return_request_id')
      .notNull()
      .references(() => returnRequests.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    /** Admin email, 'customer', or 'system:<provider>'. */
    actor: text('actor').notNull().default('system'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [index('idx_return_events_request').on(t.returnRequestId, t.createdAt)]
);

/**
 * Per-customer abuse ledger, maintained by `refreshCustomerRisk`.
 *
 * A materialised summary rather than a live aggregate, because it is read on
 * every return submission and the Neon HTTP driver charges per round-trip.
 */
export const customerRisk = pgTable('customer_risk', {
  customerId: uuid('customer_id')
    .primaryKey()
    .references(() => customers.id, { onDelete: 'cascade' }),
  totalReturns: integer('total_returns').notNull().default(0),
  totalRefunded: numeric('total_refunded', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  recentReturns: integer('recent_returns').notNull().default(0),
  recentValue: numeric('recent_value', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  declinedOrders: integer('declined_orders').notNull().default(0),
  chargebackCount: integer('chargeback_count').notNull().default(0),
  isBlocked: boolean('is_blocked').notNull().default(false),
  blockedReason: text('blocked_reason'),
  notes: text('notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Chargeback / dispute register.
 *
 * The single highest-value fraud input: a customer who refunds an item and also
 * disputes the payment has taken the money twice. `evaluateHardBlocks` refuses
 * any approval while a dispute is OPEN on the order.
 */
export const paymentDisputes = pgTable(
  'payment_disputes',
  {
    id: text('id').primaryKey().$defaultFn(randomId),
    razorpayPaymentId: text('razorpay_payment_id').notNull(),
    orderId: uuid('order_id').references(() => orders.id, {
      onDelete: 'cascade',
    }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull().default('0'),
    reason: text('reason'),
    status: text('status')
      .$type<'OPEN' | 'LOST' | 'WON' | 'WITHDRAWN'>()
      .notNull()
      .default('OPEN'),
    won: boolean('won'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  t => [index('idx_disputes_payment').on(t.razorpayPaymentId)]
);

/**
 * Transactional outbox for outbound email.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT JUST "a queue"
 * -------------------------------------------------
 * Sending email inline from a request has two failure modes that both lose mail:
 *
 *   1. If the process dies AFTER the order is committed but BEFORE the send
 *      completes, the email is gone. Nothing retries, nothing remembers.
 *   2. If Resend accepts the request and then the response times out, a naive
 *      retry sends the customer TWO order confirmations.
 *
 * So the job is written to the database first, as the durable record, and the
 * send happens later from a worker. The row is the ledger; the queue (Vercel
 * Queues) is only the courier that tells us to go look at it. If the queue
 * message is lost, the daily backstop cron still finds the row.
 *
 * `dedupeKey` is the second half of the story: it is sent to Resend as the
 * `Idempotency-Key` header, so even an at-least-once delivery cannot produce a
 * duplicate email. Resend retains those keys for 24 hours.
 *
 * This mirrors `webhook_events` above, which solves the same problem for
 * INBOUND events.
 */
export const emailJobs = pgTable(
  'email_jobs',
  {
    id: text('id').primaryKey().$defaultFn(randomId),

    /**
     * Which template to render. Kept as a closed set of literals rather than
     * free text so a typo cannot enqueue a job that can never be dispatched.
     */
    flow: text('flow').$type<EmailFlow>().notNull(),

    /** Recipient. Stored so a retry does not have to re-derive it. */
    to: text('to').notNull(),

    /** Everything the template needs, as JSON. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),

    /**
     * Stable identity for this logical email, e.g. `order_confirmed/AD-1001`.
     * Unique, so enqueueing the same email twice is a no-op rather than a
     * duplicate. This is also the Resend idempotency key.
     */
    dedupeKey: text('dedupe_key').notNull().unique(),

    status: text('status')
      .$type<'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'DEAD'>()
      .notNull()
      .default('PENDING'),

    /** Send attempts so far. Drives the backoff and the DEAD threshold. */
    attempts: integer('attempts').notNull().default(0),

    /** Earliest time this job may be retried. Backoff writes into this. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Resend's message id, kept so a delivery webhook can find the job. */
    providerId: text('provider_id'),

    lastError: text('last_error'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  t => [
    // The claim query's exact predicate: pending, and due. Partial so the index
    // stays small even after the table fills with SENT history.
    index('idx_email_jobs_due').on(t.nextAttemptAt).where(sql`status = 'PENDING'`),
    // Lets the Resend bounce webhook find the job by provider id.
    index('idx_email_jobs_provider').on(t.providerId),
  ]
);

/** The closed set of emails this app can send. */
export type EmailFlow =
  | 'order_confirmed'
  | 'order_shipped'
  | 'return_rejected'
  | 'refund_processed'
  | 'refund_failed';

/**
 * Webhook replay guard.
 *
 * Shiprocket and Razorpay both retry. Every inbound event id is claimed here
 * first, so a duplicate is acknowledged and dropped rather than re-applied.
 * Kept in the database rather than in process memory because on serverless a
 * retry routinely lands on a different instance.
 *
 * Also used for Resend's delivery webhooks, for the same reason.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    eventType: text('event_type').notNull(),
    processed: boolean('processed').notNull().default(false),
    payload: jsonb('payload'),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  t => [index('idx_webhook_events_pending').on(t.provider, t.receivedAt)]
);

