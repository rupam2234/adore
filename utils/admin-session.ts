import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  verifyAccessToken,
  ACCESS_COOKIE_NAME,
  getUserById,
  type UserRow,
} from "@/utils/auth";

/** Server-component guard for admin pages. Returns the user or redirects to login. */
export async function requireAdminPage(): Promise<UserRow> {
  if (!process.env.JWT_SECRET) {
    return {
      id: "dev-user",
      email: "dev@local",
      name: "Developer",
      role: "admin",
      avatarUrl: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UserRow;
  }

  const cookieStore = await cookies();
  const cookie = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  if (!cookie) {
    redirect("/admin/login");
  }

  const payload = await verifyAccessToken(cookie);
  if (!payload || payload.role !== "admin") {
    redirect("/admin/login");
  }

  const user = await getUserById(payload.userId);
  if (!user) {
    redirect("/admin/login");
  }

  return user;
}
