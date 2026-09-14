import { NextResponse } from "next/server";
import { rawQuery, sql } from "@/utils";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

/** POST /api/products/[slug]/reviews/[id]/helpful — +1 helpful vote. */
export async function POST(_request: Request, { params }: RouteContext) {
  const { slug, id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing review id" }, { status: 400 });
  }

  // UPDATE ... FROM join: kept as raw SQL (the builder can't express it cleanly).
  const rows = await rawQuery<{ helpful_count: number }>(sql`
    UPDATE product_reviews r
    SET helpful_count = helpful_count + 1, updated_at = NOW()
    FROM products p
    WHERE r.id = ${id}
      AND r.product_id = p.id
      AND p.slug = ${slug}
      AND r.is_approved = TRUE
    RETURNING r.helpful_count
  `);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    helpfulCount: Number(rows[0].helpful_count),
  });
}
