import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/lib/auth";
import { verifyCredentials } from "@/lib/twitter";

/**
 * POST /api/admin/twitter/verify
 *
 * Confirms the four configured X API credentials authenticate to the
 * expected @AIMoodIndex account, without posting anything. A successful
 * call hits GET /2/users/me on X's side and returns the username, user
 * ID, and display name for the admin UI to surface.
 *
 * On failure, the upstream X SDK error message is returned verbatim:
 * the failure modes (scope mismatch, wrong key combinations, rate
 * limit) are diagnosable from the message and we want it visible.
 *
 * Access: admin cookie only — this endpoint is operator-facing and
 * makes a real network call to X, so we don't expose it to the cron
 * bearer.
 */

export const runtime = "nodejs";

export async function POST() {
  if (!isAuthorizedAdmin()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const me = await verifyCredentials();
    return NextResponse.json({
      ok: true,
      username: me.username,
      userId: me.userId,
      name: me.name,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}

export async function GET(_req: NextRequest) {
  return POST();
}
