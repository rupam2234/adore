import { verifyAccessToken, ACCESS_COOKIE_NAME } from "@/utils/auth";

/** Returns true if the request carries a valid admin JWT. Open when JWT_SECRET is unset. */
export function isAdminRequest(request: Request): boolean {
  if (!process.env.JWT_SECRET) return true;
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return false;
  const parts = cookieHeader.split(";").map((c) => c.trim());
  const accessCookie = parts.find((c) => c.startsWith(ACCESS_COOKIE_NAME + "="));
  if (!accessCookie) return false;
  const token = accessCookie.split("=")[1];
  if (!token) return false;
  const payload = verifyAccessToken(token);
  return payload !== null && payload.role === "admin";
}
