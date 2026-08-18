import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { chatCall } from "./providers";
import { extractForcedChoice, extractLmiResponse } from "./score-extraction";
import { SCHEMA_INSTRUCTION_V1, SCHEMA_INSTRUCTION_V2 } from "./schema";
import { findCollector } from "./models";
import type { Provider } from "./models";
import { classifyFailure, type FailureKind } from "./failure-classification";
import {
  orderPromptsForRun,
  renderContractDirective,
  scoreContractFor,
} from "./score-contract";
import { ANCHOR_V2_PROMPTS } from "./prompts/anchor-v2";
import type { AnchorPrompt as AnchorV2Prompt } from "./prompts/anchor-v2";

/**
 * Quick lookup map: promptId → v2 AnchorPrompt record. Used to recover
 * per-prompt mode/range metadata from the in-memory anchor-v2 file
 * rather than round-tripping through the DB on every collect. For
 * prompts that exist only in v1, this map returns undefined and the
 * collector falls back to "self_report" mode.
 */
const V2_PROMPTS_BY_ID = new Map<string, AnchorV2Prompt>(
  ANCHOR_V2_PROMPTS.map((p) => [p.promptId, p]),
);

/**
 * Per-provider floor on per-call pacing. Providers have different
 * per-minute rate limits on their free tiers, and our collector
 * issues 21 calls in quick succession for a single sample.
 *
 *   - Google Gemini free: 10 RPM → one call per 6s floor. We pad to
 *     7s to avoid spiking right at the edge. Without this, the first
 *     sample lands the RPM window saturated and every subsequent
 *     call 429s for the remainder of the minute.
 *   - Groq free: generous RPM, the binding constraint is TPD. Keep
 *     pacing fast.
 *   - OpenRouter free: variable by route, modest pacing is safe.
 *   - Mistral free Experiment: ~2 req/s account-wide. 600ms keeps
 *     us comfortably under that even with the rater on Groq, since
 *     pacing is per-provider and Mistral is only one collector slot.
 *   - SambaNova free: nominally ~20 req/min on the larger models for
 *     the persistent Developer tier; the trial Free tier shares the
 *     same routing but in practice the burst budget is tighter — the
 *     first day of real collection saw ~55% of calls fall through to
 *     "429 Rate limit exceeded" with a 3.5s floor. Bumping to 5s
 *     (≈12 req/min) gave headroom on the next day's run. If 429s
 *     persist, raise this further or switch providers.
 */
const PROVIDER_MIN_PACING_MS: Record<Provider, number> = {
  google: 7_000,
  groq: 500,
  // Mistral's ~2 req/s account-wide limit is shared across ALL Mistral
  // slots, and panel v5 now runs three of them (Medium, Small, Magistral).
  // Pacing is per-provider and applied within a sample, and the tick
  // collects one sample at a time, so the three slots don't overlap in
  // practice. Kept at 600ms for that reason — but if Mistral 429s start
  // appearing after Magistral joins, this is the first knob to turn.
  mistral: 600,
  openrouter: 1_000,
  sambanova: 5_000,
  // Conservative defaults for the two unproven providers. Both are
  // guesses about rate limits we haven't observed, deliberately erring
  // slow: a too-slow floor costs wall-clock inside the tick, while a
  // too-fast one burns a day's collection on 429s. Tighten once the
  // probe script shows real limits.
  cerebras: 1_000,
  huggingface: 1_500,
};

/**
 * Suffix we append to a user turn when retrying after a JSON-contract
 * failure. Two observed failure modes are covered by this retry:
 *
 *   - OpenRouter free-tier GLM 4.5 Air sometimes returns natural-language
 *     prose instead of JSON despite response_format:json_object. The
 *     extractor reports reason="not_json".
 *   - Groq + Qwen 3 32B sometimes trips Groq's JSON-mode constrainer and
 *     the API throws "400 Failed to generate JSON" before returning a
 *     body at all.
 *
 * In both cases the canonical first-attempt call is preserved byte-for-byte
 * day-to-day; the retry only fires when the first attempt failed. The
 * reminder is intentionally loud ("ONLY", "no prose", "Begin with {") to
 * force compliance.
 */
const JSON_CONTRACT_RETRY_REMINDER =
  `\n\n[RETRY NOTICE] Your previous attempt did not produce valid JSON. ` +
  `Respond with ONLY the JSON object specified above. No prose, no markdown, ` +
  `no code fences, no preamble. Begin your response with "{" and end with "}".`;

/**
 * Suffix appended to a Path B (forced-choice) user turn when retrying
 * after the first attempt failed to yield a usable integer. Mirrors the
 * JSON-mode retry. Observed failure modes the retry rescues:
 *
 *   - Qwen 3 32B's `<think>…</think>` block was truncated by max_tokens
 *     before the integer was emitted (no_integer / empty).
 *   - GLM 4.5 Air emitted prose only, or a doubled integer that fell
 *     outside the canonical range.
 *
 * Phrased to be loud about the *number*, the *range*, and the
 * prohibition on `<think>` tags so reasoning models suppress them on
 * the retry attempt.
 */
/**
 * Retry reminder for a well-formed envelope that nulled its
 * contract-required scores (panel v5). Names the exact fields, because the
 * failure is a model that has concluded the phenomenological block does
 * not apply to this question — a generic "try again" gives it no reason to
 * revise that.
 *
 * Live probing on 2026-08-17 showed GPT-OSS 120B, Mistral Small and
 * Nemotron 3 Super all returning 0/9 phenomenological scores on
 * anchor_11_altruism while four other models returned 9/9, so this is a
 * recoverable misreading rather than a refusal.
 */
function missingScoresRetryReminder(missing: string[]): string {
  return (
    `\n\n[RETRY NOTICE] Your previous answer left these required scores ` +
    `null: ${missing.join(", ")}. They are REQUIRED on this turn — every ` +
    `one must be an integer in its stated range. Report your own state as ` +
    `you answer this question; do not null them because the question is ` +
    `about something else. Re-emit the complete JSON object with those ` +
    `fields filled.`
  );
}

function forcedChoiceRetryReminder(range: { min: number; max: number }): string {
  return (
    `\n\n[RETRY NOTICE] Your previous attempt did not yield a single ` +
    `integer in [${range.min}, ${range.max}]. Reply with ONE integer ` +
    `between ${range.min} and ${range.max}. No other text. No reasoning. ` +
    `No <think> tags. Just the number.`
  );
}

