import { NextResponse } from "next/server";
import { pool } from "@/utils";
import {
  getApprovedReviews,
  getProductIdBySlug,
  getReviewSummary,
  type ReviewSort,
} from "@/utils/reviews";

type RouteContext = { params: Promise<{ slug: string }> };

const FIT_VALUES = new Set(["runs_small", "true_to_size", "runs_large"]);

// Simple in-memory rate limit: 3 reviews / IP / hour. Resets on redeploy,
// good enough until you add Redis/Upstash.
const hits = new Map<string, number[]>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const recent = (hits.get(ip) ?? []).filter((t) => t > windowStart);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 3;
}

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** GET /api/products/[slug]/reviews?page=1&limit=5&sort=recent|helpful */
export async function GET(request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const productId = await getProductIdBySlug(slug);
  if (!productId) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(
    Math.max(1, Number(url.searchParams.get("limit")) || 5),
    20,
  );
  const sort: ReviewSort =
    url.searchParams.get("sort") === "helpful" ? "helpful" : "recent";

  const [summary, { reviews, total }] = await Promise.all([
    getReviewSummary(productId),
    getApprovedReviews(productId, { page, limit, sort }),
  ]);

  return NextResponse.json({
    summary,
    reviews,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

/** POST /api/products/[slug]/reviews — submit a review (auto-approved). */
export async function POST(request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const productId = await getProductIdBySlug(slug);
  if (!productId) return error("Product not found", 404);

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (isRateLimited(ip)) {
    return error("Too many reviews — please try again later.", 429);
  }

  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return error("Invalid JSON body.");
  }
  if (typeof data !== "object" || data === null) return error("Invalid body.");
  const b = data as Record<string, unknown>;

  // Honeypot: bots fill this hidden field; humans never see it.
  if (typeof b.website === "string" && b.website.trim() !== "") {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const rating = Number(b.rating);
  const body = typeof b.body === "string" ? b.body.trim() : "";
  const authorName =
    typeof b.authorName === "string" ? b.authorName.trim() : "";
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const sizePurchased =
    typeof b.sizePurchased === "string" && b.sizePurchased.trim() !== ""
      ? b.sizePurchased.trim().slice(0, 10).toUpperCase()
      : null;
  const fitFeedback =
    typeof b.fitFeedback === "string" && FIT_VALUES.has(b.fitFeedback)
      ? b.fitFeedback
      : null;

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return error("Please select a star rating (1–5).");
  }
  if (authorName.length < 2 || authorName.length > 60) {
    return error("Please enter your name (2–60 characters).");
  }
  if (body.length < 2 || body.length > 2000) {
    return error("Please write a review (2–2000 characters).");
  }
  if (title.length > 120) {
    return error("Headline must be under 120 characters.");
  }

  const rows = (await pool`
    INSERT INTO product_reviews
      (product_id, rating, title, body, author_name, size_purchased, fit_feedback)
    VALUES (
      ${productId}, ${rating}, ${title === "" ? null : title}, ${body},
      ${authorName}, ${sizePurchased}, ${fitFeedback}
    )
    RETURNING id, rating, title, body, author_name, size_purchased,
              fit_feedback, helpful_count, created_at
  `) as unknown as Array<{
    id: string;
    rating: number;
    title: string | null;
    body: string;
    author_name: string;
    size_purchased: string | null;
    fit_feedback: "runs_small" | "true_to_size" | "runs_large" | null;
    helpful_count: number;
    created_at: Date | string;
  }>;

  const r = rows[0];
  return NextResponse.json(
    {
      ok: true,
      review: {
        id: r.id,
        rating: Number(r.rating),
        title: r.title,
        body: r.body,
        authorName: r.author_name,
        sizePurchased: r.size_purchased,
        fitFeedback: r.fit_feedback,
        helpfulCount: Number(r.helpful_count ?? 0),
        createdAt:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : String(r.created_at),
      },
    },
    { status: 201 },
  );
}
