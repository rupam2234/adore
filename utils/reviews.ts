import { and, count, desc, eq } from "drizzle-orm";
import { db, productReviews, products } from "./db";
import { EMPTY_SUMMARY } from "./review-format";
import type {
  FitFeedback,
  ProductReview,
  ReviewSummary,
} from "./review-format";

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
export async function getReviewSummary(
  productId: string,
): Promise<ReviewSummary> {
  const rows = await db
    .select({ rating: productReviews.rating, total: count() })
    .from(productReviews)
    .where(
      and(
        eq(productReviews.productId, productId),
        eq(productReviews.isApproved, true),
      ),
    )
    .groupBy(productReviews.rating);

  const distribution: ReviewSummary["distribution"] = {
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
    average: totalReviews > 0 ? Math.round((total / totalReviews) * 10) / 10 : 0,
    count: totalReviews,
    distribution,
  };
}

export type ReviewSort = "recent" | "helpful";

export async function getApprovedReviews(
  productId: string,
  options: { page?: number; limit?: number; sort?: ReviewSort } = {},
): Promise<{ reviews: ProductReview[]; total: number }> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 5)), 20);
  const offset = (page - 1) * limit;
  const sort: ReviewSort = options.sort === "helpful" ? "helpful" : "recent";

  const approved = and(
    eq(productReviews.productId, productId),
    eq(productReviews.isApproved, true),
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
        ...(sort === "helpful"
          ? [desc(productReviews.helpfulCount), desc(productReviews.createdAt)]
          : [desc(productReviews.createdAt)]),
      )
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(productReviews)
      .where(approved),
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
