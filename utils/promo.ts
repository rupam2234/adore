import { and, eq, sql } from 'drizzle-orm';
import { db, rawQuery, promoCodes, promoRedemptions } from './db';
import { computeDiscount } from './promo-format';
import {
  getWelcomeIssueCodeForUser,
  looksLikeWelcomeCode,
  markWelcomeCodeRedeemed,
  resolveWelcomeCode,
  WelcomeCodeError,
} from './welcome-promo';

export type AppliedPromo = {
  code: string;
  description: string | null;
  discountType: 'PERCENT' | 'FIXED';
  discountValue: string;
  discount: string;
};

export class PromoError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function getCartSubtotal(cartId: string): Promise<string> {
  const rows = await rawQuery<{ subtotal: string }>(sql`
    SELECT COALESCE(SUM(v.price * ci.quantity), 0) AS subtotal
    FROM cart_items ci
    JOIN product_variants v ON v.id = ci.variant_id AND v.is_active
    JOIN products p ON p.id = v.product_id AND p.status = 'ACTIVE'
    WHERE ci.cart_id = ${cartId}
  `);
  return rows[0]?.subtotal ?? '0';
}

type PromoRow = {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'PERCENT' | 'FIXED';
  discount_value: string;
  min_subtotal: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  starts_at: string | null;
  expires_at: string | null;
};

