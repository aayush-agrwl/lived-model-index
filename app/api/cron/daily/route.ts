import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron, isAuthorizedAdmin } from "@/lib/auth";
import { bootstrapDailyRuns, todayUtc } from "@/lib/orchestration";

/**
 * POST /api/cron/daily
 *
 * Invoked once per day (UTC) by the scheduler (GitHub Actions or Vercel
 * Cron). Creates run records for every collector model for today and
 * queues 30 placeholder response rows per run (10 prompts × 3 samples).
 *
 * Idempotent: re-invoking the same day is safe.
 *
 * Access: cron bearer secret OR admin cookie.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req) && !isAuthorizedAdmin()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const date = dateParam ?? todayUtc();

  try {
    const result = await bootstrapDailyRuns(date);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// Accept GET for ease of manual testing in the browser once logged in.
export async function GET(req: NextRequest) {
  return POST(req);
}
