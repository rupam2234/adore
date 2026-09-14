import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db, sessions, users } from "./db";

const secretKey = process.env.JWT_SECRET ?? "dev-secret-do-not-use-in-prod";
const refreshSecretKey = process.env.JWT_REFRESH_SECRET ?? `${secretKey}-refresh`;

const encoder = new TextEncoder();
const JWT_SECRET = encoder.encode(secretKey);
const JWT_REFRESH_SECRET = encoder.encode(refreshSecretKey);

console.log(`[auth] JWT_SECRET loaded: ${secretKey ? secretKey.substring(0, 4) + "..." : "NOT SET"}`);

export const ACCESS_COOKIE_NAME = "adore_access_token";
export const REFRESH_COOKIE_NAME = "adore_refresh_token";

export const ACCESS_EXPIRY = "15m";
export const REFRESH_EXPIRY = "7d";

const accessCookieOptions: {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge: number;
} = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 15,
};

const refreshCookieOptions: {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge: number;
} = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export async function signAccessToken(payload: TokenPayload): Promise<string | null> {
  if (!JWT_SECRET) return null;
  console.log(`[signAccessToken] Signing...`);
  try {
    return await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(ACCESS_EXPIRY)
      .sign(JWT_SECRET);
  } catch (err) {
    console.error("[signAccessToken] Error:", (err as Error).message);
    return null;
  }
}

export async function signRefreshToken(payload: TokenPayload): Promise<string | null> {
  if (!JWT_REFRESH_SECRET) return null;
  try {
    return await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(REFRESH_EXPIRY)
      .sign(JWT_REFRESH_SECRET);
  } catch {
    return null;
  }
}

export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  if (!JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { userId: payload.userId as string, email: payload.email as string, role: payload.role as string };
  } catch (err) {
    console.error("[verifyAccessToken] Error:", (err as Error).message);
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<TokenPayload | null> {
  if (!JWT_REFRESH_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_REFRESH_SECRET);
    return { userId: payload.userId as string, email: payload.email as string, role: payload.role as string };
  } catch {
    return null;
  }
}

export type UserRole = "admin" | "user";

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
  email: string,
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
  refreshToken: string,
): {
  access: { name: string; value: string; options: typeof accessCookieOptions };
  refresh: { name: string; value: string; options: typeof refreshCookieOptions };
} {
  return {
    access: { name: ACCESS_COOKIE_NAME, value: accessToken, options: accessCookieOptions },
    refresh: { name: REFRESH_COOKIE_NAME, value: refreshToken, options: refreshCookieOptions },
  };
}

export function clearAuthCookies(): {
  access: { name: string; value: string; options: typeof accessCookieOptions };
  refresh: { name: string; value: string; options: typeof refreshCookieOptions };
} {
  const eo = { ...accessCookieOptions, maxAge: 0 };
  const er = { ...refreshCookieOptions, maxAge: 0 };
  return {
    access: { name: ACCESS_COOKIE_NAME, value: "", options: eo },
    refresh: { name: REFRESH_COOKIE_NAME, value: "", options: er },
  };
}

export async function storeSession(
  userId: string,
  token: string,
  expiresAt: Date,
): Promise<void> {
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
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) throw new Error("Invalid refresh token");
  const valid = await isSessionValid(refreshToken);
  if (!valid) throw new Error("Session revoked");

  await revokeSession(refreshToken);

  const newPayload: TokenPayload = { userId: payload.userId, email: payload.email, role: payload.role };
  const a = await signAccessToken(newPayload);
  const r = await signRefreshToken(newPayload);
  if (!a || !r) throw new Error("Failed to sign tokens");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await storeSession(payload.userId, r, expiresAt);
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
  password: string,
): Promise<LoginResult> {
  console.log(`[login] Attempting login for: ${email}`);
  const user = await getUserByEmail(email);
  if (!user) {
    console.log(`[login] User not found: ${email}`);
    return { success: false, error: "Invalid email or password" };
  }
  console.log(`[login] User found: ${user.email} (${user.role})`);
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    console.log(`[login] Invalid password for: ${email}`);
    return { success: false, error: "Invalid email or password" };
  }

  const payload: TokenPayload = { userId: user.id, email: user.email, role: user.role };
  const accessToken = await signAccessToken(payload);
  const refreshToken = await signRefreshToken(payload);
  if (!accessToken || !refreshToken) return { success: false, error: "Server configuration error" };

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await storeSession(user.id, refreshToken, expiresAt);
  console.log(`[login] Session stored for: ${email}`);

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