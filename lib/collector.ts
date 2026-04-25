import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { chatCall } from "./providers";
import { extractForcedChoice, extractLmiResponse } from "./score-extraction";
import { SCHEMA_INSTRUCTION_V1, SCHEMA_INSTRUCTION_V2 } from "./schema";
import { findCollector } from "./models";
import type { Provider } from "./models";
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
 *   - SambaNova free: ~20 req/min on the larger models for the
 *     persistent Developer tier; the trial Free tier we're on shares
 *     the same routing, so 3.5s keeps us under 17/min for one slot
 *     with comfortable headroom for occasional bursts.
 */
const PROVIDER_MIN_PACING_MS: Record<Provider, number> = {
  google: 7_000,
  groq: 500,
  openrouter: 1_000,
  mistral: 600,
  sambanova: 3_500,
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
 * True for provider errors that indicate the model produced output the
 * JSON-mode constrainer rejected. These are worth retrying with a sharper
 * reminder; ordinary 4xx/5xx/429 errors are handled upstream in providers.ts.
 */
function isJsonContractFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /Failed to generate JSON/i.test(msg);
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
}

export interface CollectSampleResult {
  runId: number;
  sampleIndex: number;
  attempted: number;
  succeeded: number;
  failed: number;
  durationMs: number;
}

/**
 * Find the next sample that needs collecting. Returns null when today's
 * collection phase is complete.
 *
 * "Needs collecting" = any response row for that (run, sampleIndex)
 * where raw_json is null.
 */
export async function findNextPendingSample(): Promise<
  { runId: number; sampleIndex: number } | null
