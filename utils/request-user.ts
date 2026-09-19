import { cookies } from 'next/headers';
import { verifyAccessToken, ACCESS_COOKIE_NAME } from './auth';

export async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(ACCESS_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyAccessToken(token);
  return payload?.userId ?? null;
}
