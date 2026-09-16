import { isAdminRequest } from "@/utils/admin-auth";
import {
  createPromo,
  deletePromo,
  listPromos,
  setPromoActive,
  type PromoPayload,
} from "@/utils/admin-promos";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ promos: await listPromos() }, { status: 200 });
  } catch (error) {
    console.error("admin promos list failed:", error);
    return NextResponse.json({ error: "Failed to list promos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const discountType = body.discountType === "FIXED" ? "FIXED" : "PERCENT";
  const discountValue = Number(body.discountValue);
  const minSubtotal = body.minSubtotal === "" || body.minSubtotal == null ? null : Number(body.minSubtotal);
  const maxRedemptions = body.maxRedemptions === "" || body.maxRedemptions == null ? null : Number(body.maxRedemptions);
  const startsAt = typeof body.startsAt === "string" && body.startsAt ? body.startsAt : null;
  const expiresAt = typeof body.expiresAt === "string" && body.expiresAt ? body.expiresAt : null;

  if (!code) {
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return NextResponse.json({ error: "Discount value must be a positive number" }, { status: 400 });
  }
  if (discountType === "PERCENT" && discountValue > 100) {
    return NextResponse.json({ error: "Percent discount cannot exceed 100" }, { status: 400 });
  }
  if (minSubtotal !== null && (!Number.isFinite(minSubtotal) || minSubtotal < 0)) {
    return NextResponse.json({ error: "Minimum subtotal must be a non-negative number" }, { status: 400 });
  }
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) {
    return NextResponse.json({ error: "Max redemptions must be a positive integer" }, { status: 400 });
  }

  const payload: PromoPayload = {
    code,
    description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
    discountType,
    discountValue,
    minSubtotal,
    maxRedemptions,
    startsAt,
    expiresAt,
    isActive: body.isActive === true,
  };

  try {
    await createPromo(payload);
    return NextResponse.json({ promos: await listPromos() }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate key")) {
      return NextResponse.json({ error: `Code ${code} already exists` }, { status: 409 });
    }
    console.error("admin promo create failed:", error);
    return NextResponse.json({ error: "Failed to create promo" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: string; isActive?: boolean };
  try {
    body = (await request.json()) as { id?: string; isActive?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.id || typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "id and isActive are required" }, { status: 400 });
  }

  try {
    await setPromoActive(body.id, body.isActive);
    return NextResponse.json({ promos: await listPromos() }, { status: 200 });
  } catch (error) {
    console.error("admin promo update failed:", error);
    return NextResponse.json({ error: "Failed to update promo" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    await deletePromo(id);
    return NextResponse.json({ promos: await listPromos() }, { status: 200 });
  } catch (error) {
    console.error("admin promo delete failed:", error);
    return NextResponse.json({ error: "Failed to delete promo" }, { status: 500 });
  }
}
