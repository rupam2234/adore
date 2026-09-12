import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/utils/db";
import { verifyAccessToken, ACCESS_COOKIE_NAME } from "@/utils/auth";

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(ACCESS_COOKIE_NAME);
  const token = cookie?.value ?? null;
  const payload = token ? await verifyAccessToken(token) : null;

  let dbOk = false;
  let userCount = 0;
  try {
    const rows = await pool`SELECT COUNT(*) AS c FROM users`;
    userCount = (rows[0] as { c: number }).c;
    dbOk = true;
  } catch (err) {
    console.error("Debug DB error:", err);
  }

  return NextResponse.json({
    hasCookie: !!token,
    tokenValid: !!payload,
    payload,
    dbOk,
    userCount,
  });
}