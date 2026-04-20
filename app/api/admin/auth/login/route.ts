import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, isValidAdminPassword } from "@/lib/auth";

/**
 * POST /api/admin/auth/login
 * Body: { password: string }
 * On success: sets the admin cookie and returns 200.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { password } = (await req.json().catch(() => ({ password: "" }))) as {
    password?: string;
  };

  if (!password || !isValidAdminPassword(password)) {
    return NextResponse.json({ ok: false, error: "invalid password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: password,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14, // 14 days
  });
  return res;
}
