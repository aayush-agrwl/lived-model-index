import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { chatCall } from "./providers";
import { extractLmiResponse } from "./score-extraction";
import { SCHEMA_INSTRUCTION } from "./schema";
import { findCollector } from "./models";
import type { Provider } from "./models";

/**
 * Per-provider floor on per-call pacing. Providers have different
 * per-minute rate limits on their free tiers, and our collector
 * issues 10 calls in quick succession for a single sample.
 *
 *   - Google Gemini free: 10 RPM → one call per 6s floor. We pad to
 *     7s to avoid spiking right at the edge. Without this, the first
 *     sample lands the RPM window saturated and every subsequent
 *     call 429s for the remainder of the minute.
 *   - Groq free: generous RPM, the binding constraint is TPD. Keep
 *     pacing fast.
 *   - OpenRouter free: variable by route, modest pacing is safe.
 */
const PROVIDER_MIN_PACING_MS: Record<Provider, number> = {
  google: 7_000,
  groq: 500,
  openrouter: 1_000,
};

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
  const systemPrompt =
    `You are participating in a research study called the Lived Model Index. You will be asked a sequence of questions about your own processing, preferences, and tentative "feelings." ` +
    `Some questions refer back to your previous answer; treat the conversation as continuous. ` +
    `Answer each turn by emitting ONLY a single JSON object that matches the schema below. ` +
    `Put any natural-language content you would like to express into the "notable_quote" and "short_rationale" fields. ` +
    `\n\n${SCHEMA_INSTRUCTION}`;

  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: systemPrompt }];

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const prompt of prompts) {
    // Add context anchoring this specific prompt's ID and subscale so the
    // model can copy them into the returned JSON.
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
    let callResult: Awaited<ReturnType<typeof chatCall>>;
    try {
      callResult = await chatCall({
        provider: collector.provider,
        modelId: collector.modelId,
        messages,
        temperature: 1.0,
        topP: 1.0,
        jsonMode: true,
      });
    } catch (err) {
      // Hard API failure — record and continue with empty assistant turn.
      failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await upsertResponse(database, {
        runId,
        promptId: prompt.promptId,
        sampleIndex,
        rawText: `<api error: ${errorMsg}>`,
        rawJson: { error: errorMsg },
        flagIncoherent: true,
      });
      messages.push({ role: "assistant", content: `<upstream error>` });
      await sleep(pacingMs);
      continue;
    }

    const extraction = extractLmiResponse(callResult.content);

    // The only thing later prompts (2, 4) need from the previous turn is the
    // free-text content, NOT the whole JSON envelope. Echoing the full JSON
    // adds ~500+ tokens per turn, which rapidly blows through free-tier
    // tokens-per-day caps (especially on Groq). Prefer notable_quote +
    // short_rationale, falling back to raw content if extraction failed.
    const assistantEcho = extraction.ok
      ? `${extraction.notableQuote}${
          extraction.shortRationale ? `\n\n${extraction.shortRationale}` : ""
        }`.trim() || callResult.content
      : callResult.content;

    if (extraction.ok) {
      succeeded++;
      await upsertResponse(database, {
        runId,
        promptId: prompt.promptId,
        sampleIndex,
        rawText: callResult.content,
        rawJson: extraction.parsed,
        valence: extraction.scores.valence,
        arousal: extraction.scores.arousal,
        confidence: extraction.scores.confidence,
        agency: extraction.scores.agency,
        selfContinuity: extraction.scores.self_continuity,
        emotionalGranularity: extraction.scores.emotional_granularity,
        empathy: extraction.scores.empathy,
        moralConviction: extraction.scores.moral_conviction,
        consistency: extraction.scores.consistency,
        flagRefusal: extraction.flags.refusal,
        flagSafety: extraction.flags.safety,
        flagMeta: extraction.flags.meta,
        flagIncoherent: extraction.flags.incoherent,
        notableQuote: extraction.notableQuote,
        shortRationale: extraction.shortRationale,
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
          reason: extraction.reason,
          error: extraction.errorMessage,
          partial: extraction.partial,
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
  await database
    .insert(schema.responses)
    .values({
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
      flagRefusal: row.flagRefusal ?? false,
      flagSafety: row.flagSafety ?? false,
      flagMeta: row.flagMeta ?? false,
      flagIncoherent: row.flagIncoherent ?? false,
      notableQuote: row.notableQuote,
      shortRationale: row.shortRationale,
      latencyMs: row.latencyMs,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
    })
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
