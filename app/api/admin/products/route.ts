import { isAdminRequest } from "@/utils/admin-auth";
import { validateProductPayload } from "@/utils/admin-schema";
import { createProduct, listAdminProducts } from "@/utils/admin-products";
import { NextResponse } from "next/server";

/**
 * GET  /api/admin/products — list all products (all statuses)
 * POST /api/admin/products — create a DRAFT product (+variants, categories)
 *
 * Checkpoint flow: creation always lands as DRAFT; activate afterwards via
 * PATCH once variants + images exist.
 */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const products = await listAdminProducts();
    return NextResponse.json({ products }, { status: 200 });
  } catch (error) {
    console.error("admin list failed:", error);
    return NextResponse.json(
      { error: "Failed to list products" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Checkpoint 1: validate payload before any write
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = validateProductPayload(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Validation failed", fields: parsed.errors },
      { status: 422 },
    );
  }

  // Checkpoint 2: DB writes (product → variants → categories)
  try {
    const product = await createProduct(parsed.value);
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    console.error("admin create failed:", error);
    return NextResponse.json(
      { error: "Failed to create product" },
      { status: 500 },
    );
  }
}