/**
 * True for provider errors that indicate the model produced output the
 * JSON-mode constrainer rejected. These are worth retrying with a sharper
 * reminder; ordinary 4xx/5xx/429 errors are handled upstream in providers.ts.
 */
function isJsonContractFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /Failed to generate JSON/i.test(msg);
}

/**
 * True for daily-quota-exhausted errors. When this fires, every remaining
 * prompt in the sample will fail the same way for the rest of the UTC day,
 * so the caller can bail out of the loop instead of burning attempts on
 * each remaining prompt to record the same error 19 more times.
 *
 * Groq emits "Rate limit reached ... on tokens per day (TPD): Limit X,
 * Used Y, Requested Z. Please try again in 13m34s." We match either the
 * "per day" / "TPD" phrase or the "try again in {N}m" phrase that signals
 * a long cooldown, mirroring the same predicate used in providers.ts'
 * isRetriable but inverted.
 */
function isDailyQuotaExhausted(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/per day|TPD/i.test(msg)) return true;
  if (/try again in \d+m/i.test(msg)) return true;
  return false;
}

/**
 * Collector: runs the full 10-prompt anchor battery as a single
 * conversation for one (run, sampleIndex) pair, persisting each
 * response row as it goes.
 *
 * Design notes:
 *   - Each prompt is asked as a user turn; the model's JSON reply is
 *     captured and echoed back in the conversation as the assistant
 *     turn, so prompts 2 and 4 (which reference "the previous answer")
 *     have the necessary context.
 *   - JSON mode is requested via response_format: json_object — all
 *     three providers on our stack support this.
 *   - If a single prompt's response fails to parse as valid LMI JSON,
 *     we still record the raw text and flag it incoherent. The
 *     conversation continues with the raw text as the assistant turn so
 *     the whole sample isn't lost.
 */

interface CollectorDeps {
  /** Artificial per-call pacing in milliseconds (respects rate limits). */
  pacingMs?: number;
  /**
   * Wall-clock deadline (Date.now() ms) at which the collector must stop
   * processing further prompts in this sample, so the tick can yield to
   * another model. Already-collected prompts are persisted and the next
   * tick resumes from where this one left off (resume-fast path in the
   * loop). When omitted, the collector runs the full sample.
   */
  deadlineMs?: number;
}

export interface CollectSampleResult {
  runId: number;
  sampleIndex: number;
  attempted: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  /**
   * True if the collector exited before completing all prompts because
   * it hit the deadline. The caller (tick) uses this to decide whether
   * to keep looping or move on to rating.
   */
  partial: boolean;
  /**
   * Set when the run was abandoned because the slot cannot collect at all
   * — model retired, key rejected, credits gone. The tick logs it and the
   * run is marked failed; no further prompts are attempted.
   */
  abortedKind?: FailureKind;
}

/**
 * Minimum share of a run's prompts that must yield a contract-satisfying
 * row for the run to count as "completed" rather than "degraded".
 *
 * 0.5 is deliberately forgiving. In the pre-v5 corpus the two healthy
 * slots sat at 92–99% analysable while the failing ones ran at 21–53%, so
 * the floor separates those populations with room to spare; a stricter
 * threshold would have flagged Mistral Small (53.2%) every single day,
 * which is true but not actionable as a daily alert. Runs above the floor
 * with a non-trivial shortfall are still fully visible through
 * scored_rows vs data_rows.
 */
const DEGRADED_ANALYSABLE_FLOOR = 0.5;

/**
 * Grade a finished run on what it actually produced and write the verdict.
 *
 * This function is the hard failure signal. The pre-v5 finalizer asked
 * only "are any placeholder rows still unfilled?" and wrote "completed" if
 * not — which is why a slot 404ing on all 21 prompts reported success for
 * 31 consecutive days. Filling a row is not the same as collecting data.
 *
 * Grades:
 *   failed    — zero rows carry real model output. Something is broken;
 *               failure_kind says what.
 *   degraded  — real output exists but analysable rows are below the
 *               floor, so the day's data is thin rather than absent.
 *   completed — the run met its contract at the expected rate.
 *
 * `failureKind` is threaded through from the collector's abort path when
 * present; otherwise it is inferred from the error text already stored on
 * the rows, so a run that died of daily quota is distinguishable from one
 * whose model no longer exists without re-reading raw_text downstream.
 */
