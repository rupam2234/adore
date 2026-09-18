import { NextRequest, NextResponse } from "next/server";
import {
  clearAuthCookies,
  REFRESH_COOKIE_NAME,
  revokeSession,
} from "@/utils/auth";

/**
 * POST /api/auth/logout
 *   Clears auth cookies and revokes the refresh session.
 */
export async function POST(request: NextRequest) {
  const refreshCookie = request.cookies.get(REFRESH_COOKIE_NAME);
  if (refreshCookie?.value) {
    try {
      await revokeSession(refreshCookie.value);
    } catch {
      // best-effort revocation — don't fail the logout
    }
  }

  const cookies = clearAuthCookies();
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(cookies.access.name, cookies.access.value, cookies.access.options);
  response.cookies.set(cookies.refresh.name, cookies.refresh.value, cookies.refresh.options);
  // Must clear the hint too, or the client keeps asking /api/auth/me after logout.
  response.cookies.set(
    cookies.loggedIn.name,
    cookies.loggedIn.value,
    cookies.loggedIn.options,
  );
  return response;
}
