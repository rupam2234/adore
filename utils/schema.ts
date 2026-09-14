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