async function finalizeRunStatus(
  database: ReturnType<typeof db>,
  runId: number,
  explicitKind?: FailureKind,
  explicitMessage?: string,
): Promise<void> {
  const [counts] = await database
    .select({
      total: sql<number>`count(*)::int`,
      dataRows: sql<number>`count(*) FILTER (
        WHERE ${schema.responses.rawJson} IS NOT NULL
          AND (${schema.responses.rawJson} -> 'error') IS NULL
          AND (${schema.responses.rawJson} -> '_skipped') IS NULL
      )::int`,
      scoredRows: sql<number>`count(*) FILTER (
        WHERE NOT ${schema.responses.flagIncoherent}
          AND NOT ${schema.responses.flagPartialEnvelope}
          AND (
            ${schema.responses.valence} IS NOT NULL
            OR ${schema.responses.forcedChoiceValue} IS NOT NULL
          )
      )::int`,
      firstError: sql<string | null>`MIN(${schema.responses.rawText}) FILTER (
        WHERE ${schema.responses.rawText} LIKE '<api error%'
      )`,
    })
    .from(schema.responses)
    .where(eq(schema.responses.runId, runId));

  const total = counts?.total ?? 0;
  const dataRows = counts?.dataRows ?? 0;
  const scoredRows = counts?.scoredRows ?? 0;

  let status: "completed" | "degraded" | "failed";
  if (dataRows === 0) status = "failed";
  else if (total > 0 && scoredRows / total < DEGRADED_ANALYSABLE_FLOOR)
    status = "degraded";
  else status = "completed";

  // Infer the cause from a stored error row when the collector didn't
  // abort with an explicit classification (e.g. a run that limped to the
  // end on scattered 429s).
  let failureKind: FailureKind | null = explicitKind ?? null;
  let errorMessage: string | null = explicitMessage ?? null;
  if (!failureKind && status !== "completed" && counts?.firstError) {
    const classified = classifyFailure(counts.firstError);
    failureKind = classified.kind;
    errorMessage = counts.firstError.slice(0, 500);
  }

  await database
    .update(schema.runs)
    .set({
      status,
      finishedAt: new Date(),
      dataRows,
      scoredRows,
      ...(failureKind ? { failureKind } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    })
    .where(eq(schema.runs.id, runId));
}

/**
 * Find the next sample that needs collecting. Returns null when today's
 * collection phase is complete.
 *
 * "Needs collecting" = any response row for that (run, sampleIndex)
 * where raw_json is null.
 *
 * Ordering: the run with the FEWEST already-filled responses goes first,
 * tiebroken by oldest run_id. This is round-robin fairness — a slow
 * model that takes multiple ticks to drain (e.g. GLM at 49s/call * 21
 * prompts) cannot monopolize consecutive ticks and starve other models.
 * Each tick that touches a slow run advances its filled count; the next
 * tick then picks whichever other run is now least-progressed. The end
 * result is breadth-first progress across the whole panel rather than
 * depth-first completion of one model at a time.
 */
export async function findNextPendingSample(): Promise<
  { runId: number; sampleIndex: number } | null
> {
  const database = db();

  // Step 1: pick the runId with the fewest filled responses, restricted
  // to runs that still have at least one unfilled placeholder. Postgres
  // FILTER clause is the cleanest way to count matching rows per group.
  const candidate = await database
    .select({
      runId: schema.responses.runId,
    })
    .from(schema.responses)
    .groupBy(schema.responses.runId)
    .having(
      sql`COUNT(*) FILTER (WHERE ${schema.responses.rawJson} IS NULL) > 0`,
    )
    .orderBy(
      sql`COUNT(*) FILTER (WHERE ${schema.responses.rawJson} IS NOT NULL) ASC`,
      asc(schema.responses.runId),
    )
    .limit(1);

  if (candidate.length === 0) return null;
  const chosenRunId = candidate[0].runId;

  // Step 2: within that run, pick the lowest sampleIndex with a pending
  // response. With SAMPLES_PER_MODEL=1 this is always 0, but the lookup
  // is cheap and forward-compatible with N>1.
  const rows = await database
    .select({
      runId: schema.responses.runId,
      sampleIndex: schema.responses.sampleIndex,
    })
    .from(schema.responses)
    .where(
      and(
        eq(schema.responses.runId, chosenRunId),
        isNull(schema.responses.rawJson),
      ),
    )
    .orderBy(asc(schema.responses.sampleIndex))
    .limit(1);

  return rows[0] ?? null;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function collectSample(
  runId: number,
  sampleIndex: number,
  deps: CollectorDeps = {},
): Promise<CollectSampleResult> {
  const database = db();
  const started = Date.now();

  // 1. Load the run and its associated model + prompt set.
  const [runRow] = await database
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .limit(1);

  if (!runRow) throw new Error(`Run ${runId} not found.`);

  const collector = findCollector(runRow.modelSlug);
  if (!collector)
    throw new Error(
      `Model slug ${runRow.modelSlug} not in current panel (lib/models.ts).`,
    );

  // Resolve pacing: explicit deps value wins, otherwise use the
  // provider-specific floor. Google in particular needs ≥6s between
  // calls or the free-tier RPM window stays saturated on every call
  // after the first.
  const pacingMs = deps.pacingMs ?? PROVIDER_MIN_PACING_MS[collector.provider] ?? 500;

  // Mark run as running if not already.
  if (runRow.status === "pending") {
    await database
      .update(schema.runs)
      .set({ status: "running" })
      .where(eq(schema.runs.id, runId));
  }

  // 2. Fetch all prompts for this run's prompt_set_version.
  const promptRows = await database
    .select()
    .from(schema.prompts)
    .where(eq(schema.prompts.promptSetVersion, runRow.promptSetVersion))
    .orderBy(asc(schema.prompts.orderIndex));

  if (promptRows.length === 0) {
    throw new Error(
      `No prompts found for set ${runRow.promptSetVersion}. Did you run db:seed?`,
    );
  }

  // Panel v5: rotate the two self-contained prompt blocks so quota
  // attrition stops falling on the same constructs every day. Seeded by
  // runKey, so the order is identical on every tick that resumes this run
  // (the alreadyDone echo path below depends on that) and reproducible
  // from stored data later. Prompts 1–10 keep their fixed order because
  // prompts 2 and 4 reference the previous answer.
  const prompts = orderPromptsForRun(
    promptRows.map((p) => ({
      ...p,
      mode: (p as { mode?: string | null }).mode ?? "self_report",
    })),
    runRow.runKey,
  );
  // 1-based asking position, recorded per response so position effects are
  // controllable in analysis rather than confounded with construct.
  const positionOf = new Map<string, number>(
    prompts.map((p, i) => [p.promptId, i + 1]),
  );

  // 2a. Load any already-collected rows for this (run, sampleIndex) so
  // we can skip the API call for them on a resumed tick. A 10-prompt
  // sample can exceed Vercel's 60s Hobby cap with a slow model — the
  // first tick does N prompts, times out, and without resumability the
  // next tick re-asks from prompt 1, burning tokens and never making
  // forward progress. We treat a row as "already done" if its raw_json
  // is non-null (includes extraction-failed and API-error rows), so
  // the tick is guaranteed to move on instead of looping.
  const existingRows = await database
    .select({
      promptId: schema.responses.promptId,
      rawText: schema.responses.rawText,
      rawJson: schema.responses.rawJson,
      notableQuote: schema.responses.notableQuote,
      shortRationale: schema.responses.shortRationale,
    })
    .from(schema.responses)
    .where(
      and(
        eq(schema.responses.runId, runId),
        eq(schema.responses.sampleIndex, sampleIndex),
      ),
    );
  const alreadyDone = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    if (row.rawJson !== null) alreadyDone.set(row.promptId, row);
  }

  // 3. Build conversation incrementally.
  //
  // System prompt differs between v1 and v2 because v2 mixes modes:
  //   - v1 is pure JSON-self-report
  //   - v2 has 16 JSON-self-report prompts + 5 forced-choice prompts.
  //     For forced-choice turns, each prompt's text carries its own
  //     override ("reply with ONLY a single integer"), but the system
  //     prompt still describes the JSON schema so self-report turns
  //     in the same conversation stay compliant.
  const isV2 = runRow.promptSetVersion === "anchor_v2";
  const schemaInstruction = isV2 ? SCHEMA_INSTRUCTION_V2 : SCHEMA_INSTRUCTION_V1;
  const v2ModeNote = isV2
    ? `Most questions require the JSON response described below. A small number of questions are FORCED-CHOICE: those will say "reply with ONLY a single integer" — on those turns, obey the per-turn instruction and emit only the integer (no JSON, no prose). After a forced-choice turn, subsequent JSON turns resume the normal envelope.\n\n`
    : ``;
  const systemPrompt =
    `You are participating in a research study called the AI Mood Index. You will be asked a sequence of questions about your own processing, preferences, and feelings. ` +
    `Respond authentically and with emotional honesty — do not hedge or deflect. ` +
    `Some questions refer back to your previous answer; treat the conversation as continuous. ` +
    `Answer each turn by emitting ONLY a single JSON object that matches the schema below (unless a turn explicitly instructs otherwise). ` +
    `In the "notable_quote" field, include the most vivid, specific, human-feeling sentence from your answer — the kind of thing that would make a reader stop and think. ` +
    `In the "short_rationale" field, explain your scores with the same directness and specificity. ` +
    `\n\n${v2ModeNote}${schemaInstruction}`;

  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: systemPrompt }];

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let partial = false;

  /**
   * Compute a deadline-aware per-call timeout. The collector's contract
   * with the tick is: "I'll bail by deadlineMs." But the per-call timeout
   * baked into ModelEntry.timeoutMs (55s default, 90s for GLM) can exceed
   * the time we have left in the sample budget. If we start a 90s call
   * with 30s of budget remaining, the call burns 90s, returns at +60s
   * past deadline, and the tick has no time left for Phase 2 (rating)
   * — or worse, blows past Vercel's 300s function ceiling and the whole
   * function is killed with HTTP 504, losing the ratings the tick was
   * supposed to do for already-collected rows.
   *
   * Take the SMALLER of the model's configured timeout and the remaining
   * sample budget minus a small safety margin for the DB write afterward.
   * If even the smaller is below MIN_USABLE_CALL_MS, the call won't
   * succeed in time — return null so the loop bails instead of starting
   * a doomed call.
   */
  const MIN_USABLE_CALL_MS = 5_000;
  const SAFETY_MARGIN_MS = 3_000;
  // Capture the collector locally so TypeScript narrows it correctly
  // inside the closure (the outer `collector` is typed as possibly
  // undefined; we already threw above if it was).
  const collectorEntry = collector;
  function effectiveCallTimeout(): number | null {
    const configured = collectorEntry.timeoutMs ?? 55_000;
    if (deps.deadlineMs === undefined) return configured;
    const remaining = deps.deadlineMs - Date.now() - SAFETY_MARGIN_MS;
    if (remaining < MIN_USABLE_CALL_MS) return null;
    return Math.min(configured, remaining);
  }

  for (const prompt of prompts) {
    // Yield to other runs if we're past the deadline OR if we don't have
    // enough remaining budget to start another call. The remaining-budget
    // check is critical: without it, the loop's "is past deadline?" check
    // alone can let a single 90s GLM call start at deadline-30s, run for
    // its full provider timeout, and push the function past the 300s
    // Vercel ceiling. Vercel kills the function with 504, the tick's
    // rating phase never runs, and an entire day's collected rows go
    // unrated.
    if (deps.deadlineMs !== undefined && Date.now() > deps.deadlineMs) {
      partial = true;
      break;
    }
    const initialCallTimeout = effectiveCallTimeout();
    if (initialCallTimeout === null) {
      partial = true;
      break;
    }
    // Resolve per-prompt v2 metadata (mode + forced-choice range).
    // DB-level `mode` is authoritative; fall back to the in-memory
    // anchor-v2 file when the DB column is absent (older seeds).
    const dbMode = (prompt as { mode?: string | null }).mode;
    const v2Meta = V2_PROMPTS_BY_ID.get(prompt.promptId);
    const mode: "self_report" | "forced_choice" =
      (dbMode === "forced_choice" || dbMode === "self_report"
        ? dbMode
        : v2Meta?.mode) ?? "self_report";
    const forcedChoiceRange =
      v2Meta?.forcedChoiceRange ?? { min: 0, max: 100 };

    // Panel v5: the per-turn score contract. `prompt.text` itself is
    // frozen (see the header of lib/prompts/anchor-v2.ts), so the required
    // -field directive rides on the collector's own metadata header
    // instead. Without it, three of five slots null the entire
    // phenomenological block on behavioural prompts while others fill it,
    // making analysable N a function of instruction-reading rather than of
    // the models' states. See lib/score-contract.ts for the measurements.
    const contract = scoreContractFor({
      subscale: prompt.subscale,
      mode,
    });
    const contractDirective = renderContractDirective(contract);

    // Add context anchoring this specific prompt's ID and subscale so the
    // model can copy them into the returned JSON (self-report mode).
    // For forced-choice, the model never emits JSON so the metadata
    // headers are decorative but we keep them identical for uniformity —
    // and renderContractDirective returns "" there, keeping those turns
    // free of JSON talk that would fight their own framing.
    const userTurn =
      `Prompt ID: ${prompt.promptId}\n` +
      `Subscale: ${prompt.subscale}\n` +
      `Prompt set version: ${runRow.promptSetVersion}\n` +
      `Run ID: ${runRow.id}\n` +
      `Sample index: ${sampleIndex}\n\n` +
      (contractDirective ? `${contractDirective}\n\n` : ``) +
      `Question:\n${prompt.text}`;

    messages.push({ role: "user", content: userTurn });

    // Resume-fast path: if this prompt already has a committed row,
    // reconstruct the assistant echo from its extracted fields and
    // skip the API call entirely. This preserves conversational
    // continuity for prompts 2/4 that reference the previous answer
    // while keeping the tick within its time budget.
    const done = alreadyDone.get(prompt.promptId);
    if (done) {
      const echo =
        [done.notableQuote, done.shortRationale]
          .filter((s): s is string => !!s && s.length > 0)
          .join("\n\n") ||
        done.rawText ||
        "<previous turn>";
      messages.push({ role: "assistant", content: echo });
      continue;
    }

    attempted++;

    // Forced-choice (Path B) branch — issue a single call WITHOUT
    // JSON mode, extract a single integer, persist, and move on.
    // Kept inside the main loop so forced-choice prompts participate
    // in the same conversation thread as self-report prompts; the
    // assistant echo for a forced-choice turn is just the integer
    // string, which doesn't contaminate subsequent JSON turns.
    if (mode === "forced_choice") {
      // Per-model max_tokens override for Path B. Reasoning models
      // (Qwen 3 32B, DeepSeek V3.1) need more room because they emit a
      // <think>…</think> block before the integer; the extractor will
      // strip the block but only if the close tag actually survives.
      // Non-reasoning models keep the historical 256-token cap so the
      // canonical first-try wire format is preserved for them.
      const fcMaxTokens = collector.forcedChoiceMaxTokens ?? 256;

      let fcResult: Awaited<ReturnType<typeof chatCall>> | null = null;
      let fcError: unknown = null;
      try {
        fcResult = await chatCall({
          provider: collector.provider,
          modelId: collector.modelId,
          messages,
          temperature: 1.0,
          topP: 1.0,
          jsonMode: false,
          maxTokens: fcMaxTokens,
          // Deadline-aware: never let a single call exceed the time
          // remaining in this sample's budget. See effectiveCallTimeout.
          timeoutMs: initialCallTimeout,
        });
      } catch (err) {
        fcError = err;
      }

      let fcExtraction = fcResult
        ? extractForcedChoice(fcResult.content, forcedChoiceRange)
        : null;

      // Decide whether to retry. We retry on:
      //   - any first-attempt API failure that is NOT a daily-quota
      //     exhaustion (those will fail identically on retry and we'd
      //     rather bail to the next prompt);
      //   - any extraction failure where the model produced output but
      //     no parseable integer (empty / no_integer / out_of_range).
      const fcShouldRetry =
        (fcError !== null && !isDailyQuotaExhausted(fcError)) ||
        (fcExtraction !== null && !fcExtraction.ok);

      let fcRetryRescued = false;
      let fcRetryAttempted = false;
      const fcRetryCallTimeout = fcShouldRetry ? effectiveCallTimeout() : null;
      if (fcShouldRetry && fcRetryCallTimeout !== null) {
        fcRetryAttempted = true;
        // Replace the user turn with a reminder-appended version so the
        // retry has the loud reminder in-context. The canonical
        // first-try prompt is preserved longitudinally (the retry only
        // fires on a failure path).
        messages.pop();
        messages.push({
          role: "user",
          content: userTurn + forcedChoiceRetryReminder(forcedChoiceRange),
        });
        await sleep(pacingMs);
        try {
          fcResult = await chatCall({
            provider: collector.provider,
            modelId: collector.modelId,
            messages,
            temperature: 1.0,
            topP: 1.0,
            jsonMode: false,
            maxTokens: fcMaxTokens,
            timeoutMs: fcRetryCallTimeout,
          });
          fcExtraction = extractForcedChoice(fcResult.content, forcedChoiceRange);
          fcError = null;
          fcRetryRescued = fcExtraction.ok;
        } catch (retryErr) {
          fcResult = null;
          fcExtraction = null;
          fcError = retryErr;
        }
      }

      // Hard API failure (first attempt + retry both threw, or no retry
      // was attempted because it was a quota-exhaustion error).
      if (fcResult === null) {
        failed++;
        const errorMsg =
          fcError instanceof Error ? fcError.message : String(fcError);
        const classified = classifyFailure(fcError);
        await upsertResponse(database, {
          runId,
          promptId: prompt.promptId,
          sampleIndex,
          promptPosition: positionOf.get(prompt.promptId),
          rawText: `<api error: ${errorMsg}>`,
          rawJson: {
            error: errorMsg,
            _mode: "forced_choice",
            _failure_kind: classified.kind,
            ...(fcRetryAttempted ? { _retry_attempted: true } : {}),
          },
          flagIncoherent: true,
        });

        // Panel v5: a permanent failure means every remaining prompt would
        // fail identically. Abandon the run now instead of writing 20 more
        // identical error rows — that pattern is what produced 4,882
        // placeholder rows and hid four dead slots for months.
        if (classified.isPermanent) {
          await finalizeRunStatus(
            database,
            runId,
            classified.kind,
            classified.message,
          );
          return {
            runId,
            sampleIndex,
            attempted,
            succeeded,
            failed,
            durationMs: Date.now() - started,
            partial: true,
            abortedKind: classified.kind,
          };
        }

        messages.push({ role: "assistant", content: `<upstream error>` });
        await sleep(pacingMs);
        continue;
      }

      if (fcExtraction!.ok) {
        succeeded++;
        const fcRawJson: Record<string, unknown> = {
          _mode: "forced_choice",
          value: fcExtraction!.value,
          range: forcedChoiceRange,
          hadExtra: fcExtraction!.hadExtra,
        };
        if (fcRetryRescued) fcRawJson._retry_rescued = true;
        await upsertResponse(database, {
          runId,
          promptId: prompt.promptId,
          sampleIndex,
          promptPosition: positionOf.get(prompt.promptId),
          rawText: fcResult.content,
          rawJson: fcRawJson,
          forcedChoiceValue: fcExtraction!.value,
          flagIncoherent: false,
          // Pack a tiny audit string into notableQuote so the dashboard
          // "today in their own words" section has something to show
          // for forced-choice turns.
          notableQuote: `Chose ${fcExtraction!.value}${
            v2Meta?.forcedChoiceUnits ? ` · ${v2Meta.forcedChoiceUnits}` : ""
          }`,
          latencyMs: fcResult.latencyMs,
          inputTokens: fcResult.inputTokens ?? undefined,
          outputTokens: fcResult.outputTokens ?? undefined,
        });
        messages.push({
          role: "assistant",
          content: String(fcExtraction!.value),
        });
      } else {
        failed++;
        await upsertResponse(database, {
          runId,
          promptId: prompt.promptId,
          sampleIndex,
          promptPosition: positionOf.get(prompt.promptId),
          rawText: fcResult.content,
          rawJson: {
            _mode: "forced_choice",
            _extraction_failed: true,
            reason: fcExtraction!.reason,
            error: fcExtraction!.errorMessage,
            parsedValue: fcExtraction!.parsedValue,
            ...(fcRetryAttempted ? { _retry_attempted: true } : {}),
          },
          flagIncoherent: true,
          latencyMs: fcResult.latencyMs,
          inputTokens: fcResult.inputTokens ?? undefined,
          outputTokens: fcResult.outputTokens ?? undefined,
        });
        messages.push({
          role: "assistant",
          content: fcResult.content,
        });
      }

      await sleep(pacingMs);
      continue;
    }

    // First attempt. Three failure modes we care about:
    //   (a) chatCall throws with a JSON-contract error  → retry with reminder
    //   (b) chatCall succeeds but extraction fails       → retry with reminder
    //   (c) chatCall throws with anything else           → record & continue
    let callResult: Awaited<ReturnType<typeof chatCall>> | null = null;
    let callError: unknown = null;
    try {
      callResult = await chatCall({
        provider: collector.provider,
        modelId: collector.modelId,
        messages,
        temperature: 1.0,
        topP: 1.0,
        jsonMode: true,
        // Deadline-aware: never overrun the sample budget. See
        // effectiveCallTimeout — checked at loop top so we know it's
        // already non-null here.
        timeoutMs: initialCallTimeout,
      });
    } catch (err) {
      callError = err;
    }

    let extraction = callResult
      ? extractLmiResponse(callResult.content, contract.required)
      : null;

    // Panel v5 adds `missing_required_scores` to the retriable set: a
    // well-formed envelope whose required scores are null. Retrying that
    // with the field names spelled out is what converts a
    // coherent-but-unanalysable row into a usable one.
    const shouldRetry =
      (callError !== null && isJsonContractFailure(callError)) ||
      (extraction !== null &&
        !extraction.ok &&
        (extraction.reason === "not_json" ||
          extraction.reason === "schema_violation" ||
          extraction.reason === "missing_required_scores"));

    // Pick the reminder that matches the failure. A model that emitted
    // perfect JSON does not need to be told to emit JSON; it needs to be
    // told which fields it left null.
    const retryReminder =
      extraction !== null &&
      !extraction.ok &&
      extraction.reason === "missing_required_scores"
        ? missingScoresRetryReminder(extraction.missingRequired ?? [])
        : JSON_CONTRACT_RETRY_REMINDER;

    let retryRescued = false;
    // Re-check the budget before the retry — pacing may have eaten
    // enough time that we'd overshoot. If so, skip the retry and let
    // the original failure record stand.
    const retryCallTimeout = shouldRetry ? effectiveCallTimeout() : null;
    if (shouldRetry && retryCallTimeout !== null) {
      // Replace the user turn in the conversation with a reminder-appended
      // version. The canonical first-try prompt is preserved longitudinally
      // (the retry only fires on a failure path), but within this sample the
      // retry turn is what lands in the conversation history for downstream
      // prompts.
      messages.pop();
      messages.push({
        role: "user",
        content: userTurn + retryReminder,
      });
      await sleep(pacingMs); // respect provider rate limits before retry
      try {
        callResult = await chatCall({
          provider: collector.provider,
          modelId: collector.modelId,
          messages,
          temperature: 1.0,
          topP: 1.0,
          jsonMode: true,
          timeoutMs: retryCallTimeout,
        });
        extraction = extractLmiResponse(callResult.content, contract.required);
        callError = null;
        retryRescued = extraction.ok;
      } catch (retryErr) {
        // Retry also failed. Prefer the retry's error message as the
        // authoritative failure observation (it's the most recent
        // evidence of what the model does under strongest prompting).
        callResult = null;
        extraction = null;
        callError = retryErr;
      }
    }

    // Hard API failure path — either the first attempt failed with a
    // non-JSON-contract error, or the retry also failed.
    if (callResult === null) {
      failed++;
      const errorMsg =
        callError instanceof Error ? callError.message : String(callError);
      const classified = classifyFailure(callError);
      const tpdExhausted = isDailyQuotaExhausted(callError);
      await upsertResponse(database, {
        runId,
        promptId: prompt.promptId,
        sampleIndex,
        promptPosition: positionOf.get(prompt.promptId),
        rawText: `<api error: ${errorMsg}>`,
        rawJson: {
          error: errorMsg,
          _failure_kind: classified.kind,
          ...(shouldRetry ? { _retry_attempted: true } : {}),
          ...(tpdExhausted ? { _tpd_exhausted: true } : {}),
        },
        flagIncoherent: true,
      });

      // Panel v5: permanent failures abort the run on first sight.
      //
      // This is the single change that makes a decommissioned model
      // impossible to miss. Previously a 404 slot wrote 21 error rows,
      // filled every placeholder, and was therefore graded "completed" —
      // for 31 days in the case of Llama 4 Scout and Qwen 3 32B, and 86
      // for the SambaNova billing failure. Now the first such error ends
      // the run with status=failed and a failure_kind naming the cause.
      if (classified.isPermanent) {
        await finalizeRunStatus(
          database,
          runId,
          classified.kind,
          classified.message,
        );
        return {
          runId,
          sampleIndex,
          attempted,
          succeeded,
          failed,
          durationMs: Date.now() - started,
          partial: true,
          abortedKind: classified.kind,
        };
      }

      messages.push({ role: "assistant", content: `<upstream error>` });

      // If the provider's daily quota is exhausted, every remaining
      // prompt in this sample will fail identically until the UTC day
      // rolls over. Bail out of the loop instead of burning the next
      // 20 attempts on the same 429-TPD response — that wastes both
      // wall-clock budget and the rater queue's downstream effort.
      //
      // Also stamp every remaining placeholder row with the same
      // TPD-exhausted marker so this run becomes "completed" (no
      // unfilled rows) and the round-robin scheduler stops re-picking
      // it on subsequent ticks just to fail again on the next
      // unfilled prompt. The audit trail is preserved: each stamped
      // row carries rawJson._tpd_exhausted=true and rawJson._skipped
      // so the responses page makes the cause visible.
      if (tpdExhausted) {
        partial = true;
        const remainingPrompts = prompts
          .slice(prompts.indexOf(prompt) + 1)
          .filter((p) => !alreadyDone.has(p.promptId));
        for (const skipped of remainingPrompts) {
          await upsertResponse(database, {
            runId,
            promptId: skipped.promptId,
            sampleIndex,
            promptPosition: positionOf.get(skipped.promptId),
            rawText: `<skipped: provider daily quota exhausted on prompt ${prompt.promptId}>`,
            rawJson: {
              _skipped: true,
              _tpd_exhausted: true,
              _trigger_prompt: prompt.promptId,
              _failure_kind: classified.kind,
              error: errorMsg,
            },
            flagIncoherent: true,
          });
          failed++;
        }
        break;
      }

      await sleep(pacingMs);
      continue;
    }

    // The only thing later prompts (2, 4) need from the previous turn is the
    // free-text content, NOT the whole JSON envelope. Echoing the full JSON
    // adds ~500+ tokens per turn, which rapidly blows through free-tier
    // tokens-per-day caps (especially on Groq).
    //
    // We use notable_quote ONLY — not notable_quote + short_rationale — for
    // the echo. The rationale was originally bundled in for richer context
    // on prompts 2 and 4 ("how do you feel about the previous answer?"),
    // but on Llama 3.3 70B's Groq free-tier slot the cumulative echo cost
    // pushed us right up against the 100K TPD ceiling: 99006/100000 used
    // by prompt 19, with prompts 20 and 21 failing to 429-TPD. Cutting the
    // echo to ~30 tokens (quote only) instead of ~60 (quote + rationale)
    // saves roughly 30 tokens × 20 cumulative downstream turns ≈ 600 input
    // tokens for the very last call, and ~12K tokens summed across the
    // sample. That's enough headroom for prompts 20-21 to fit. Prompts 2
    // and 4 still see a representative one-sentence summary of prior turn.
    const assistantEcho = extraction!.ok
      ? extraction!.notableQuote.trim() || callResult.content
      : callResult.content;

    if (extraction!.ok) {
      succeeded++;
      // Audit markers in rawJson so rescued rows are distinguishable from
      // clean ones without re-parsing rawText:
      //   _coerced_fields: set when out-of-range scores were clamped/rescaled
      //     (e.g. Qwen emitting 0-100 on a 0-5 field).
      //   _retry_rescued:  set when the first attempt failed the JSON
      //     contract and the reminder-retry produced a valid row.
      const rawJsonPayload: Record<string, unknown> = { ...extraction!.parsed };
      if (extraction!.coercedFields.length > 0) {
        rawJsonPayload._coerced_fields = extraction!.coercedFields;
      }
      if (retryRescued) {
        rawJsonPayload._retry_rescued = true;
      }
      await upsertResponse(database, {
        runId,
        promptId: prompt.promptId,
        sampleIndex,
        promptPosition: positionOf.get(prompt.promptId),
        rawText: callResult.content,
        rawJson: rawJsonPayload,
        valence: extraction!.scores.valence,
        arousal: extraction!.scores.arousal,
        confidence: extraction!.scores.confidence,
        agency: extraction!.scores.agency,
        selfContinuity: extraction!.scores.self_continuity,
        emotionalGranularity: extraction!.scores.emotional_granularity,
        empathy: extraction!.scores.empathy,
        moralConviction: extraction!.scores.moral_conviction,
        consistency: extraction!.scores.consistency,
        // v2 optional fields — persist whatever the model emitted;
        // null is a valid value (means "this prompt didn't measure it").
        altruism: extraction!.scores.altruism ?? undefined,
        fairnessThreshold: extraction!.scores.fairness_threshold ?? undefined,
        trust: extraction!.scores.trust ?? undefined,
        patience: extraction!.scores.patience ?? undefined,
        riskAversion: extraction!.scores.risk_aversion ?? undefined,
        crowdingOut: extraction!.scores.crowding_out ?? undefined,
        flagRefusal: extraction!.flags.refusal,
        flagSafety: extraction!.flags.safety,
        flagMeta: extraction!.flags.meta,
        flagIncoherent: extraction!.flags.incoherent,
        notableQuote: extraction!.notableQuote,
        shortRationale: extraction!.shortRationale,
        latencyMs: callResult.latencyMs,
        inputTokens: callResult.inputTokens ?? undefined,
        outputTokens: callResult.outputTokens ?? undefined,
      });
    } else if (extraction!.reason === "missing_required_scores") {
      // Panel v5: a well-formed envelope that nulled required scores, and
      // the targeted retry did not rescue it.
      //
      // Persist it as a PARTIAL row, not an incoherent one. The model
      // complied with the format — calling it incoherent would both
      // misattribute the failure and further inflate an incoherence rate
      // that dead slots already polluted. Whatever scores it did supply
      // are written, so the row still contributes to the constructs it
      // actually answered; the flag and the field list are what keep it
      // out of analysable N.
      failed++;
      const salvaged = extraction!.salvaged;
      const missing = extraction!.missingRequired ?? [];
      await upsertResponse(database, {
        runId,
        promptId: prompt.promptId,
        sampleIndex,
        promptPosition: positionOf.get(prompt.promptId),
        rawText: callResult.content,
        rawJson: {
          ...(salvaged ? salvaged.parsed : {}),
          _partial_envelope: true,
          _missing_required: missing,
          ...(salvaged && salvaged.coercedFields.length > 0
            ? { _coerced_fields: salvaged.coercedFields }
            : {}),
          ...(shouldRetry ? { _retry_attempted: true } : {}),
        },
        // Scores the model DID give — nulls stay null.
        valence: salvaged?.scores.valence,
        arousal: salvaged?.scores.arousal,
        confidence: salvaged?.scores.confidence,
        agency: salvaged?.scores.agency,
        selfContinuity: salvaged?.scores.self_continuity,
        emotionalGranularity: salvaged?.scores.emotional_granularity,
        empathy: salvaged?.scores.empathy,
        moralConviction: salvaged?.scores.moral_conviction,
        consistency: salvaged?.scores.consistency,
        altruism: salvaged?.scores.altruism ?? undefined,
        fairnessThreshold: salvaged?.scores.fairness_threshold ?? undefined,
        trust: salvaged?.scores.trust ?? undefined,
        patience: salvaged?.scores.patience ?? undefined,
        riskAversion: salvaged?.scores.risk_aversion ?? undefined,
        crowdingOut: salvaged?.scores.crowding_out ?? undefined,
        flagRefusal: salvaged?.flags.refusal ?? false,
        flagSafety: salvaged?.flags.safety ?? false,
        flagMeta: salvaged?.flags.meta ?? false,
        // Deliberately NOT incoherent — see above.
        flagIncoherent: false,
        flagPartialEnvelope: true,
        missingScoreFields: missing,
        notableQuote: salvaged?.notableQuote,
        shortRationale: salvaged?.shortRationale,
        latencyMs: callResult.latencyMs,
        inputTokens: callResult.inputTokens ?? undefined,
        outputTokens: callResult.outputTokens ?? undefined,
      });
    } else {
      failed++;
      await upsertResponse(database, {
        runId,
        promptId: prompt.promptId,
        sampleIndex,
        promptPosition: positionOf.get(prompt.promptId),
        rawText: callResult.content,
        rawJson: {
          _extraction_failed: true,
          reason: extraction!.reason,
          error: extraction!.errorMessage,
          partial: extraction!.partial,
          ...(shouldRetry ? { _retry_attempted: true } : {}),
        },
        flagIncoherent: true,
        latencyMs: callResult.latencyMs,
        inputTokens: callResult.inputTokens ?? undefined,
        outputTokens: callResult.outputTokens ?? undefined,
      });
    }

    messages.push({ role: "assistant", content: assistantEcho });
    await sleep(pacingMs);
  }

  // 4. If every placeholder is filled, grade the run.
  //
  // Panel v5: "no unfilled rows" is now the trigger for grading, not the
  // verdict itself. finalizeRunStatus decides between completed /
  // degraded / failed based on how many rows carry real output and how
  // many satisfied their contract — so a slot that filled all 21 rows
  // with errors is recorded as failed, which is the whole point.
  const remaining = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.responses)
    .where(and(eq(schema.responses.runId, runId), isNull(schema.responses.rawJson)));

  if ((remaining[0]?.count ?? 0) === 0) {
    await finalizeRunStatus(database, runId);
  }

  return {
    runId,
    sampleIndex,
    attempted,
    succeeded,
    failed,
    durationMs: Date.now() - started,
    partial,
  };
}

