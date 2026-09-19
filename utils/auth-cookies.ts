/**
 * Auth cookie names — shared by server auth code AND client components.
 *
 * Deliberately a LEAF module with no imports: `utils/auth.ts` pulls in
 * bcryptjs, drizzle and the Neon client, so a client component can never
 * import from it without dragging server-only code into the browser bundle.
 * Keeping the names here lets `useAuthUser()` read the login hint cookie while
 * the server reads the very same constant, instead of the two drifting apart
 * as duplicated string literals.
 */

export const ACCESS_COOKIE_NAME = 'adore_access_token';
export const REFRESH_COOKIE_NAME = 'adore_refresh_token';

/**
 * Non-httpOnly "this browser may have a session" hint, readable by client JS.
 *
 * Read by useAuthUser() to skip the /api/auth/me round-trip entirely for
 * guests (the majority of traffic). It carries no data and grants nothing:
 * every request is still authorized server-side from the httpOnly access
 * token, so a forged value can at worst cause one wasted 401.
 */
export const LOGIN_HINT_COOKIE_NAME = 'adore_logged_in';
