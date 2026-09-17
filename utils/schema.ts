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
    integer,
    jsonb,
    numeric,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ProductStatus } from "./admin-schema";
import type { FitFeedback } from "./review-format";

// Client-generated ids: the original SQL never supplied ids (the DB has its
// own defaults), so Drizzle generates them app-side. A string param casts
// cleanly whether the column is text or uuid.
const randomId = () => crypto.randomUUID();

export const users = pgTable("users", {
    id: text("id").primaryKey().$defaultFn(randomId),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").$type<"admin" | "user">().notNull().default("user"),
    avatarUrl: text("avatar_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
    userId: text("user_id").notNull(),
    token: text("token").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const products = pgTable("products", {
    id: text("id").primaryKey().$defaultFn(randomId),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    shortDescription: text("short_description"),
    details: jsonb("details").$type<string[]>(),
    story: text("story"),
    material: text("material"),
    fit: text("fit"),
    careInstructions: text("care_instructions"),
    status: text("status").$type<ProductStatus>().notNull().default("DRAFT"),
    isFeatured: boolean("is_featured").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productVariants = pgTable(
    "product_variants",
    {
        id: text("id").primaryKey().$defaultFn(randomId),
        productId: text("product_id").notNull(),
        sku: text("sku"),
        color: text("color").notNull(),
        colorHex: text("color_hex"),
        size: text("size").notNull(),
        price: numeric("price", { precision: 10, scale: 2 }).notNull(),
        compareAtPrice: numeric("compare_at_price", { precision: 10, scale: 2 }),
        currency: text("currency").notNull().default("INR"),
        stockQuantity: integer("stock_quantity").notNull().default(0),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("product_variants_product_color_size_key").on(t.productId, t.color, t.size)],
);

export const categories = pgTable("categories", {
    id: text("id").primaryKey().$defaultFn(randomId),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    parentId: text("parent_id"),
});

export const productCategories = pgTable("product_categories", {
    productId: text("product_id").notNull(),
    categoryId: text("category_id").notNull(),
});

export const productImages = pgTable("product_images", {
    id: text("id").primaryKey().$defaultFn(randomId),
    productId: text("product_id").notNull(),
    publicId: text("public_id").notNull(),
    secureUrl: text("secure_url"),
    altText: text("alt_text"),
    width: integer("width"),
    height: integer("height"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
});

export const productReviews = pgTable("product_reviews", {
    id: text("id").primaryKey().$defaultFn(randomId),
    productId: text("product_id").notNull(),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    authorName: text("author_name").notNull(),
    sizePurchased: text("size_purchased"),
    fitFeedback: text("fit_feedback").$type<FitFeedback>(),
    helpfulCount: integer("helpful_count").notNull().default(0),
    isApproved: boolean("is_approved").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const carts = pgTable("carts", {
    id: text("id").primaryKey().$defaultFn(randomId),
    token: text("token").notNull().unique(),
    promoCodeId: text("promo_code_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cartItems = pgTable(
    "cart_items",
    {
        id: text("id").primaryKey().$defaultFn(randomId),
        cartId: text("cart_id").notNull(),
        variantId: text("variant_id").notNull(),
        quantity: integer("quantity").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("cart_items_cart_variant_key").on(t.cartId, t.variantId)],
);

export const promoCodes = pgTable("promo_codes", {
    id: text("id").primaryKey().$defaultFn(randomId),
    code: text("code").notNull().unique(),
    description: text("description"),
    discountType: text("discount_type").$type<"PERCENT" | "FIXED">().notNull(),
    discountValue: numeric("discount_value", { precision: 10, scale: 2 }).notNull(),
    minSubtotal: numeric("min_subtotal", { precision: 10, scale: 2 }),
    maxRedemptions: integer("max_redemptions"),
    redemptionCount: integer("redemption_count").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const promoRedemptions = pgTable(
    "promo_redemptions",
    {
        id: text("id").primaryKey().$defaultFn(randomId),
        promoCodeId: text("promo_code_id").notNull(),
        userId: text("user_id").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("promo_redemptions_code_user_key").on(t.promoCodeId, t.userId)],
);

export const customers = pgTable("customers", {
    id: text("id").primaryKey().$defaultFn(randomId),
    userId: text("user_id").unique(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerAddresses = pgTable("customer_addresses", {
    id: text("id").primaryKey().$defaultFn(randomId),
    customerId: text("customer_id").notNull(),
    fullName: text("full_name"),
    phone: text("phone"),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    country: text("country").notNull().default("India"),
    addressType: text("address_type"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable("orders", {
    id: text("id").primaryKey().$defaultFn(randomId),
    customerId: text("customer_id").notNull(),
    orderNumber: text("order_number").notNull().unique(),
    status: text("status")
        .$type<
            | "PENDING"
            | "CONFIRMED"
            | "PROCESSING"
            | "SHIPPED"
            | "DELIVERED"
            | "CANCELLED"
            | "REFUNDED"
        >()
        .notNull()
        .default("PENDING"),
    subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
    discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
    shippingAmount: numeric("shipping_amount", { precision: 10, scale: 2 }).notNull().default("0"),
    taxAmount: numeric("tax_amount", { precision: 10, scale: 2 }).notNull().default("0"),
    totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    shippingAddressId: text("shipping_address_id"),
    shippingAddressSnapshot: jsonb("shipping_address_snapshot").$type<Record<string, string>>(),
    promoCodeId: text("promo_code_id"),
    razorpayOrderId: text("razorpay_order_id"),
    razorpayPaymentId: text("razorpay_payment_id"),
    shiprocketOrderId: text("shiprocket_order_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderItems = pgTable("order_items", {
    id: text("id").primaryKey().$defaultFn(randomId),
    orderId: text("order_id").notNull(),
    productId: text("product_id").notNull(),
    variantId: text("variant_id").notNull(),
    productName: text("product_name").notNull(),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
    totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
});

/**
 * Stock reservations: holds inventory while a PENDING order is being paid
 * for (TTL 10 minutes). Stock is PHYSICALLY decremented from
 * `product_variants.stock_quantity` when the reservation is created, so
 * `stock_quantity` always reflects what is actually buyable everywhere.
 * See utils/reservations.ts for the lifecycle.
 */
export const stockReservations = pgTable("stock_reservations", {
    id: text("id").primaryKey().$defaultFn(randomId),
    orderId: text("order_id").notNull().unique(),
    cartId: text("cart_id"),
    variantId: text("variant_id").notNull(),
    quantity: integer("quantity").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