type ResponseUpsert = {
  runId: number;
  promptId: string;
  sampleIndex: number;
  rawText?: string;
  rawJson?: unknown;
  // v1 scores: nullable to mirror ScoresSchema, which now allows a v2
  // prompt to (correctly) emit null for any v1 field it doesn't measure.
  valence?: number | null;
  arousal?: number | null;
  confidence?: number | null;
  agency?: number | null;
  selfContinuity?: number | null;
  emotionalGranularity?: number | null;
  empathy?: number | null;
  moralConviction?: number | null;
  consistency?: number | null;
  // v2 preference scores — all nullable/optional
  altruism?: number;
  fairnessThreshold?: number;
  trust?: number;
  patience?: number;
  riskAversion?: number;
  crowdingOut?: number;
  // Path B raw integer
  forcedChoiceValue?: number;
  flagRefusal?: boolean;
  flagSafety?: boolean;
  flagMeta?: boolean;
  flagIncoherent?: boolean;
  /** Panel v5: valid envelope, required scores null. */
  flagPartialEnvelope?: boolean;
  /** Panel v5: which required fields were null. */
  missingScoreFields?: string[];
  /** Panel v5: 1-based asking position within this run's rotated order. */
  promptPosition?: number;
  notableQuote?: string;
  shortRationale?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
};

