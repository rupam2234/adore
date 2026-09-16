import { desc, eq } from "drizzle-orm";
import { db, promoCodes, promoRedemptions, users } from "./db";

export type AdminPromo = {
  id: string;
  code: string;
  description: string | null;
  discountType: "PERCENT" | "FIXED";
  discountValue: string;
  minSubtotal: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
};

export async function listPromos(): Promise<AdminPromo[]> {
  const rows = await db
    .select()
    .from(promoCodes)
    .orderBy(desc(promoCodes.createdAt));
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    description: row.description,
    discountType: row.discountType,
    discountValue: String(row.discountValue),
    minSubtotal: row.minSubtotal === null ? null : String(row.minSubtotal),
    maxRedemptions: row.maxRedemptions,
    redemptionCount: row.redemptionCount,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    isActive: row.isActive,
  }));
}

export type PromoPayload = {
  code: string;
  description: string | null;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  minSubtotal: number | null;
  maxRedemptions: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
};

export async function createPromo(payload: PromoPayload): Promise<void> {
  await db.insert(promoCodes).values({
    code: payload.code.trim().toUpperCase(),
    description: payload.description,
    discountType: payload.discountType,
    discountValue: String(payload.discountValue),
    minSubtotal:
      payload.minSubtotal === null ? null : String(payload.minSubtotal),
    maxRedemptions: payload.maxRedemptions,
    startsAt: payload.startsAt ? new Date(payload.startsAt) : null,
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
    isActive: payload.isActive,
  });
}

export async function setPromoActive(id: string, isActive: boolean): Promise<void> {
  await db
    .update(promoCodes)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(promoCodes.id, id));
}

export async function deletePromo(id: string): Promise<void> {
  await db.delete(promoCodes).where(eq(promoCodes.id, id));
}

export async function listPromoRedemptions(promoCodeId: string): Promise<
  Array<{ userEmail: string; createdAt: string }>
> {
  const rows = await db
    .select({ userEmail: users.email, createdAt: promoRedemptions.createdAt })
    .from(promoRedemptions)
    .innerJoin(users, eq(users.id, promoRedemptions.userId))
    .where(eq(promoRedemptions.promoCodeId, promoCodeId));
  return rows.map((row) => ({
    userEmail: row.userEmail,
    createdAt: row.createdAt.toISOString(),
  }));
}
