import { NextRequest, NextResponse } from "next/server";
import {
  refreshTokens,
  setAuthCookies,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from "@/utils/auth";

/**
 * POST /api/auth/refresh
 *   Body: { refreshToken } (optional — falls back to cookie if omitted)
 *   On success: rotates tokens, sets new cookies, returns user info.
 *   On failure: returns 401.
 */
export async function POST(request: NextRequest) {
  let body: { refreshToken?: string };
  try {
    body = (await request.json()) as { refreshToken?: string };
  } catch {
    body = {};
  }

  let refreshToken = body.refreshToken;
  if (!refreshToken) {
    const cookie = request.cookies.get(REFRESH_COOKIE_NAME);
    if (cookie?.value) refreshToken = cookie.value;
  }

  if (!refreshToken) {
    return NextResponse.json(
      { error: "Refresh token required" },
      { status: 401 },
    );
  }

  let tokens: { accessToken: string; refreshToken: string };
  try {
    tokens = await refreshTokens(refreshToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Refresh failed";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const cookies = setAuthCookies(tokens.accessToken, tokens.refreshToken);

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(cookies.access.name, cookies.access.value, cookies.access.options);
  response.cookies.set(cookies.refresh.name, cookies.refresh.value, cookies.refresh.options);

  return response;
}
