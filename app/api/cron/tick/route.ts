import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin, isAuthorizedCron } from "@/lib/auth";
import { collectSample, findNextPendingSample } from "@/lib/collector";
import { findNextUnratedResponse, rateOne } from "@/lib/rater";
import { todayStatus } from "@/lib/orchestration";

/**
 * POST /api/cron/tick
 *
 * Invoked every 10 minutes by GitHub Actions during the tick window.
 * Drains the work queue as much as fits into the serverless time budget.
 *
 * Phase order is RATE FIRST, COLLECT SECOND. Earlier this script ran
 * collect-then-rate, which on bad days produced zero ratings: a slow
 * GLM call past the collect deadline would push the function past the
 * 300s Vercel ceiling and Vercel would kill it with HTTP 504 before
 * the rate phase ever started, leaving a whole day of collected rows
 * unrated. Putting rate first means even a tick that 504s during
 * collection has already drained some unrated rows in its first ~60s.
 *
 * Phases:
 *   1. "rate" — drain unrated responses up to a cap (60s wall time or
 *      30 rows, whichever first). Cheap calls (~1-2s each on Groq).
 *      The cap exists so a backlog of 200 unrated rows can't starve
 *      collection on the same tick.
 *   2. "collect" — round-robin (least-progressed run first) so a slow
 *      model can't monopolize consecutive ticks. Each sample runs with
 *      a per-sample deadline; the collector also self-bounds each
 *      chatCall to fit inside the remaining sample budget so a single
 *      slow call can't blow past the function ceiling.
 *
 * Access: cron bearer secret OR admin cookie.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

// Total budget for the whole tick. Headroom under the 300s Pro ceiling
// for the final response and any in-flight DB writes. Beyond this we
// must return — Vercel will otherwise terminate the function with 504.
const TICK_BUDGET_MS = 280_000;

// Phase 1 (rate-first) caps — never run for longer than this in the
// rate phase, regardless of how much work is queued. Without the cap,
// a 200-row unrated backlog (~7 min) would consume the entire tick and
// no collection would happen.
const RATE_PHASE_BUDGET_MS = 60_000;
const RATE_PHASE_MAX_ROWS = 30;

// Per-sample wall-clock cap. A slow model gets at most one chunk of
// this size per tick before we yield to a different run.
const PER_SAMPLE_BUDGET_MS = 90_000;

// If less than this much budget remains, don't START a new collect
// iteration — kicking one off would risk overrunning the function
// ceiling. We'd rather return cleanly with a partial report than be
// killed mid-call by Vercel and return nothing.
const COLLECT_MIN_START_BUDGET_MS = 30_000;

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req) && !isAuthorizedAdmin()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  type SampleReport = {
    runId: number;
    sampleIndex: number;
    durationMs: number;
    succeeded: number;
    failed: number;
    partial: boolean;
  };

  const report = {
    ratedResponses: 0,
    rateFailures: 0,
    collectedSamples: [] as SampleReport[],
    collectErrors: [] as Array<{ runId: number; sampleIndex: number; error: string }>,
    earlyExit: false,
  };

  // Phase 1: RATE FIRST. Even if Phase 2 explodes (504, throw, infinite
  // loop on a misbehaving provider), the most-recent collected rows
  // get scored. Inter-rater reliability is the whole point of the
  // study; an unrated collected row is a hole in the dataset.
  const rateDeadline = started + RATE_PHASE_BUDGET_MS;
  while (Date.now() < rateDeadline && report.ratedResponses + report.rateFailures < RATE_PHASE_MAX_ROWS) {
    const nextRespId = await findNextUnratedResponse().catch(() => null);
    if (nextRespId === null) break;
    try {
      const r = await rateOne(nextRespId);
      if (r.ok) report.ratedResponses++;
      else report.rateFailures++;
    } catch {
      report.rateFailures++;
      // Don't abort the rate loop on a single rater throw — try the
      // next row. The rater also writes raterRatedAt on its own catch
      // path, so a row that can't be rated won't be re-picked.
    }
  }

  // Phase 2: collect. Round-robin scheduler in findNextPendingSample
  // ensures fairness across runs. The collector self-bounds each
  // chatCall to fit inside the remaining sample budget.
  const collectDeadline = started + (TICK_BUDGET_MS - 5_000);
  while (Date.now() < collectDeadline) {
    const remaining = collectDeadline - Date.now();
    if (remaining < COLLECT_MIN_START_BUDGET_MS) {
      // Not enough left to safely start a new sample iteration. Return
      // cleanly instead of starting a call that might 504 the function.
      report.earlyExit = true;
      break;
    }

    const next = await findNextPendingSample();
    if (!next) break;

    const sampleDeadlineMs = Date.now() + Math.min(PER_SAMPLE_BUDGET_MS, remaining);

    try {
      const r = await collectSample(next.runId, next.sampleIndex, {
        deadlineMs: sampleDeadlineMs,
      });
      report.collectedSamples.push({
        runId: r.runId,
        sampleIndex: r.sampleIndex,
        durationMs: r.durationMs,
        succeeded: r.succeeded,
        failed: r.failed,
        partial: r.partial,
      });

      // Forward-progress guard: if a sample reported zero attempts
      // (deadline already passed), looping would re-call findNext and
      // possibly return the same row, wasting a DB round-trip.
      if (r.attempted === 0) break;
    } catch (err) {
      report.collectErrors.push({
        runId: next.runId,
        sampleIndex: next.sampleIndex,
        error: err instanceof Error ? err.message : String(err),
      });
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
