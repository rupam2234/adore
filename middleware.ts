import { NextResponse, type NextRequest } from "next/server";
import {
  verifyAccessToken,
  ACCESS_COOKIE_NAME,
} from "@/utils/auth";

const ADMIN_PATHS = ["/admin", "/api/admin"];
const PUBLIC_ADMIN_PATH = "/admin/login";

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export default async function authMiddleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname === PUBLIC_ADMIN_PATH) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  if (!process.env.JWT_SECRET) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(ACCESS_COOKIE_NAME);
  const token = cookie?.value ?? null;
  const payload = token ? await verifyAccessToken(token) : null;

  if (!payload) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = PUBLIC_ADMIN_PATH;
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (isAdminPath(pathname) && payload.role !== "admin") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = PUBLIC_ADMIN_PATH;
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/api/admin/:path*",
    // NOTE: the /api/auth/* routes are deliberately NOT matched. The guard
    // above lets them straight through, so matching them only cost a
    // middleware invocation (and a log line) on every /api/auth/me call.
  ],
};