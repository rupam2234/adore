import { NextResponse } from "next/server";
import { getSessionUserId } from "@/utils/request-user";
import { db, users } from "@/utils/db";
import { eq } from "drizzle-orm";
import {
  ensureCustomerForUserId,
  getCustomerByUserId,
  updateCustomerProfile,
} from "@/utils/account";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const customer = await getCustomerByUserId(userId);
  if (!customer) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ customer });
}

export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { name?: string; phone?: string };
  try {
    body = (await request.json()) as { name?: string; phone?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const customer = await ensureCustomerForUserId(userId);
  await updateCustomerProfile(customer.id, name, body.phone ?? null);
  await db
    .update(users)
    .set({ name, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return NextResponse.json({ customer: await getCustomerByUserId(userId) });
}