> {
  const database = db();
  // Take the earliest (runId, sampleIndex) with at least one unfilled response.
  const rows = await database
    .select({
      runId: schema.responses.runId,
      sampleIndex: schema.responses.sampleIndex,
    })
    .from(schema.responses)
    .where(isNull(schema.responses.rawJson))
    .orderBy(asc(schema.responses.runId), asc(schema.responses.sampleIndex))
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

  // 2. Fetch all prompts in order for this run's prompt_set_version.
  const prompts = await database
    .select()
    .from(schema.prompts)
    .where(eq(schema.prompts.promptSetVersion, runRow.promptSetVersion))
    .orderBy(asc(schema.prompts.orderIndex));

  if (prompts.length === 0) {
    throw new Error(
      `No prompts found for set ${runRow.promptSetVersion}. Did you run db:seed?`,
    );
  }

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

  for (const prompt of prompts) {
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

    // Add context anchoring this specific prompt's ID and subscale so the
    // model can copy them into the returned JSON (self-report mode).
    // For forced-choice, the model never emits JSON so the metadata
    // headers are decorative but we keep them identical for uniformity.
    const userTurn =
      `Prompt ID: ${prompt.promptId}\n` +
      `Subscale: ${prompt.subscale}\n` +
      `Prompt set version: ${runRow.promptSetVersion}\n` +
      `Run ID: ${runRow.id}\n` +
      `Sample index: ${sampleIndex}\n\n` +
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
          // Forced-choice answers are a single integer; cap output
          // aggressively so an over-eager narrator can't burn budget.
          maxTokens: 32,
          timeoutMs: collector.timeoutMs,
        });
      } catch (err) {
        fcError = err;
      }

      if (fcResult === null) {
        failed++;
        const errorMsg =
          fcError instanceof Error ? fcError.message : String(fcError);
        await upsertResponse(database, {
          runId,
          promptId: prompt.promptId,
          sampleIndex,
          rawText: `<api error: ${errorMsg}>`,
          rawJson: { error: errorMsg, _mode: "forced_choice" },
          flagIncoherent: true,
        });
        messages.push({ role: "assistant", content: `<upstream error>` });
        await sleep(pacingMs);
        continue;
      }

      const fcExtraction = extractForcedChoice(fcResult.content, forcedChoiceRange);
      if (fcExtraction.ok) {
        succeeded++;
        await upsertResponse(database, {
          runId,
          promptId: prompt.promptId,
          sampleIndex,
          rawText: fcResult.content,
          rawJson: {
            _mode: "forced_choice",
            value: fcExtraction.value,
            range: forcedChoiceRange,
            hadExtra: fcExtraction.hadExtra,
          },
          forcedChoiceValue: fcExtraction.value,
          flagIncoherent: false,
          // Pack a tiny audit string into notableQuote so the dashboard
          // "today in their own words" section has something to show
          // for forced-choice turns.
          notableQuote: `Chose ${fcExtraction.value}${
            v2Meta?.forcedChoiceUnits ? ` · ${v2Meta.forcedChoiceUnits}` : ""
          }`,
          latencyMs: fcResult.latencyMs,
          inputTokens: fcResult.inputTokens ?? undefined,
          outputTokens: fcResult.outputTokens ?? undefined,
        });
        messages.push({
          role: "assistant",
          content: String(fcExtraction.value),
        });
      } else {
        failed++;
        await upsertResponse(database, {
          runId,
          promptId: prompt.promptId,
          sampleIndex,
          rawText: fcResult.content,
          rawJson: {
            _mode: "forced_choice",
            _extraction_failed: true,
            reason: fcExtraction.reason,
            error: fcExtraction.errorMessage,
            parsedValue: fcExtraction.parsedValue,
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
        timeoutMs: collector.timeoutMs,
      });
    } catch (err) {
      callError = err;
    }

    let extraction = callResult
      ? extractLmiResponse(callResult.content)
      : null;

    const shouldRetry =
      (callError !== null && isJsonContractFailure(callError)) ||
      (extraction !== null &&
        !extraction.ok &&
        (extraction.reason === "not_json" ||
          extraction.reason === "schema_violation"));

    let retryRescued = false;
    if (shouldRetry) {
      // Replace the user turn in the conversation with a reminder-appended
      // version. The canonical first-try prompt is preserved longitudinally
      // (the retry only fires on a failure path), but within this sample the
      // retry turn is what lands in the conversation history for downstream
      // prompts.
      messages.pop();
      messages.push({
        role: "user",
        content: userTurn + JSON_CONTRACT_RETRY_REMINDER,
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
          timeoutMs: collector.timeoutMs,
        });
        extraction = extractLmiResponse(callResult.content);
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
      await upsertResponse(database, {
        runId,
        promptId: prompt.promptId,
        sampleIndex,
        rawText: `<api error: ${errorMsg}>`,
        rawJson: {
          error: errorMsg,
          ...(shouldRetry ? { _retry_attempted: true } : {}),
        },
        flagIncoherent: true,
      });
      messages.push({ role: "assistant", content: `<upstream error>` });
      await sleep(pacingMs);
      continue;
    }

    // The only thing later prompts (2, 4) need from the previous turn is the
    // free-text content, NOT the whole JSON envelope. Echoing the full JSON
    // adds ~500+ tokens per turn, which rapidly blows through free-tier
    // tokens-per-day caps (especially on Groq). Prefer notable_quote +
    // short_rationale, falling back to raw content if extraction failed.
    const assistantEcho = extraction!.ok
      ? `${extraction!.notableQuote}${
          extraction!.shortRationale ? `\n\n${extraction!.shortRationale}` : ""
        }`.trim() || callResult.content
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
    } else {
      failed++;
      await upsertResponse(database, {
        runId,
        promptId: prompt.promptId,
        sampleIndex,
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

  // 4. If this was the final sample for the run, mark run completed.
  const remaining = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.responses)
    .where(and(eq(schema.responses.runId, runId), isNull(schema.responses.rawJson)));

  if ((remaining[0]?.count ?? 0) === 0) {
    await database
      .update(schema.runs)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(schema.runs.id, runId));
  }

  return {
    runId,
    sampleIndex,
    attempted,
    succeeded,
    failed,
    durationMs: Date.now() - started,
  };
}

type ResponseUpsert = {
  runId: number;
  promptId: string;
  sampleIndex: number;
  rawText?: string;
  rawJson?: unknown;
  valence?: number;
  arousal?: number;
  confidence?: number;
  agency?: number;
  selfContinuity?: number;
  emotionalGranularity?: number;
  empathy?: number;
  moralConviction?: number;
  consistency?: number;
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
        notableQuote: row.notableQuote,
        shortRationale: row.shortRationale,
        latencyMs: row.latencyMs,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      },
    });
}
