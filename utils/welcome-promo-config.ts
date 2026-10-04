/**
 * The welcome offer's terms, in one place.
 *
 * These are display-only copies of the values seeded into the WELCOME10 row by
 * scripts/add-welcome-promo.sql. They exist so the email can say "10% off" and
 * "₹999" without reading the promo table, which keeps the register route from
 * needing a second query just to render a sentence.
 *
 * The DATABASE is the source of truth — it is what the discount maths actually
 * uses, and an admin can retune the promo row in the admin panel. So if these
 * two drift, the customer sees a slightly wrong figure in the email while the
 * correct discount is applied at checkout. Changing the offer therefore means
 * editing BOTH this file and the seed in the migration, in that order.
 */
export const WELCOME_DISCOUNT_PERCENT = 10;

/**
 * Minimum order value, formatted for display.
 *
 * THIS IS 600, NOT 999. The WELCOME10 row already existed in the database
 * before this feature, at a Rs 600 minimum, and the migration deliberately
 * does not overwrite existing promo rows. So 600 is what the discount maths
 * will actually enforce — saying 999 here would have the email promising a
 * condition the checkout does not apply.
 *
 * To change the offer, edit the WELCOME10 row in the admin panel AND this
 * value together.
 */
export const WELCOME_MIN_ORDER = '₹600';

/** Human-readable lifetime, e.g. "30 days". Matches WELCOME_CODE_TTL_DAYS. */
export const WELCOME_VALIDITY_LABEL = '30 days';