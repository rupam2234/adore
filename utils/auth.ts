import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { pool } from "./db";

export const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-do-not-use-in-prod";
export const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? `${JWT_SECRET}-refresh`;

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

export function signAccessToken(payload: TokenPayload): string | null {
  if (!JWT_SECRET) return null;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRY });
}

export function signRefreshToken(payload: TokenPayload): string | null {
  if (!JWT_REFRESH_SECRET) return null;
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY });
}

export function verifyAccessToken(token: string): TokenPayload | null {
  if (!JWT_SECRET) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): TokenPayload | null {
  if (!JWT_REFRESH_SECRET) return null;
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
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
  const rows = await pool`
    SELECT id, email, name, role, avatar_url, metadata,
           password_hash, created_at, updated_at
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    email: string;
    name: string;
    role: string;
    avatar_url: string | null;
    metadata: Record<string, unknown>;
    password_hash: string;
    created_at: Date;
    updated_at: Date;
  };
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as UserRole,
    avatarUrl: r.avatar_url,
    metadata: r.metadata,
    passwordHash: r.password_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const rows = await pool`
    SELECT id, email, name, role, avatar_url, metadata, created_at, updated_at
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    email: string;
    name: string;
    role: string;
    avatar_url: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
  };
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as UserRole,
    avatarUrl: r.avatar_url,
    metadata: r.metadata,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
  await pool`
    INSERT INTO sessions (user_id, token, expires_at)
    VALUES (${userId}, ${token}, ${expiresAt})
  `;
}

export async function revokeSession(token: string): Promise<void> {
  await pool`DELETE FROM sessions WHERE token = ${token}`;
}

export async function isSessionValid(token: string): Promise<boolean> {
  const rows = await pool`SELECT 1 FROM sessions WHERE token = ${token} AND expires_at > NOW()`;
  return rows.length > 0;
}

export async function refreshTokens(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) throw new Error("Invalid refresh token");
  const valid = await isSessionValid(refreshToken);
  if (!valid) throw new Error("Session revoked");

  await revokeSession(refreshToken);

  const newPayload: TokenPayload = { userId: payload.userId, email: payload.email, role: payload.role };
  const a = signAccessToken(newPayload);
  const r = signRefreshToken(newPayload);
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
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
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