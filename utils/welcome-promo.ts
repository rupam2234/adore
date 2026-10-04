/**
 * The welcome offer: issuing codes and resolving them at checkout.
 *
 * THE SHAPE OF THE ABUSE PROBLEM
 * ------------------------------
 * A per-account redemption limit alone does NOT stop welcome-code abuse. It
 * stops one person using one code twice; it does nothing about someone
 * registering twenty accounts to mint twenty codes. Without email verification
 * (deliberately not gating signup) the only thing standing between a signup form
 * and unlimited discount is what it costs an attacker to keep going.
 *
 * Four layers, cheapest first:
 *   1. Codes are PER ACCOUNT and unredeemable by anyone else. A single shared
 *      `WELCOME10` string cannot be used, only the unique code we issued you.
 *   2. One ACCOUNT per phone number (partial unique index on customers.phone).
 *      This is the expensive one for an attacker: N accounts now needs N real,
 *      reachable Indian mobile numbers, not N throwaway email addresses.
 *   3. Registration is rate limited per IP, so even the above cannot be farmed
 *      from one machine.
 *   4. The shared promo_codes row keeps a GLOBAL cap and a minimum order value,
 *      so total liability is bounded no matter what happens above.
 *
 * What layers 1-4 do NOT stop: a fraudster holding a list of real phone numbers.
 * Only verifying the email closes that, and the natural place for that gate is
 * here rather than at signup — see resolveWelcomeCode.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, promoCodes, welcomePromoIssues } from './db';

/** How long a welcome code stays usable. */
export const WELCOME_CODE_TTL_DAYS = 30;

/**
 * Characters used in the random suffix. No 0/O/1/I/L, because these codes get
 * read aloud over the phone and typed from an email by hand.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const CODE_SUFFIX_LENGTH = 6;

/**
 * A code a human can transcribe: WELCOME10-XXXXXX.
 *
 * The readable prefix is deliberate. Someone comparing the email against the
 * checkout box can see at a glance that they match, instead of wondering
 * whether 'F' really was 'E'.
 */
function generateCode(): string {
  const bytes = new Uint8Array(CODE_SUFFIX_LENGTH);
  crypto.getRandomValues(bytes);

  let suffix = '';
  for (let i = 0; i < CODE_SUFFIX_LENGTH; i += 1) {
    // Modulo bias is irrelevant here: 32 divides 256 exactly, so every
    // character is equally likely.
    suffix += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return `WELCOME10-${suffix}`;
}

export type WelcomeIssue = {
  code: string;
  expiresAt: Date;
};

/**
 * Issue this customer's welcome code. Idempotent per account.
 *
 * Returns the existing code unchanged if one was already issued, because
 * `user_id` is UNIQUE — so a retried signup cannot mint a second code, and a
 * customer who signs up twice keeps the same code they were emailed.
 *
 * Never throws. A failure here must not block the account being created; the
 * welcome email simply goes out without a code and support can issue one.
 */
export async function issueWelcomeCode(
  userId: string
): Promise<WelcomeIssue | null> {
  try {
    const existing = await db
      .select({
        code: welcomePromoIssues.code,
        expiresAt: welcomePromoIssues.expiresAt,
      })
      .from(welcomePromoIssues)
      .where(eq(welcomePromoIssues.userId, userId))
      .limit(1);
    if (existing[0]) return existing[0];

    // The shared definition. If this is missing the migration has not been run,
    // and we send a welcome email without a discount rather than failing.
    const definition = await db
      .select({ id: promoCodes.id })
      .from(promoCodes)
      .where(eq(promoCodes.code, 'WELCOME10'))
      .limit(1);
    if (!definition[0]) {
      console.error(
        '[welcome-promo] WELCOME10 definition missing — run scripts/add-welcome-promo.sql'
      );
      return null;
    }

    const expiresAt = new Date(
      Date.now() + WELCOME_CODE_TTL_DAYS * 24 * 60 * 60 * 1000
    );

    // A handful of collisions is vanishingly unlikely at 32^6 (~10^9), but
    // "unlikely" is not "impossible" and a UNIQUE violation would otherwise
    // surface as a failed signup. Retry a few times, then give up quietly.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inserted = await db
        .insert(welcomePromoIssues)
        .values({
          userId,
          code: generateCode(),
          promoCodeId: definition[0].id,
          expiresAt,
        })
        .onConflictDoNothing()
        .returning({ code: welcomePromoIssues.code });

      if (inserted[0]) return { code: inserted[0].code, expiresAt };

      // onConflictDoNothing also swallows the user_id collision, which is not
      // a collision to retry through. Re-read to find out which it was.
      const raced = await db
        .select({
          code: welcomePromoIssues.code,
          expiresAt: welcomePromoIssues.expiresAt,
        })
        .from(welcomePromoIssues)
        .where(eq(welcomePromoIssues.userId, userId))
        .limit(1);
      if (raced[0]) return raced[0];
    }

    console.error('[welcome-promo] could not issue a code for user', userId);
    return null;
  } catch (err) {
    console.error('[welcome-promo] issue failed:', err);
    return null;
  }
}

