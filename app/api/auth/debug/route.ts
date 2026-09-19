import { NextRequest, NextResponse } from 'next/server';
import { count } from 'drizzle-orm';
import { db, users } from '@/utils/db';
import { verifyAccessToken, ACCESS_COOKIE_NAME } from '@/utils/auth';

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(ACCESS_COOKIE_NAME);
  const token = cookie?.value ?? null;
  const payload = token ? await verifyAccessToken(token) : null;

  let dbOk = false;
  let userCount = 0;
  try {
    const rows = await db.select({ c: count() }).from(users);
    userCount = Number(rows[0]?.c ?? 0);
    dbOk = true;
  } catch (err) {
    console.error('Debug DB error:', err);
  }

  return NextResponse.json({
    hasCookie: !!token,
    tokenValid: !!payload,
    payload,
    dbOk,
    userCount,
  });
}
