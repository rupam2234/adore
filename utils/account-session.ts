import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  verifyAccessToken,
  getUserById,
  ACCESS_COOKIE_NAME,
  type UserRow,
} from '@/utils/auth';

export async function requireAccountPage(): Promise<UserRow> {
  if (!process.env.JWT_SECRET) {
    return {
      id: 'dev-user',
      email: 'dev@local',
      name: 'Developer',
      role: 'admin',
      avatarUrl: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UserRow;
  }

  const cookieStore = await cookies();
  const cookie = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  const payload = cookie ? await verifyAccessToken(cookie) : null;
  const user = payload ? await getUserById(payload.userId) : null;
  if (!user) {
    const path = (await headers()).get('x-invoke-path') ?? '/account';
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return user;
}
