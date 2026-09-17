import { NextResponse } from "next/server";
import { db, productReviews } from "@/utils";
import {
  getApprovedReviews,
  getProductIdBySlug,
  getReviewSummary,
  hasPurchasedProduct,
  type ReviewSort,
} from "@/utils/reviews";
import { getSessionUserId } from "@/utils/request-user";
import { getUserById } from "@/utils/auth";

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

/** POST /api/products/[slug]/reviews — submit a review.
 *
 * Logged-in users: verified purchases are auto-approved; others held for
 * moderation. Guest reviews are always held for moderation (name is required).
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const productId = await getProductIdBySlug(slug);
  if (!productId) return error("Product not found", 404);

  // Reviews require an account.
  const userId = await getSessionUserId();
  if (!userId) {
    return error("Please log in to write a review.", 401);
  }
  const user = await getUserById(userId);
  if (!user) {
    return error("Your session has expired — please log in again.", 401);
  }

  // Verified purchase → auto-approve; otherwise hold for moderation.
  const verifiedPurchase = await hasPurchasedProduct(userId, productId);

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
  // Author name comes from the account; ignore any client-supplied value.
  const authorName = user.name?.trim() || user.email.split("@")[0] || "Customer";
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
  if (body.length < 2 || body.length > 2000) {
    return error("Please write a review (2–2000 characters).");
  }
  if (title.length > 120) {
    return error("Headline must be under 120 characters.");
  }

  const inserted = await db
    .insert(productReviews)
    .values({
      productId,
      rating,
      title: title === "" ? null : title,
      body,
      authorName,
      sizePurchased,
      isApproved: verifiedPurchase,
      fitFeedback: fitFeedback as "runs_small" | "true_to_size" | "runs_large" | null,
    })
    .returning({
      id: productReviews.id,
      rating: productReviews.rating,
      title: productReviews.title,
      body: productReviews.body,
      author_name: productReviews.authorName,
      size_purchased: productReviews.sizePurchased,
      fit_feedback: productReviews.fitFeedback,
      helpful_count: productReviews.helpfulCount,
      created_at: productReviews.createdAt,
    });

  const r = inserted[0];
  return NextResponse.json(
    {
      ok: true,
      approved: verifiedPurchase,
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
