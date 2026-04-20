import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin, isAuthorizedCron } from "@/lib/auth";
import { collectSample, findNextPendingSample } from "@/lib/collector";
import { findNextUnratedResponse, rateOne } from "@/lib/rater";
import { todayStatus } from "@/lib/orchestration";

/**
 * POST /api/cron/tick
 *
 * Invoked every 5–10 minutes by the scheduler. Drains the work queue
 * as much as fits into the serverless time budget (targets ~50s so
 * we're safe under Hobby's 60s limit).
 *
 * Phases:
 *   1. "collect" — process one pending sample (10-prompt conversation)
 *      at a time. A sample averages 20–50s; we do at most one per tick.
 *   2. "rate" — once collection is done (or at least substantially
 *      ahead), independently rate collected responses. Batched since
 *      each rating call is fast (~1–2s on Groq).
 *
 * Access: cron bearer secret OR admin cookie.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000; // reserve ~10s of headroom

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req) && !isAuthorizedAdmin()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const report = {
    collectedSamples: [] as Array<{
      runId: number;
      sampleIndex: number;
      durationMs: number;
      succeeded: number;
      failed: number;
    }>,
    ratedResponses: 0,
    rateFailures: 0,
    earlyExit: false,
  };

  // Phase 1: collect one sample if any remain.
  const nextSample = await findNextPendingSample();
  if (nextSample) {
    try {
      const result = await collectSample(nextSample.runId, nextSample.sampleIndex, {
        pacingMs: 500,
      });
      report.collectedSamples.push({
        runId: result.runId,
        sampleIndex: result.sampleIndex,
        durationMs: result.durationMs,
        succeeded: result.succeeded,
        failed: result.failed,
      });
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          phase: "collect",
          runId: nextSample.runId,
          sampleIndex: nextSample.sampleIndex,
          error: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
  }

  // Phase 2: rate as many as fit in the remaining budget.
  while (Date.now() - started < TIME_BUDGET_MS) {
    const nextRespId = await findNextUnratedResponse();
    if (nextRespId === null) break;
    const r = await rateOne(nextRespId);
    if (r.ok) report.ratedResponses++;
    else report.rateFailures++;

    // Stop early if we're running low on time; rater calls average ~2s.
    if (Date.now() - started > TIME_BUDGET_MS - 3000) {
      report.earlyExit = true;
      break;
    }
  }

  const status = await todayStatus();

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    ...report,
    status,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
