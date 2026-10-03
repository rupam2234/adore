import { and, count, desc, eq, notInArray } from 'drizzle-orm';
import { cache } from 'react';
import { db, productReviews, products } from './db';
import { orders, orderItems, customers } from './schema';
import { EMPTY_SUMMARY } from './review-format';
import type {
  FitFeedback,
  ProductReview,
  ReviewSummary,
} from './review-format';

export { EMPTY_SUMMARY };
export type { FitFeedback, ProductReview, ReviewSummary };

function mapReviewRow(row: {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  author_name: string;
  size_purchased: string | null;
  fit_feedback: FitFeedback | null;
  helpful_count: number;
  created_at: string | Date;
}): ProductReview {
  return {
    id: row.id,
    rating: Number(row.rating),
    title: row.title,
    body: row.body,
    authorName: row.author_name,
    sizePurchased: row.size_purchased,
    fitFeedback: row.fit_feedback,
    helpfulCount: Number(row.helpful_count ?? 0),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

/** Average rating, total count and per-star distribution (approved only). */
export const getReviewSummary = cache(async function getReviewSummary(
  productId: string
): Promise<ReviewSummary> {
  const rows = await db
    .select({ rating: productReviews.rating, total: count() })
    .from(productReviews)
    .where(
      and(
        eq(productReviews.productId, productId),
        eq(productReviews.isApproved, true)
      )
    )
    .groupBy(productReviews.rating);

  const distribution: ReviewSummary['distribution'] = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  let totalReviews = 0;
  let total = 0;
  for (const row of rows) {
    const rating = Number(row.rating) as 1 | 2 | 3 | 4 | 5;
    const n = Number(row.total);
    if (rating >= 1 && rating <= 5) distribution[rating] = n;
    totalReviews += n;
    total += rating * n;
  }
  return {
    average:
      totalReviews > 0 ? Math.round((total / totalReviews) * 10) / 10 : 0,
    count: totalReviews,
    distribution,
  };
});

export type ReviewSort = 'recent' | 'helpful';

export async function getApprovedReviews(
  productId: string,
  options: { page?: number; limit?: number; sort?: ReviewSort } = {}
): Promise<{ reviews: ProductReview[]; total: number }> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 5)), 20);
  const offset = (page - 1) * limit;
  const sort: ReviewSort = options.sort === 'helpful' ? 'helpful' : 'recent';

  const approved = and(
    eq(productReviews.productId, productId),
    eq(productReviews.isApproved, true)
  );

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: productReviews.id,
        rating: productReviews.rating,
        title: productReviews.title,
        body: productReviews.body,
        author_name: productReviews.authorName,
        size_purchased: productReviews.sizePurchased,
        fit_feedback: productReviews.fitFeedback,
        helpful_count: productReviews.helpfulCount,
        created_at: productReviews.createdAt,
      })
      .from(productReviews)
      .where(approved)
      .orderBy(
        ...(sort === 'helpful'
          ? [desc(productReviews.helpfulCount), desc(productReviews.createdAt)]
          : [desc(productReviews.createdAt)])
      )
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(productReviews).where(approved),
  ]);

  return {
    reviews: rows.map(mapReviewRow),
    total: Number(totalRows[0]?.count ?? 0),
  };
}

/** Resolve a product slug to its id (for review API routes). */
export async function getProductIdBySlug(slug: string): Promise<string | null> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * The single rule for what name a review is posted under.
 *
 * Lives here so the POST route and the duplicate check can never disagree —
 * if they did, a customer could be blocked for a review they never wrote.
 * Client-supplied names are ignored entirely: the account is the only source.
 */
export function getReviewAuthorName(user: {
  name?: string | null;
  email: string;
}): string {
  return user.name?.trim() || user.email.split('@')[0] || 'Customer';
}

/**
 * Order statuses that disqualify a purchase from counting as "verified".
 *
 * A cancelled order was never paid for, and a refunded one has been taken back
 * — neither is a genuine experience of the product. Everything else (PENDING
 * through DELIVERED) counts, so a shopper can review immediately after buying
 * rather than having to wait for delivery.
 */
export const NON_VERIFIED_ORDER_STATUSES = ['CANCELLED', 'REFUNDED'] as const;

/**
 * True when the user has at least one non-cancelled/non-refunded order
 * containing this product (the verified-purchase check).
 *
 * This is now an AUTHORIZATION gate, not just an auto-approve hint, so it must
 * fail closed: any DB error returns `false` (deny), never `true`.
 */
export async function hasPurchasedProduct(
  userId: string,
  productId: string
): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(customers.userId, userId),
          eq(orderItems.productId, productId),
          notInArray(orders.status, [...NON_VERIFIED_ORDER_STATUSES])
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    // Fail closed — an unreachable DB must not grant review rights.
    return false;
  }
}

/**
 * True when this user has already reviewed this product.
 *
 * Reviews are stored without a user id (the table predates accounts), so this
 * matches on the author name the account would produce. That is a deliberate
 * soft check: it stops the common double-post without pretending to be a hard
 * identity guarantee. See `getReviewAuthorName` below for the shared rule.
 */
export async function hasAlreadyReviewedProduct(
  userId: string,
  productId: string,
  authorName: string
): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: productReviews.id })
      .from(productReviews)
      .where(
        and(
          eq(productReviews.productId, productId),
          eq(productReviews.authorName, authorName)
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    // Fail OPEN here: this is an anti-spam nicety, not the purchase gate, and
    // refusing to review because of a transient DB blip is worse.
    return false;
  }
}
