import { pool } from "./db";
import { EMPTY_SUMMARY } from "./review-format";
import type {
  FitFeedback,
  ProductReview,
  ReviewSummary,
} from "./review-format";

export { EMPTY_SUMMARY };
export type { FitFeedback, ProductReview, ReviewSummary };

type ReviewRow = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  author_name: string;
  size_purchased: string | null;
  fit_feedback: FitFeedback | null;
  helpful_count: number;
  created_at: string | Date;
};

function mapReviewRow(row: ReviewRow): ProductReview {
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
  const rows = (await pool`
    SELECT rating, COUNT(*) AS count
    FROM product_reviews
    WHERE product_id = ${productId} AND is_approved = TRUE
    GROUP BY rating
  `) as unknown as Array<{ rating: number; count: string }>;

  const distribution: ReviewSummary["distribution"] = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  let count = 0;
  let total = 0;
  for (const row of rows) {
    const rating = Number(row.rating) as 1 | 2 | 3 | 4 | 5;
    const n = Number(row.count);
    if (rating >= 1 && rating <= 5) distribution[rating] = n;
    count += n;
    total += rating * n;
  }
  return {
    average: count > 0 ? Math.round((total / count) * 10) / 10 : 0,
    count,
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

  // NOTE: neon() has no fragment composer, so sort gets two explicit queries.
  const reviewQuery =
    sort === "helpful"
      ? pool`
          SELECT id, rating, title, body, author_name, size_purchased,
                 fit_feedback, helpful_count, created_at
          FROM product_reviews
          WHERE product_id = ${productId} AND is_approved = TRUE
          ORDER BY helpful_count DESC, created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : pool`
          SELECT id, rating, title, body, author_name, size_purchased,
                 fit_feedback, helpful_count, created_at
          FROM product_reviews
          WHERE product_id = ${productId} AND is_approved = TRUE
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;

  const [reviews, totalRows] = await Promise.all([
    reviewQuery as unknown as Promise<ReviewRow[]>,
    pool`
      SELECT COUNT(*) AS count FROM product_reviews
      WHERE product_id = ${productId} AND is_approved = TRUE
    ` as unknown as Promise<Array<{ count: string }>>,
  ]);

  return {
    reviews: reviews.map(mapReviewRow),
    total: Number(totalRows[0]?.count ?? 0),
  };
}

/** Resolve a product slug to its id (for review API routes). */
export async function getProductIdBySlug(slug: string): Promise<string | null> {
  const rows = (await pool`
    SELECT id FROM products WHERE slug = ${slug} LIMIT 1
  `) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}
