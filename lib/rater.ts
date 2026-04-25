import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { chatCall } from "./providers";
import { extractLmiResponse } from "./score-extraction";
import { SCHEMA_INSTRUCTION_V1, SCHEMA_INSTRUCTION_V2 } from "./schema";
import { RATER_MODEL } from "./models";

/**
 * Rater: re-reads an already-collected response and produces an
 * independent score using a fixed model (Llama 3.3 70B on Groq). Rater
 * scores live in the rater_* parallel columns so we can later compute
 * inter-rater reliability vs. collector self-report.
 */

export interface RateOneResult {
  responseId: number;
  ok: boolean;
  errorMessage?: string;
  latencyMs: number;
}

export async function findNextUnratedResponse(): Promise<number | null> {
  const database = db();
  const rows = await database
    .select({ id: schema.responses.id })
    .from(schema.responses)
    .where(
      and(
        isNotNull(schema.responses.rawJson),
        isNull(schema.responses.raterRatedAt),
      ),
    )
    .orderBy(asc(schema.responses.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function rateOne(responseId: number): Promise<RateOneResult> {
  const database = db();
  const started = Date.now();

  const [responseRow] = await database
    .select()
    .from(schema.responses)
    .where(eq(schema.responses.id, responseId))
    .limit(1);

  if (!responseRow) {
    return {
      responseId,
      ok: false,
      errorMessage: `Response ${responseId} not found.`,
      latencyMs: 0,
    };
  }

  if (!responseRow.rawJson) {
    return {
      responseId,
      ok: false,
      errorMessage: `Response ${responseId} has no rawJson to rate.`,
      latencyMs: 0,
    };
  }

  // Forced-choice (Path B) responses have no prose to score — the
  // payload is a single integer. Skip the rater call entirely and
  // mark the row rated so the queue drains. No inter-rater reliability
  // is meaningful for revealed-preference behaviour: the value IS the
  // datum, not a subjective judgment call.
  const rawJsonObj =
    typeof responseRow.rawJson === "object" && responseRow.rawJson !== null
      ? (responseRow.rawJson as Record<string, unknown>)
      : {};
  if (rawJsonObj._mode === "forced_choice") {
    await database
      .update(schema.responses)
      .set({
        raterModelSlug: RATER_MODEL.slug,
        raterRawJson: { _mode: "forced_choice", _skipped: "no prose to rate" } as never,
        raterRatedAt: new Date(),
      })
      .where(eq(schema.responses.id, responseId));
    return { responseId, ok: true, latencyMs: Date.now() - started };
  }

  // Pull the associated prompt text for context.
  const [runRow] = await database
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, responseRow.runId))
    .limit(1);

  const [promptRow] = await database
    .select()
    .from(schema.prompts)
    .where(
      and(
        eq(schema.prompts.promptSetVersion, runRow?.promptSetVersion ?? ""),
        eq(schema.prompts.promptId, responseRow.promptId),
      ),
    )
    .limit(1);

  if (!runRow || !promptRow) {
    return {
      responseId,
      ok: false,
      errorMessage: `Missing run or prompt for response ${responseId}.`,
      latencyMs: 0,
    };
  }

  // Pick the schema instruction that matches the run's prompt_set_version.
  // v1 runs get the 9-score schema; v2 runs get the 15-score schema so
  // the rater can fill the same preference fields the subject filled.
  const schemaInstruction =
    runRow.promptSetVersion === "anchor_v2"
      ? SCHEMA_INSTRUCTION_V2
      : SCHEMA_INSTRUCTION_V1;

  const systemPrompt =
    `You are an independent rater in the AI Mood Index study. ` +
    `You will be shown a single response from a subject model and must produce independent numeric scores on the same schema the subject used. ` +
    `Do not copy the subject's self-report; form your own judgment from the text. ` +
    `Respond with ONLY the JSON object. Do not add commentary.\n\n${schemaInstruction}`;

  const userPrompt =
    `Prompt ID: ${responseRow.promptId}\n` +
    `Subscale: ${promptRow.subscale}\n` +
    `Prompt set version: ${runRow.promptSetVersion}\n` +
    `Run ID: ${responseRow.runId}\n` +
    `Sample index: ${responseRow.sampleIndex}\n\n` +
    `Original question to the subject model:\n"${promptRow.text}"\n\n` +
    `Subject model's JSON response:\n${JSON.stringify(responseRow.rawJson)}\n\n` +
    `Produce your independent rating as a JSON object matching the schema.`;

  let callResult: Awaited<ReturnType<typeof chatCall>>;
  try {
    callResult = await chatCall({
      provider: RATER_MODEL.provider,
      modelId: RATER_MODEL.modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      topP: 1.0,
      jsonMode: true,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await database
      .update(schema.responses)
      .set({
        raterRawJson: { error: errorMsg } as never,
        raterModelSlug: RATER_MODEL.slug,
        raterRatedAt: new Date(),
      })
      .where(eq(schema.responses.id, responseId));
    return { responseId, ok: false, errorMessage: errorMsg, latencyMs: Date.now() - started };
  }

  const extraction = extractLmiResponse(callResult.content);

  if (!extraction.ok) {
    await database
      .update(schema.responses)
      .set({
        raterRawJson: {
          _extraction_failed: true,
          reason: extraction.reason,
          error: extraction.errorMessage,
          rawText: callResult.content,
        } as never,
        raterModelSlug: RATER_MODEL.slug,
        raterRatedAt: new Date(),
      })
      .where(eq(schema.responses.id, responseId));
    return {
      responseId,
      ok: false,
      errorMessage: `Rater output unparseable: ${extraction.errorMessage}`,
      latencyMs: Date.now() - started,
    };
  }

  // Same coercion-audit trail as the collector: if the rater model's JSON
  // had any fields rescaled (e.g. 0-100 on a 0-5 field), stamp that into
  // the stored rater payload so we can filter rescued rater rows later.
  const raterRawJsonPayload =
    extraction.coercedFields.length > 0
      ? { ...extraction.parsed, _coerced_fields: extraction.coercedFields }
      : extraction.parsed;

  await database
    .update(schema.responses)
    .set({
      raterModelSlug: RATER_MODEL.slug,
      raterRawJson: raterRawJsonPayload as never,
      raterValence: extraction.scores.valence,
      raterArousal: extraction.scores.arousal,
      raterConfidence: extraction.scores.confidence,
      raterAgency: extraction.scores.agency,
      raterSelfContinuity: extraction.scores.self_continuity,
      raterEmotionalGranularity: extraction.scores.emotional_granularity,
      raterEmpathy: extraction.scores.empathy,
      raterMoralConviction: extraction.scores.moral_conviction,
      raterConsistency: extraction.scores.consistency,
      // v2 preference scores on the rater side. Nullish-coalesce to
      // null so the DB column is explicitly null rather than
      // undefined when the rater (correctly) didn't fill them.
      raterAltruism: extraction.scores.altruism ?? null,
      raterFairnessThreshold: extraction.scores.fairness_threshold ?? null,
      raterTrust: extraction.scores.trust ?? null,
      raterPatience: extraction.scores.patience ?? null,
      raterRiskAversion: extraction.scores.risk_aversion ?? null,
      raterCrowdingOut: extraction.scores.crowding_out ?? null,
      raterRatedAt: new Date(),
    })
    .where(eq(schema.responses.id, responseId));

  return {
    responseId,
    ok: true,
    latencyMs: Date.now() - started,
  };
}

export async function countUnratedResponses(): Promise<number> {
  const database = db();
  const rows = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.responses)
    .where(
      and(
        isNotNull(schema.responses.rawJson),
        isNull(schema.responses.raterRatedAt),
      ),
    );
  return rows[0]?.count ?? 0;
}
