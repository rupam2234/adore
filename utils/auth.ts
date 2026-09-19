import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db, sessions, users } from './db';
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  LOGIN_HINT_COOKIE_NAME,
} from './auth-cookies';

const secretKey = process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod';
const refreshSecretKey =
  process.env.JWT_REFRESH_SECRET ?? `${secretKey}-refresh`;

const encoder = new TextEncoder();
const JWT_SECRET = encoder.encode(secretKey);
const JWT_REFRESH_SECRET = encoder.encode(refreshSecretKey);

// Cookie names live in a LEAF module (no imports) so client components can read
// them without dragging bcryptjs / drizzle / the Neon client into the browser
// bundle. Re-exported here because server code imports them from "@/utils/auth".
export { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, LOGIN_HINT_COOKIE_NAME };

export const ACCESS_EXPIRY = '1h';
export const REFRESH_EXPIRY = '1d';
/** Refresh-token lifetime in ms — keep in sync with REFRESH_EXPIRY. */
export const REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

const accessCookieOptions: {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
} = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60,
};

const refreshCookieOptions: {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
} = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: REFRESH_TTL_MS / 1000,
};

const loginHintCookieOptions: {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
} = {
  httpOnly: false, // must be readable by client JS
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  // Matches the refresh-token lifetime: the hint should never claim "signed
  // in" after the session itself has expired. It holds no credential — just
  // "1"/"0" — so an early expiry only costs one /api/auth/me round-trip.
  maxAge: REFRESH_TTL_MS / 1000,
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export async function signAccessToken(
  payload: TokenPayload
): Promise<string | null> {
  if (!JWT_SECRET) return null;
  try {
    return await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ACCESS_EXPIRY)
      .sign(JWT_SECRET);
  } catch (err) {
    console.error('[signAccessToken] Error:', (err as Error).message);
    return null;
  }
}

export async function signRefreshToken(
  payload: TokenPayload
): Promise<string | null> {
  if (!JWT_REFRESH_SECRET) return null;
  try {
    return await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(REFRESH_EXPIRY)
      .sign(JWT_REFRESH_SECRET);
  } catch {
    return null;
  }
}

