import { NextRequest, NextResponse } from "next/server";
import { getUserById, verifyAccessToken, ACCESS_COOKIE_NAME } from "@/utils/auth";

/**
 * GET /api/auth/me
 *   Returns the current user from the access token cookie.
 *   401 if not authenticated.
 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(ACCESS_COOKIE_NAME);
  if (!cookie?.value) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const payload = verifyAccessToken(cookie.value);
  if (!payload) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const user = await getUserById(payload.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  return NextResponse.json(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatarUrl: user.avatarUrl,
        metadata: user.metadata,
      },
    },
    { status: 200 },
  );
}
