import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, timingSafeEqual } from "@/lib/auth";

/**
 * Gate /admin routes behind the admin cookie. Login and logout endpoints
 * are exempt so the user can actually sign in.
 */

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Allow auth endpoints and the login page through.
  if (
    path === "/admin/login" ||
    path.startsWith("/api/admin/auth/")
  ) {
    return NextResponse.next();
  }

  if (path.startsWith("/admin") || path.startsWith("/api/admin")) {
    const expected = process.env.ADMIN_PASSWORD ?? "";
    const cookieValue = req.cookies.get(ADMIN_COOKIE_NAME)?.value ?? "";
    if (!expected || !timingSafeEqual(cookieValue, expected)) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