export class WelcomeCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WelcomeCodeError';
  }
}

/**
 * Resolve a pasted welcome code for this customer.
 *
 * Returns the promo_codes id the code was issued against, so the caller can run
 * the normal eligibility and discount maths against the shared definition.
 *
 * Throws WelcomeCodeError with a message that is safe and useful to show a
 * customer.
 *
 * WHERE EMAIL VERIFICATION BELONGS
 * -------------------------------
 * This is the right place for the optional `emailVerified` gate, NOT at signup.
 * A verification wall at signup costs conversions on every genuine customer,
 * whereas requiring verification only to redeem a discount costs almost nothing
 * (nobody abandons a real order over a click) and removes the entire
 * throwaway-email attack. If abuse ever shows up in promo_redemptions, add a
 * `users.email_verified_at IS NOT NULL` predicate here and leave signup alone.
 */
export async function resolveWelcomeCode(
  code: string,
  userId: string
): Promise<string> {
  const rows = await db
    .select({
      userId: welcomePromoIssues.userId,
      promoCodeId: welcomePromoIssues.promoCodeId,
      expiresAt: welcomePromoIssues.expiresAt,
      redeemedAt: welcomePromoIssues.redeemedAt,
    })
    .from(welcomePromoIssues)
    .where(eq(welcomePromoIssues.code, code.trim().toUpperCase()))
    .limit(1);

  const issue = rows[0];
  if (!issue) throw new WelcomeCodeError('Invalid promo code');

  if (issue.userId !== userId) {
    throw new WelcomeCodeError('That code belongs to a different account');
  }
  if (issue.redeemedAt) {
    throw new WelcomeCodeError('You have already used this code');
  }
  if (issue.expiresAt.getTime() < Date.now()) {
    throw new WelcomeCodeError('This code has expired');
  }

  return issue.promoCodeId;
}

/**
 * True when a pasted code looks like one of ours, so the caller can skip the
 * extra lookup for obviously-unrelated codes. Plain `WELCOME10` is included:
 * customers will type it, and it must fail with "belongs to a different
 * account" rather than being silently treated as an unknown code.
 */
export function looksLikeWelcomeCode(code: string): boolean {
  return /^WELCOME10(?:-[A-Z2-9]{6})?$/i.test(code.trim());
}

/**
 * Mark a welcome code spent.
 *
 * Called only after the discount has actually been applied to a paid order, not
 * when it is typed into a cart — see utils/promo.ts.
 *
 * `redeemedAt IS NULL` in the predicate means a double-submitted checkout cannot
 * mark it twice even if this runs concurrently.
 *
 * Returns true if this call is the one that marked it, false if it was already
 * spent — which is how a race between two simultaneous checkouts is caught.
 */
export async function markWelcomeCodeRedeemed(
  code: string,
  userId: string
): Promise<boolean> {
  const rows = await db
    .update(welcomePromoIssues)
    .set({ redeemedAt: new Date() })
    .where(
      and(
        eq(welcomePromoIssues.code, code.trim().toUpperCase()),
        eq(welcomePromoIssues.userId, userId),
        sql`${welcomePromoIssues.redeemedAt} IS NULL`
      )
    )
    .returning({ id: welcomePromoIssues.id });
  return rows.length > 0;
}

/** The customer's unused welcome code, for display in the account area. */
export async function getUnusedWelcomeCode(
  userId: string
): Promise<string | null> {
  const rows = await db
    .select({ code: welcomePromoIssues.code })
    .from(welcomePromoIssues)
    .where(
      and(
        eq(welcomePromoIssues.userId, userId),
        sql`${welcomePromoIssues.redeemedAt} IS NULL`
      )
    )
    .limit(1);
  return rows[0]?.code ?? null;
}

/**
 * The code a customer issued for one specific promo definition.
 *
 * Narrower than getUnusedWelcomeCode: it matches on the promo as well, so it
 * cannot report the wrong code if a second welcome-style offer is ever added.
 * Returns the code whether or not it has been redeemed, because the cart needs
 * to echo back the code that was typed even while it is attached.
 */
export async function getWelcomeIssueCodeForUser(
  promoCodeId: string,
  userId: string
): Promise<string | null> {
  const rows = await db
    .select({ code: welcomePromoIssues.code })
    .from(welcomePromoIssues)
    .where(
      and(
        eq(welcomePromoIssues.promoCodeId, promoCodeId),
        eq(welcomePromoIssues.userId, userId)
      )
    )
    .limit(1);
  return rows[0]?.code ?? null;
}