async function findPromo(code: string, onlyId?: string): Promise<PromoRow | null> {
  const rows = await rawQuery<PromoRow>(sql`
    SELECT id, code, description, discount_type, discount_value, min_subtotal,
           max_redemptions, redemption_count, starts_at, expires_at
    FROM promo_codes
    WHERE UPPER(code) = ${code.toUpperCase()} AND is_active
      ${onlyId ? sql`AND id = ${onlyId}` : sql``}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

function assertEligible(promo: PromoRow, subtotal: string): void {
  const now = Date.now();
  if (promo.starts_at && new Date(promo.starts_at).getTime() > now) {
    throw new PromoError('This code is not active yet');
  }
  if (promo.expires_at && new Date(promo.expires_at).getTime() < now) {
    throw new PromoError('This code has expired');
  }
  if (
    promo.max_redemptions !== null &&
    promo.redemption_count >= promo.max_redemptions
  ) {
    throw new PromoError('This code has reached its redemption limit');
  }
  const min = Number(promo.min_subtotal ?? 0);
  if (Number(subtotal) < min) {
    throw new PromoError(
      `This code requires a minimum order of ₹${min.toFixed(2)}`
    );
  }
}

export async function applyPromo(
  cartId: string,
  userId: string,
  rawCode: string
): Promise<AppliedPromo> {
  const code = rawCode.trim();
  if (!code) throw new PromoError('Enter a promo code');

  const subtotal = await getCartSubtotal(cartId);
  if (Number(subtotal) <= 0) {
    throw new PromoError('Add items to your bag before applying a code');
  }

  // A welcome code is not looked up by its own string: it is resolved through
  // welcome_promo_issues, which answers two questions a plain promo lookup
  // cannot — is this MY code, and has it already been spent. A shared
  // `WELCOME10` row alone would let anyone type the same word forever.
  //
  // The bare `WELCOME10` string is deliberately NOT redeemable. Customers will
  // type it (it is in the email subject), and it must fail rather than hand out
  // a discount to every account that guesses the name.
  let promoId: string | null = null;
  let welcomeCode: string | null = null;

  if (looksLikeWelcomeCode(code)) {
    try {
      promoId = await resolveWelcomeCode(code, userId);
      welcomeCode = code.toUpperCase();
    } catch (err) {
      if (err instanceof WelcomeCodeError) {
        throw new PromoError(err.message);
      }
      throw err;
    }
  }

  const promo = promoId
    ? await findPromo('WELCOME10', promoId)
    : await findPromo(code);

  if (!promo) throw new PromoError('Invalid promo code');

  assertEligible(promo, subtotal);

  const redeemed = await db
    .select({ id: promoRedemptions.id })
    .from(promoRedemptions)
    .where(
      and(
        eq(promoRedemptions.promoCodeId, promo.id),
        eq(promoRedemptions.userId, userId)
      )
    )
    .limit(1);
  if (redeemed.length > 0) {
    throw new PromoError('You have already used this code');
  }

  await db
    .insert(promoRedemptions)
    .values({ promoCodeId: promo.id, userId })
    .onConflictDoNothing();
  await db
    .update(promoCodes)
    .set({
      redemptionCount: sql`${promoCodes.redemptionCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(promoCodes.id, promo.id));

  // Keep the welcome-code record in step with the redemption ledger written
  // above. promo_redemptions stays the source of truth for "has this customer
  // used the offer"; redeemed_at is the denormalised copy that makes
  // "show me my unused code" a single indexed read instead of a join.
  if (welcomeCode) {
    await markWelcomeCodeRedeemed(welcomeCode, userId);
  }

  await db.execute(
    sql`UPDATE carts SET promo_code_id = ${promo.id}, updated_at = now() WHERE id = ${cartId}`
  );

  // Echo the customer's own code, not the shared `WELCOME10` definition. Showing
  // them a code they cannot use is worse than showing nothing.
  return {
    code: welcomeCode ?? promo.code,
    description: promo.description,
    discountType: promo.discount_type,
    discountValue: promo.discount_value,
    discount: computeDiscount(
      promo.discount_type,
      promo.discount_value,
      subtotal
    ),
  };
}

export async function revalidateAttachedPromo(
  cartId: string,
  userId: string | null
): Promise<void> {
  if (!userId) return;
  const attached = await getAttachedPromo(cartId, userId);
  if (!attached) return;

  // A welcome code must be re-checked through its own ledger, because the
  // generic lookup below only sees the shared WELCOME10 definition and would
  // happily keep the discount attached to a cart whose owner has already spent
  // it. This runs after every add/update/remove, so it is the backstop that
  // stops a stale cart from carrying a used discount to checkout.
  if (looksLikeWelcomeCode(attached.code)) {
    try {
      await resolveWelcomeCode(attached.code, userId);
    } catch {
      await removePromo(cartId);
    }
    return;
  }

  const promo = await findPromo(attached.code);
  if (!promo) {
    await removePromo(cartId);
    return;
  }
  const subtotal = await getCartSubtotal(cartId);
  try {
    assertEligible(promo, subtotal);
  } catch {
    await removePromo(cartId);
  }
}

export async function removePromo(cartId: string): Promise<void> {
  await db.execute(
    sql`UPDATE carts SET promo_code_id = NULL, updated_at = now() WHERE id = ${cartId}`
  );
}

export async function getAttachedPromo(
  cartId: string,
  userId: string | null
): Promise<Omit<AppliedPromo, 'discount'> | null> {
  if (!userId) return null;
  const rows = await rawQuery<PromoRow>(sql`
    SELECT pc.id, pc.code, pc.description, pc.discount_type, pc.discount_value,
           pc.min_subtotal, pc.max_redemptions, pc.redemption_count,
           pc.starts_at, pc.expires_at
    FROM carts c
    JOIN promo_codes pc ON pc.id = c.promo_code_id
    WHERE c.id = ${cartId} AND pc.is_active
    LIMIT 1
  `);
  const promo = rows[0];
  if (!promo) return null;

  // Show the customer THEIR code, not the shared definition string. If a
  // welcome code is attached, prefer the per-account value so the cart reads
  // 'WELCOME10-AB12CD'; fall back to the definition only if the issue row has
  // gone missing, in which case revalidateAttachedPromo will drop it anyway.
  let displayCode = promo.code;
  if (/^WELCOME10/i.test(promo.code) && userId) {
    const issue = await getWelcomeIssueCodeForUser(promo.id, userId);
    if (issue) displayCode = issue;
  }

  return {
    code: displayCode,
    description: promo.description,
    discountType: promo.discount_type,
    discountValue: promo.discount_value,
  };
}