export async function verifyAccessToken(
  token: string
): Promise<TokenPayload | null> {
  if (!JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch (err) {
    console.error('[verifyAccessToken] Error:', (err as Error).message);
    return null;
  }
}

export async function verifyRefreshToken(
  token: string
): Promise<TokenPayload | null> {
  if (!JWT_REFRESH_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_REFRESH_SECRET);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

export type UserRole = 'admin' | 'user';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export async function getUserByEmail(
  email: string
): Promise<(UserRow & { passwordHash: string }) | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      avatarUrl: users.avatarUrl,
      metadata: users.metadata,
      passwordHash: users.passwordHash,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as UserRole,
    avatarUrl: r.avatarUrl,
    metadata: r.metadata,
    passwordHash: r.passwordHash,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      avatarUrl: users.avatarUrl,
      metadata: users.metadata,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as UserRole,
    avatarUrl: r.avatarUrl,
    metadata: r.metadata,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function setAuthCookies(
  accessToken: string,
  refreshToken: string
): {
  access: { name: string; value: string; options: typeof accessCookieOptions };
  refresh: {
    name: string;
    value: string;
    options: typeof refreshCookieOptions;
  };
  loggedIn: {
    name: string;
    value: string;
    options: typeof loginHintCookieOptions;
  };
} {
  return {
    access: {
      name: ACCESS_COOKIE_NAME,
      value: accessToken,
      options: accessCookieOptions,
    },
    refresh: {
      name: REFRESH_COOKIE_NAME,
      value: refreshToken,
      options: refreshCookieOptions,
    },
    loggedIn: {
      name: LOGIN_HINT_COOKIE_NAME,
      value: '1',
      options: loginHintCookieOptions,
    },
  };
}

export function clearAuthCookies(): {
  access: { name: string; value: string; options: typeof accessCookieOptions };
  refresh: {
    name: string;
    value: string;
    options: typeof refreshCookieOptions;
  };
  loggedIn: {
    name: string;
    value: string;
    options: typeof loginHintCookieOptions;
  };
} {
  const eo = { ...accessCookieOptions, maxAge: 0 };
  const er = { ...refreshCookieOptions, maxAge: 0 };
  return {
    access: { name: ACCESS_COOKIE_NAME, value: '', options: eo },
    refresh: { name: REFRESH_COOKIE_NAME, value: '', options: er },
    // Keep the hint (value "0" = confirmed signed out) rather than deleting it:
    // an explicit "0" lets the client skip /api/auth/me without a speculative
    // round-trip, whereas an absent cookie would mean "unknown" and force one.
    loggedIn: {
      name: LOGIN_HINT_COOKIE_NAME,
      value: '0',
      options: loginHintCookieOptions,
    },
  };
}

/**
 * The login-hint cookie on its own — "1" signed in, "0" signed out.
 *
 * Used by /api/auth/me, the one route that learns the session state without
 * issuing fresh tokens, so it can keep the client hint accurate.
 */
export function loginHintCookie(value: '0' | '1'): {
  name: string;
  value: string;
  options: typeof loginHintCookieOptions;
} {
  return {
    name: LOGIN_HINT_COOKIE_NAME,
    value,
    options: loginHintCookieOptions,
  };
}

/** One row per device; refresh rotates (revoke old + insert new). */
const MAX_SESSIONS_PER_USER = 10;

export async function storeSession(
  userId: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  // Housekeeping so the table can't grow without bound (runs on the rare
  // login/refresh path, not per request):
  // 1. Drop this user's already-expired sessions.
  await db
    .delete(sessions)
    .where(
      and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date()))
    );
  // 2. Cap concurrent devices: keep this new session + the 9 most recently
  //    expiring ones. A stale device is signed out lazily instead of piling up.
  await db.execute(sql`
    DELETE FROM sessions
    WHERE user_id = ${userId}
      AND token <> ${token}
      AND token NOT IN (
        SELECT token FROM sessions
        WHERE user_id = ${userId}
        ORDER BY expires_at DESC
        LIMIT ${MAX_SESSIONS_PER_USER - 1}
      )
  `);
  await db.insert(sessions).values({ userId, token, expiresAt });
}

export async function revokeSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export async function isSessionValid(token: string): Promise<boolean> {
  const rows = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows.length > 0;
}

export async function refreshTokens(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) throw new Error('Invalid refresh token');
  const valid = await isSessionValid(refreshToken);
  if (!valid) throw new Error('Session revoked');

  await revokeSession(refreshToken);

  const newPayload: TokenPayload = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  };
  const a = await signAccessToken(newPayload);
  const r = await signRefreshToken(newPayload);
  if (!a || !r) throw new Error('Failed to sign tokens');
  await storeSession(payload.userId, r, new Date(Date.now() + REFRESH_TTL_MS));
  return { accessToken: a, refreshToken: r };
}

export interface LoginResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  user?: UserRow;
  error?: string;
}

export async function login(
  email: string,
  password: string
): Promise<LoginResult> {
  // console.log(`[login] Attempting login for: ${email}`);
  const user = await getUserByEmail(email);
  if (!user) {
    // console.log(`[login] User not found: ${email}`);
    return { success: false, error: 'Invalid email or password' };
  }
  // console.log(`[login] User found: ${user.email} (${user.role})`);
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    // console.log(`[login] Invalid password for: ${email}`);
    return { success: false, error: 'Invalid email or password' };
  }

  const payload: TokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
  const accessToken = await signAccessToken(payload);
  const refreshToken = await signRefreshToken(payload);
  if (!accessToken || !refreshToken)
    return { success: false, error: 'Server configuration error' };

  await storeSession(
    user.id,
    refreshToken,
    new Date(Date.now() + REFRESH_TTL_MS)
  );
  // console.log(`[login] Session stored for: ${email}`);

  return {
    success: true,
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      metadata: user.metadata,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  };
}
