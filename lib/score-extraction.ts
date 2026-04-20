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

  const zodResult = LmiResponseSchema.safeParse(parsedObj);
  if (!zodResult.success) {
    return {
      ok: false,
      reason: "schema_violation",
      rawText,
      partial: parsedObj,
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
  };
}
