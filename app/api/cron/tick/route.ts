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
 * Phases:
 *   1. "collect" — loop over pending samples, fairly. findNextPendingSample
 *      is round-robin (least-progressed run first) so a slow model like
 *      GLM 4.5 Air can't monopolize consecutive ticks. Each sample runs
 *      with a per-sample deadline so a slow model gets ONE chunk per
 *      tick before we yield to the next pending run. Persisted progress
 *      means the same run resumes on the next tick from where this one
 *      left off (resume-fast path in the collector loop).
 *   2. "rate" — rate already-collected responses in the remaining budget.
 *      Each rating call is fast (~1–2s on Groq) so a partial collect
 *      tick still produces inter-rater data for the rows it just filled.
 *
 * Access: cron bearer secret OR admin cookie.
 */

export const runtime = "nodejs";
// 300s is the Pro-plan ceiling; on Hobby Vercel silently caps at 60s.
// Setting 300 here is harmless on either plan; combined with per-sample
// deadlines and the collector's resume-fast path, the function returns
// gracefully under both ceilings.
export const maxDuration = 300;

// Total budget for the whole tick. Headroom under the 300s Pro ceiling
// for the final response and any in-flight DB writes.
const TICK_BUDGET_MS = 280_000;

// Reserve at least this much budget for the rate phase so a tick that
// just filled a bunch of rows produces inter-rater data the same tick
// rather than waiting for the next one.
const RATE_PHASE_RESERVE_MS = 40_000;

// Per-sample wall-clock cap. A slow model (GLM, ~49s/call * 21 prompts
// = ~17 min) gets at most one chunk of this size per tick before we
// yield to a different run. Sized to fit ~4–5 GLM prompts and a full
// fast-model sample (Llama 3.3 70B at ~3.7s * 21 = ~78s → completes).
const PER_SAMPLE_BUDGET_MS = 90_000;

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req) && !isAuthorizedAdmin()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const collectDeadline = started + (TICK_BUDGET_MS - RATE_PHASE_RESERVE_MS);

  type SampleReport = {
    runId: number;
    sampleIndex: number;
    durationMs: number;
    succeeded: number;
    failed: number;
    partial: boolean;
  };

  const report = {
    collectedSamples: [] as SampleReport[],
    collectErrors: [] as Array<{ runId: number; sampleIndex: number; error: string }>,
    ratedResponses: 0,
    rateFailures: 0,
    earlyExit: false,
  };

  // Phase 1: collect.
  // Loop until we either run out of pending samples or we'd risk eating
  // into the rate-phase reserve. Each iteration picks the least-progressed
  // pending run; collectSample bails at its per-sample deadline; the next
  // iteration picks a different run because the one we just touched now
  // has more filled responses than its peers.
  while (Date.now() < collectDeadline) {
    const next = await findNextPendingSample();
    if (!next) break;

    const remaining = collectDeadline - Date.now();
    const sampleDeadlineMs = Date.now() + Math.min(PER_SAMPLE_BUDGET_MS, remaining);

    try {
      // No pacingMs override — collectSample uses the provider's own
      // floor (e.g. SambaNova 3.5s, Mistral 600ms, Groq 500ms). Hardcoding
      // 500ms here used to trip SambaNova's RPM cap; per-provider pacing
      // is now the source of truth.
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

      // Forward-progress guard. If a sample reported zero attempts (we
      // hit the deadline before even starting prompt #1), looping would
      // re-call findNextPendingSample which can return the same row,
      // wasting a DB round-trip. Just break and move on to rating.
      if (r.attempted === 0) break;
    } catch (err) {
      // Per-sample hard error (e.g. run row missing, model not in panel).
      // Record it but DON'T abort the whole tick — the next iteration may
      // pick a healthy run, and rating phase still has work to do.
      report.collectErrors.push({
        runId: next.runId,
        sampleIndex: next.sampleIndex,
        error: err instanceof Error ? err.message : String(err),
      });
      // Avoid spinning on the same broken run for the rest of the tick.
      break;
    }
  }

  // Phase 2: rate as many as fit in the remaining budget.
  while (Date.now() - started < TICK_BUDGET_MS - 3_000) {
    const nextRespId = await findNextUnratedResponse();
    if (nextRespId === null) break;
    const r = await rateOne(nextRespId);
    if (r.ok) report.ratedResponses++;
    else report.rateFailures++;
  }

  if (Date.now() - started >= TICK_BUDGET_MS - 3_000) {
    report.earlyExit = true;
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
