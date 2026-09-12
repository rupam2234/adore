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
  console.log(`[middleware] Path: ${pathname}`);

  if (pathname === PUBLIC_ADMIN_PATH) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  if (!process.env.JWT_SECRET) {
    console.log("[middleware] JWT_SECRET not set, allowing through");
    return NextResponse.next();
  }

  const cookie = request.cookies.get(ACCESS_COOKIE_NAME);
  const token = cookie?.value ?? null;
  console.log(`[middleware] Cookie present: ${!!token}`);
  const payload = token ? await verifyAccessToken(token) : null;

  if (!payload) {
    console.log("[middleware] No valid payload, redirecting to login");
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = PUBLIC_ADMIN_PATH;
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  console.log(`[middleware] User: ${payload.email} (${payload.role})`);

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
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/refresh",
    "/api/auth/me",
  ],
};