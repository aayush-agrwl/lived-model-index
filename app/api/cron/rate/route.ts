import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin, isAuthorizedCron } from "@/lib/auth";
import { findNextUnratedResponse, rateOne, countUnratedResponses } from "@/lib/rater";
import { todayStatus } from "@/lib/orchestration";

/**
 * POST /api/cron/rate
 *
 * Dedicated rate-only endpoint. Drains the unrated-responses queue and
 * does NOTHING else — no collection, no bootstrap, no slow-provider
 * exposure. Intended to be called as a separate GitHub Actions step
 * before the (heavier, 504-prone) /api/cron/tick endpoint, so a day
 * where /tick is broken still produces fully-rated data on whatever
 * was collected.
 *
 * Why this exists:
 *   - /api/cron/tick combines collection + rating in one function. A
 *     slow provider call during collection can push the function past
 *     Vercel's 300s ceiling, killing it with 504 before the rate
 *     phase runs.
 *   - This endpoint isolates the rating workload onto its own function
 *     invocation. It only calls the rater model (Llama 3.1 8B Instant
 *     on Groq, ~1-2s per call), so it cannot be tripped by a slow
 *     collector provider. Even if /tick is 100% red for the day,
 *     /rate will keep producing inter-rater reliability data.
 *
 * Time budget: ~90s of work, 10s reserve for response/DB writes.
 * At ~2s per rating that's ~45 rows per call; with 10-min cron cadence
 * that's ~270 rows/hour, well above the steady-state 147 rows/day
 * production rate.
 *
 * Access: cron bearer secret OR admin cookie.
 */

export const runtime = "nodejs";
export const maxDuration = 100;

const RATE_BUDGET_MS = 90_000;

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req) && !isAuthorizedAdmin()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  let ratedResponses = 0;
  let rateFailures = 0;

  while (Date.now() - started < RATE_BUDGET_MS) {
    const nextRespId = await findNextUnratedResponse().catch(() => null);
    if (nextRespId === null) break;
    try {
      const r = await rateOne(nextRespId);
      if (r.ok) ratedResponses++;
      else rateFailures++;
    } catch {
      // rateOne writes raterRatedAt on its own catch path, but if a
      // truly unhandled error escapes, count it and try the next row.
      // We never want one bad row to stall the whole queue.
      rateFailures++;
    }
  }

  const remainingUnrated = await countUnratedResponses().catch(() => null);
  const status = await todayStatus().catch(() => null);

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    ratedResponses,
    rateFailures,
    remainingUnrated,
    status,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
