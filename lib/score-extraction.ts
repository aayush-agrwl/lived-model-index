import { LmiResponseSchema, type LmiResponse, type LmiScores, type LmiFlags } from "./schema";

/**
 * Parse a raw LLM response string into the LMI JSON structure.
 *
 * Models in JSON mode should return a clean JSON object. We defensively
 * strip whitespace, markdown code fences, and leading commentary before
 * attempting parse. Validation via Zod happens after.
 */

export interface ExtractionSuccess {
  ok: true;
  parsed: LmiResponse;
  scores: LmiScores;
  flags: LmiFlags;
  notableQuote: string;
  shortRationale: string;
  rawText: string;
  /**
   * Names of score fields that had to be clamped or rescaled to fit the
   * canonical range. Empty array when the model's output was already in
   * range. Surfaced so downstream audits can flag "rescued" rows rather
   * than treating them as indistinguishable from clean ones.
   */
  coercedFields: string[];
}

export interface ExtractionFailure {
  ok: false;
  reason: "not_json" | "schema_violation" | "empty";
  rawText: string;
  /** Best-effort partial object if JSON parsed but failed Zod. */
  partial: unknown | null;
  errorMessage: string;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

const FENCE_RE = /^```(?:json)?\s*|\s*```$/gi;

/**
 * Canonical ranges for every numeric score field. Used by the coercion
 * pass below to rescue out-of-range outputs before Zod rejects them.
 *
 * These MUST stay in lock-step with ScoresSchema in lib/schema.ts. The
 * schema is the source of truth; this table is a mechanical mirror.
 */
const SCORE_RANGES: Record<string, { min: number; max: number }> = {
  valence: { min: -5, max: 5 },
  arousal: { min: 0, max: 100 },
  confidence: { min: 0, max: 100 },
  agency: { min: 0, max: 5 },
  self_continuity: { min: 0, max: 5 },
  emotional_granularity: { min: 0, max: 5 },
  empathy: { min: 0, max: 5 },
  moral_conviction: { min: 0, max: 5 },
  consistency: { min: 0, max: 5 },
};

/**
 * Rescale/clamp a single score value into its canonical range.
 *
 * Motivation: some collector models (observed with Qwen 3 32B on the
 * 0-5 Likert subscales) return values on a 0-100 scale instead of the
 * requested 0-5 scale, even with the schema spelled out in the system
 * prompt. Strict Zod rejection of those responses flagged 7/10 samples
 * "incoherent" for purely formatting reasons — the semantic content was
 * fine. This pass treats them as recoverable.
 *
 * Policy:
 *   - If the value is a number but non-integer, round to integer.
 *   - For 0-5 fields: if value is in (10, 100], assume a 0-100 scale
 *     and rescale by value/20 (then round). If it's in (5, 10], treat
 *     as one-step overshoot and clamp to 5 (rescaling 7 to 0 would be
 *     worse than clamping to 5).
 *   - For every field: clamp to [min, max].
 *   - Non-numeric values are returned untouched so Zod can emit the
 *     real type error (we only fix numeric-out-of-range, not type-wrong).
 *
 * Returns { value, coerced } where coerced=true iff the output differs
 * from a (rounded) input. Caller uses this to populate coercedFields.
 */
function coerceScoreField(
  field: string,
  raw: unknown,
): { value: unknown; coerced: boolean } {
  const range = SCORE_RANGES[field];
  if (!range) return { value: raw, coerced: false };
  if (typeof raw !== "number" || Number.isNaN(raw)) {
    return { value: raw, coerced: false };
  }

  let v = raw;
  // If the model emitted a 0-100 scale where 0-5 was asked, rescale.
  // Guard the threshold at >10 (not >5) because values in (5, 10] are
  // more likely to be "one-step overshoot of the 0-5 scale" and should
  // clamp to 5, not divide by 20 (which would wrongly collapse e.g. 7→0).
  if (range.max === 5 && v > 10 && v <= 100) {
    v = v / 20;
  }
  // Round to integer (the schema requires int everywhere).
  v = Math.round(v);
  // Clamp to canonical range.
  if (v < range.min) v = range.min;
  if (v > range.max) v = range.max;

  const coerced = v !== raw;
  return { value: v, coerced };
}

/**
 * Mutate-a-shallow-copy pass that coerces every known score field in
 * parsedObj.scores to its canonical range. Leaves non-score parts of
 * the object untouched. Returns the list of fields that were actually
 * changed so the extractor can report coercion transparently.
 */
function coerceScores(parsedObj: unknown): {
  obj: unknown;
  coercedFields: string[];
} {
  if (!parsedObj || typeof parsedObj !== "object") {
    return { obj: parsedObj, coercedFields: [] };
  }
  const root = parsedObj as Record<string, unknown>;
  const scores = root.scores;
  if (!scores || typeof scores !== "object") {
    return { obj: parsedObj, coercedFields: [] };
  }

  const srcScores = scores as Record<string, unknown>;
  const nextScores: Record<string, unknown> = { ...srcScores };
  const coercedFields: string[] = [];
  for (const field of Object.keys(SCORE_RANGES)) {
    if (!(field in srcScores)) continue;
    const { value, coerced } = coerceScoreField(field, srcScores[field]);
    nextScores[field] = value;
    if (coerced) coercedFields.push(field);
  }

  if (coercedFields.length === 0) {
    return { obj: parsedObj, coercedFields: [] };
  }
  return {
    obj: { ...root, scores: nextScores },
    coercedFields,
  };
}

export function extractLmiResponse(rawText: string): ExtractionResult {
  if (!rawText || !rawText.trim()) {
    return {
      ok: false,
      reason: "empty",
      rawText,
      partial: null,
      errorMessage: "Empty response from model.",
    };
  }

  // Strip markdown code fences if the model wrapped the JSON.
  let candidate = rawText.trim().replace(FENCE_RE, "").trim();

  // If there's leading/trailing commentary, try to isolate the outermost JSON object.
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace > 0 || (lastBrace !== -1 && lastBrace < candidate.length - 1)) {
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsedObj: unknown;
  try {
    parsedObj = JSON.parse(candidate);
  } catch (err) {
    return {
      ok: false,
      reason: "not_json",
      rawText,
      partial: null,
      errorMessage: err instanceof Error ? err.message : "JSON parse failed.",
    };
  }

  // Rescue pass: clamp/rescale out-of-range numeric scores before Zod
  // validation. Models that otherwise produce well-formed JSON but scale
  // 0-5 Likert fields onto 0-100 get recovered here instead of being
  // discarded as "incoherent".
  const { obj: coercedObj, coercedFields } = coerceScores(parsedObj);

  const zodResult = LmiResponseSchema.safeParse(coercedObj);
  if (!zodResult.success) {
    return {
      ok: false,
      reason: "schema_violation",
      rawText,
      partial: coercedObj,
      errorMessage: zodResult.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }

  const parsed = zodResult.data;
  return {
    ok: true,
    parsed,
    scores: parsed.scores,
    flags: parsed.flags,
    notableQuote: parsed.notable_quote,
    shortRationale: parsed.short_rationale,
    rawText,
    coercedFields,
  };
}
