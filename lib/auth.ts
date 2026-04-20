import { cookies } from "next/headers";
import { NextRequest } from "next/server";

/**
 * Shared auth helpers for cron-triggered endpoints and the admin UI.
 *
 * Two separate mechanisms:
 *   - Cron bearer token (CRON_SECRET): for machine triggers.
 *   - Admin session cookie (ADMIN_PASSWORD): for the /admin UI.
 *
 * Both rely on simple secret comparison; this is a single-user research
 * project, not a multi-tenant SaaS.
 */

export const ADMIN_COOKIE_NAME = "lmi_admin";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/**
 * Constant-time string comparison. Prevents timing attacks on secret checks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * True if the incoming request bears a valid cron secret.
 * Accepts either:
 *   Authorization: Bearer <secret>
 *   x-cron-secret: <secret>
 */
export function isAuthorizedCron(req: NextRequest): boolean {
  const expected = requireEnv("CRON_SECRET");
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  const header = req.headers.get("x-cron-secret");
  const provided = bearer ?? header ?? "";
  return timingSafeEqual(provided, expected);
}

/**
 * True if the incoming request bears a valid admin session cookie.
 */
export function isAuthorizedAdmin(): boolean {
  const expected = requireEnv("ADMIN_PASSWORD");
  const cookie = cookies().get(ADMIN_COOKIE_NAME);
  if (!cookie?.value) return false;
  return timingSafeEqual(cookie.value, expected);
}

/**
 * Validate a submitted admin password against ADMIN_PASSWORD.
 */
export function isValidAdminPassword(candidate: string): boolean {
  const expected = requireEnv("ADMIN_PASSWORD");
  return timingSafeEqual(candidate, expected);
}
