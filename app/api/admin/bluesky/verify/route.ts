import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/lib/auth";
import { verifyBlueskyCredentials } from "@/lib/bluesky";

/**
 * POST /api/admin/bluesky/verify
 *
 * Confirms the configured Bluesky env vars authenticate to the
 * expected account. Returns the resolved handle and DID on success.
 *
 * Mirrors /api/admin/twitter/verify in shape; the activity log on
 * the admin panel surfaces the JSON result so the operator sees what
 * the credentials actually authenticate as before any real post.
 *
 * Access: admin cookie only.
 */

export const runtime = "nodejs";

export async function POST() {
  if (!isAuthorizedAdmin()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const me = await verifyBlueskyCredentials();
    return NextResponse.json({
      ok: true,
      handle: me.handle,
      did: me.did,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(_req: NextRequest) {
  return POST();
}
