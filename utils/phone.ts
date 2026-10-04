/**
 * Phone normalisation.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The one-account-per-phone guarantee is enforced by a unique index on
 * `customers.phone`. An index compares bytes, so without a canonical form that
 * guarantee is theatre: '9876543210', '+91 98765 43210' and '91-987-654-3210'
 * are three different strings and all three sail past the constraint.
 *
 * So every phone this module touches is reduced to the same thing: the national
 * significant number, digits only. For India that is the last 10 digits.
 *
 * Rejects rather than guesses. A number we cannot confidently normalise is
 * returned null so the caller can ask the customer again, because silently
 * storing a malformed value would poison the very column we are protecting.
 *
 * No database dependency, so it can be unit-tested directly.
 */

/**
 * Indian mobile numbers are 10 digits. Anything longer is assumed to carry a
 * country code (91, +91, 0091, 0-91...) in some arrangement.
 */
const INDIA_NSN_LENGTH = 10;

export const PHONE_PATTERN = /^\d{10}$/;

/** True for a phone already in canonical form. */
export function isCanonicalPhone(value: string | null | undefined): boolean {
  return typeof value === 'string' && PHONE_PATTERN.test(value);
}

/**
 * Reduce any reasonable phone spelling to digits-only national form.
 *
 * Returns null when the input cannot be normalised with confidence:
 *   - not a string, or empty
 *   - letters or symbols other than the usual + - ( ) space . separators
 *   - fewer than 10 digits (too short to be an Indian mobile)
 *   - more than 13 digits (weaker than any real number; almost always junk)
 *
 * The length ceiling matters: without it, '98765432109999999999999' would
 * normalise to the same value as a real number and quietly share its discount.
 */
export function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject anything that is not a phone number wearing a phone number's
  // clothes. Strip the separators people legitimately type, then confirm what
  // is left is digits only.
  const digits = trimmed.replace(/[\s\-().+]/g, '');
  if (!/^\d+$/.test(digits)) return null;

  if (digits.length < INDIA_NSN_LENGTH) return null;
  if (digits.length > 13) return null;

  // Drop any country-code prefix and keep the national number.
  return digits.slice(-INDIA_NSN_LENGTH);
}