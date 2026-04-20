import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin, isAuthorizedCron } from "@/lib/auth";
import { bootstrapDailyRuns, todayStatus, todayUtc } from "@/lib/orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-triggered run bootstrap.
 *
 * Creates today's runs + placeholder response rows (idempotent) and
 * returns the resulting queue status. Used as the "start a manual run"
 * button in the admin panel, and as a fallback if the scheduled daily
 * cron didn't fire.
 *
 * Does NOT block on collection — that's drained by the tick endpoint.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorizedAdmin() && !isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date") || todayUtc();

  try {
    const bootstrap = await bootstrapDailyRuns(date);
    const status = await todayStatus(date);
    return NextResponse.json({ ok: true, bootstrap, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
