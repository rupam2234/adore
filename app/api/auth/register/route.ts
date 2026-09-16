import { NextRequest, NextResponse } from "next/server";
import {
  hashPassword,
  getUserByEmail,
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  storeSession,
  db,
  users,
} from "@/utils";

export async function POST(request: NextRequest) {
  let body: { name?: string; email?: string; password?: string };
  try {
    body = (await request.json()) as { name?: string; email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  try {
    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);
    const inserted = await db
      .insert(users)
      .values({ name, email, passwordHash, role: "user" })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    const user = inserted[0];

    const payload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = await signAccessToken(payload);
    const refreshToken = await signRefreshToken(payload);
    if (!accessToken || !refreshToken) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await storeSession(user.id, refreshToken, expiresAt);

    const cookies = setAuthCookies(accessToken, refreshToken);
    try {
      const { ensureCustomer } = await import("@/utils/account");
      await ensureCustomer(user);
    } catch (err) {
      console.error("Customer provisioning failed:", err);
    }

    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set(cookies.access.name, cookies.access.value, cookies.access.options);
    response.cookies.set(cookies.refresh.name, cookies.refresh.value, cookies.refresh.options);
    return response;
  } catch (err) {
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }
    console.error("Register error:", err);
    return NextResponse.json({ error: "Server error. Please try again." }, { status: 500 });
  }
}