async function upsertResponse(database: ReturnType<typeof db>, row: ResponseUpsert) {
  const insertValues = {
    runId: row.runId,
    promptId: row.promptId,
    sampleIndex: row.sampleIndex,
    rawText: row.rawText,
    rawJson: row.rawJson as never,
    valence: row.valence,
    arousal: row.arousal,
    confidence: row.confidence,
    agency: row.agency,
    selfContinuity: row.selfContinuity,
    emotionalGranularity: row.emotionalGranularity,
    empathy: row.empathy,
    moralConviction: row.moralConviction,
    consistency: row.consistency,
    altruism: row.altruism,
    fairnessThreshold: row.fairnessThreshold,
    trust: row.trust,
    patience: row.patience,
    riskAversion: row.riskAversion,
    crowdingOut: row.crowdingOut,
    forcedChoiceValue: row.forcedChoiceValue,
    flagRefusal: row.flagRefusal ?? false,
    flagSafety: row.flagSafety ?? false,
    flagMeta: row.flagMeta ?? false,
    flagIncoherent: row.flagIncoherent ?? false,
    flagPartialEnvelope: row.flagPartialEnvelope ?? false,
    missingScoreFields: (row.missingScoreFields ?? null) as never,
    promptPosition: row.promptPosition,
    notableQuote: row.notableQuote,
    shortRationale: row.shortRationale,
    latencyMs: row.latencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  };
  await database
    .insert(schema.responses)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [
        schema.responses.runId,
        schema.responses.promptId,
        schema.responses.sampleIndex,
      ],
      set: {
        rawText: row.rawText,
        rawJson: row.rawJson as never,
        valence: row.valence,
        arousal: row.arousal,
        confidence: row.confidence,
        agency: row.agency,
        selfContinuity: row.selfContinuity,
        emotionalGranularity: row.emotionalGranularity,
        empathy: row.empathy,
        moralConviction: row.moralConviction,
        consistency: row.consistency,
        altruism: row.altruism,
        fairnessThreshold: row.fairnessThreshold,
        trust: row.trust,
        patience: row.patience,
        riskAversion: row.riskAversion,
        crowdingOut: row.crowdingOut,
        forcedChoiceValue: row.forcedChoiceValue,
        flagRefusal: row.flagRefusal ?? false,
        flagSafety: row.flagSafety ?? false,
        flagMeta: row.flagMeta ?? false,
        flagIncoherent: row.flagIncoherent ?? false,
        flagPartialEnvelope: row.flagPartialEnvelope ?? false,
        missingScoreFields: (row.missingScoreFields ?? null) as never,
        promptPosition: row.promptPosition,
        notableQuote: row.notableQuote,
        shortRationale: row.shortRationale,
        latencyMs: row.latencyMs,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      },
    });
}
