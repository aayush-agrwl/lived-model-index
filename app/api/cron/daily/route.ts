import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron, isAuthorizedAdmin } from "@/lib/auth";
import { bootstrapDailyRuns, todayUtc } from "@/lib/orchestration";
import { findNextPendingSample } from "@/lib/collector";
import { collectSample } from "@/lib/collector";
import { findNextUnratedResponse, rateOne } from "@/lib/rater";

/**
 * POST /api/cron/daily
 *
 * Invoked once per day (UTC) by the Vercel Cron (vercel.json) and
 * optionally from GitHub Actions. This route:
 *
 *   1. Bootstraps today's runs and placeholder response rows (idempotent).
 *   2. Immediately drains the work queue within the remaining time budget,
 *      just like the tick endpoint does. This makes the pipeline self-
 *      sufficient on Vercel's own cron infrastructure — the GitHub Actions
 *      tick workflow is now a supplementary fast-path, not a hard dependency.
 *
 * Why this matters: the tick workflow requires a SITE_URL GitHub Actions
 * secret pointing at the live Vercel deployment URL. If that secret is
 * stale (e.g. after a redeploy changed the canonical URL) every tick curl
 * call fails with "URL malformed" (exit code 3) before reaching the server.
 * Embedding collection here means Vercel's own cron always makes progress
 * even when the GitHub Actions secret is misconfigured.
 *
 * Time budget: on Pro the function can run up to 300s; on Hobby Vercel
 * silently caps it at 60s. Either way we make as much forward progress as
 * the platform allows and rely on the tick for the remainder.
 *
 * Access: cron bearer secret OR admin cookie.
 */

export const runtime = "nodejs";
// 300s on Pro; silently capped at 60s on Hobby — harmless either way.
export const maxDuration = 300;

// Leave headroom for the final response and any in-flight DB writes.
const COLLECT_BUDGET_MS = 270_000;

// Reserve at least this much for the rate phase so a daily run that
// just filled rows produces inter-rater data immediately.
const RATE_PHASE_RESERVE_MS = 40_000;

// Per-sample wall-clock cap. Sized so the round-robin loop touches every
// pending run inside one daily call before re-visiting the slow ones.
const PER_SAMPLE_BUDGET_MS = 90_000;

export async function POST(req: NextRequest) {
  let authed = false;
  try {
    authed = isAuthorizedCron(req) || isAuthorizedAdmin();
  } catch {
    // isAuthorizedAdmin throws if ADMIN_PASSWORD env var is missing;
    // fall back to cron-only auth so the endpoint is still callable.
    try { authed = isAuthorizedCron(req); } catch { authed = false; }
  }
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const date = dateParam ?? todayUtc();

  const started = Date.now();

  // Phase 1: bootstrap today's runs and response placeholders.
  let bootstrapResult;
  try {
    bootstrapResult = await bootstrapDailyRuns(date);
  } catch (err) {
    return NextResponse.json(
      { ok: false, phase: "bootstrap", error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // Phase 2: collect as many pending samples as fit in the time budget.
  // Same round-robin + per-sample deadline pattern as /api/cron/tick:
  //   - findNextPendingSample picks the least-progressed run (fairness).
  //   - Each sample bails at its per-sample deadline; the next iteration
  //     picks a different run because the touched run now has more
  //     filled responses than its peers.
  //   - No pacingMs override; the collector applies the provider-specific
  //     floor (SambaNova 3.5s, Google 7s, etc.) which the previous
  //     hardcoded 500ms used to trample.
  const collectReport: Array<{
    runId: number;
    sampleIndex: number;
    succeeded: number;
    failed: number;
    partial: boolean;
  }> = [];
  let ratedResponses = 0;
  let rateFailures = 0;

  const collectPhaseDeadline = started + (COLLECT_BUDGET_MS - RATE_PHASE_RESERVE_MS);
  while (Date.now() < collectPhaseDeadline) {
    const nextSample = await findNextPendingSample().catch(() => null);
    if (!nextSample) break;

    const remaining = collectPhaseDeadline - Date.now();
    const sampleDeadlineMs = Date.now() + Math.min(PER_SAMPLE_BUDGET_MS, remaining);

    try {
      const r = await collectSample(nextSample.runId, nextSample.sampleIndex, {
        deadlineMs: sampleDeadlineMs,
      });
      collectReport.push({
        runId: r.runId,
        sampleIndex: r.sampleIndex,
        succeeded: r.succeeded,
        failed: r.failed,
        partial: r.partial,
      });
      if (r.attempted === 0) break;
    } catch {
      // Per-sample hard error — leave the rest of the queue for /tick
      // and proceed to rating instead of aborting the whole bootstrap.
      break;
    }
  }

  // Phase 3: rate collected responses within remaining budget.
  while (Date.now() - started < COLLECT_BUDGET_MS - 3_000) {
    const nextRespId = await findNextUnratedResponse().catch(() => null);
    if (nextRespId === null) break;
    const r = await rateOne(nextRespId);
    if (r.ok) ratedResponses++;
    else rateFailures++;
  }

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - started,
    ...bootstrapResult,
    collectReport,
    ratedResponses,
    rateFailures,
  });
}

// Accept GET for ease of manual testing in the browser once logged in.
export async function GET(req: NextRequest) {
  return POST(req);
}
