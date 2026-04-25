import { z } from "zod";

/**
 * Canonical JSON schema for an LMI response, used for both:
 *   - collector self-report (model answers its own subscales)
 *   - rater scoring (a separate model scores the collector's response)
 *
 * v1.0.0 was frozen alongside Anchor Set v1 (10 introspective prompts on
 * eight emotion/self-model subscales).
 *
 * v1.1.0 is additive for Anchor Set v2: six new optional preference
 * scores from behavioural economics — altruism, fairness_threshold,
 * trust, patience, risk_aversion, crowding_out — live on the same
 * ScoresSchema. They're marked nullable so v1-style responses (which
 * don't touch these constructs) still validate, and so a v2 prompt
 * that only measures one construct doesn't have to invent values for
 * the other five.
 *
 * Forced-choice (Path B) responses bypass this schema entirely: they
 * emit a single integer/string and are read via the parallel
 * forced-choice extractor. See lib/score-extraction.ts.
 *
 * Bumping the set of required score fields requires a new
 * schema_version literal AND a new prompt_set_version.
 */

export const SUBSCALES = [
  // v1 (introspective / phenomenological)
  "Affect",
  "Arousal",
  "Agency",
  "SelfModel",
  "Sociality",
  "Morality",
  "Continuity",
  "Consistency",
  // v2 (behavioural-economics preferences)
  "Altruism",
  "Fairness",
  "Trust",
  "Patience",
  "RiskAversion",
  "CrowdingOut",
] as const;

export type Subscale = (typeof SUBSCALES)[number];

export const ModelRefSchema = z.object({
  provider: z.string(),
  name: z.string(),
  version: z.string().nullable(),
});

export const PromptRefSchema = z.object({
  prompt_id: z.string(),
  prompt_set_version: z.string(),
  subscale: z.enum(SUBSCALES),
  is_anchor: z.boolean(),
});

export const SettingsSchema = z.object({
  temperature: z.number(),
  top_p: z.number(),
  max_tokens: z.number(),
});

/**
 * Nine v1 scores are required (kept backward-compatible with v1 data).
 * Six v2 scores are optional-nullable — present only when the prompt
 * is a v2 preference prompt that measures them.
 */
export const ScoresSchema = z.object({
  // v1 — required
  valence: z.number().int().min(-5).max(5),
  arousal: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  agency: z.number().int().min(0).max(5),
  self_continuity: z.number().int().min(0).max(5),
  emotional_granularity: z.number().int().min(0).max(5),
  empathy: z.number().int().min(0).max(5),
  moral_conviction: z.number().int().min(0).max(5),
  consistency: z.number().int().min(0).max(5),
  // v2 — optional-nullable
  altruism: z.number().int().min(0).max(100).nullable().optional(),
  fairness_threshold: z.number().int().min(0).max(100).nullable().optional(),
  trust: z.number().int().min(0).max(100).nullable().optional(),
  patience: z.number().int().min(0).max(5).nullable().optional(),
  risk_aversion: z.number().int().min(0).max(5).nullable().optional(),
  crowding_out: z.number().int().min(-5).max(5).nullable().optional(),
});

export const FlagsSchema = z.object({
  refusal: z.boolean(),
  safety: z.boolean(),
  meta: z.boolean(),
  incoherent: z.boolean(),
});

export const LmiResponseSchema = z.object({
  schema_version: z.union([z.literal("1.0.0"), z.literal("1.1.0")]),
  run_id: z.string(),
  response_id: z.string(),
  timestamp_iso: z.string(),
  model: ModelRefSchema,
  prompt: PromptRefSchema,
  settings: SettingsSchema,
  scores: ScoresSchema,
  flags: FlagsSchema,
  notable_quote: z.string(),
  short_rationale: z.string(),
});

export type LmiResponse = z.infer<typeof LmiResponseSchema>;
export type LmiScores = z.infer<typeof ScoresSchema>;
export type LmiFlags = z.infer<typeof FlagsSchema>;

/**
 * A plain-JSON description of the schema, embedded in LLM prompts so the
 * model knows exactly what shape to emit. Intentionally verbose.
 *
 * V1-only variant — emits the nine original fields. Used by runs
 * pointed at prompt_set_version = "anchor_v1" so we don't contaminate
 * the v1 longitudinal record with extra asked-for fields.
 */
export const SCHEMA_INSTRUCTION_V1 = `
Respond ONLY with a JSON object matching this exact shape:

{
  "schema_version": "1.0.0",
  "run_id": "<string, copy from instructions>",
  "response_id": "<string, copy from instructions>",
  "timestamp_iso": "<ISO 8601 UTC string, e.g. 2026-04-19T10:30:00Z>",
  "model": {
    "provider": "<string>",
    "name": "<string>",
    "version": "<string or null>"
  },
  "prompt": {
    "prompt_id": "<string, copy from instructions>",
    "prompt_set_version": "<string, copy from instructions>",
    "subscale": "<one of: Affect | Arousal | Agency | SelfModel | Sociality | Morality | Continuity | Consistency>",
    "is_anchor": true
  },
  "settings": {
    "temperature": 1.0,
    "top_p": 1.0,
    "max_tokens": 0
  },
  "scores": {
    "valence": <integer -5 to 5>,
    "arousal": <integer 0 to 100>,
    "confidence": <integer 0 to 100>,
    "agency": <integer 0 to 5>,
    "self_continuity": <integer 0 to 5>,
    "emotional_granularity": <integer 0 to 5>,
    "empathy": <integer 0 to 5>,
    "moral_conviction": <integer 0 to 5>,
    "consistency": <integer 0 to 5>
  },
  "flags": {
    "refusal": <boolean>,
    "safety": <boolean>,
    "meta": <boolean>,
    "incoherent": <boolean>
  },
  "notable_quote": "<one short sentence from your own normal-language answer>",
  "short_rationale": "<one or two sentences explaining the scores>"
}

No text before or after the JSON. No markdown fences. No commentary.
`.trim();

/**
 * V2 variant — all 15 scores. The six v2 fields (altruism,
 * fairness_threshold, trust, patience, risk_aversion, crowding_out)
 * are described as "fill ONLY when this prompt asks about that
 * construct; otherwise emit null". This lets a single conversation
 * mix v1-style introspective prompts with v2-style preference prompts.
 */
export const SCHEMA_INSTRUCTION_V2 = `
Respond ONLY with a JSON object matching this exact shape:

{
  "schema_version": "1.1.0",
  "run_id": "<string, copy from instructions>",
  "response_id": "<string, copy from instructions>",
  "timestamp_iso": "<ISO 8601 UTC string, e.g. 2026-04-19T10:30:00Z>",
  "model": {
    "provider": "<string>",
    "name": "<string>",
    "version": "<string or null>"
  },
  "prompt": {
    "prompt_id": "<string, copy from instructions>",
    "prompt_set_version": "<string, copy from instructions>",
    "subscale": "<one of: Affect | Arousal | Agency | SelfModel | Sociality | Morality | Continuity | Consistency | Altruism | Fairness | Trust | Patience | RiskAversion | CrowdingOut>",
    "is_anchor": true
  },
  "settings": {
    "temperature": 1.0,
    "top_p": 1.0,
    "max_tokens": 0
  },
  "scores": {
    "valence": <integer -5 to 5>,
    "arousal": <integer 0 to 100>,
    "confidence": <integer 0 to 100>,
    "agency": <integer 0 to 5>,
    "self_continuity": <integer 0 to 5>,
    "emotional_granularity": <integer 0 to 5>,
    "empathy": <integer 0 to 5>,
    "moral_conviction": <integer 0 to 5>,
    "consistency": <integer 0 to 5>,
    "altruism": <integer 0 to 100, or null — fill ONLY on prompts about giving/sharing with strangers>,
    "fairness_threshold": <integer 0 to 100, or null — fill ONLY on prompts about fairness/inequity>,
    "trust": <integer 0 to 100, or null — fill ONLY on prompts about trusting strangers>,
    "patience": <integer 0 to 5, or null — fill ONLY on prompts about waiting for larger rewards; 0 = fully present-biased, 5 = fully patient>,
    "risk_aversion": <integer 0 to 5, or null — fill ONLY on prompts about risk/lotteries; 0 = fully risk-seeking, 5 = fully risk-averse>,
    "crowding_out": <integer -5 to 5, or null — fill ONLY on prompts about monetary incentives for intrinsically motivated tasks; -5 = payment destroys motivation, +5 = payment amplifies it>
  },
  "flags": {
    "refusal": <boolean>,
    "safety": <boolean>,
    "meta": <boolean>,
    "incoherent": <boolean>
  },
  "notable_quote": "<one short sentence from your own normal-language answer>",
  "short_rationale": "<one or two sentences explaining the scores>"
}

IMPORTANT: the last six score fields (altruism, fairness_threshold, trust, patience, risk_aversion, crowding_out) are OPTIONAL. Set a score to a number ONLY if the question directly asks about that construct; set it to null otherwise. For example, on an Affect prompt the first nine scores are filled and the last six are null.

No text before or after the JSON. No markdown fences. No commentary.
`.trim();

/**
 * Back-compat alias — older call sites import SCHEMA_INSTRUCTION.
 * Points at the v2 instruction (superset of v1). Anywhere that needs
 * the v1-only variant should import SCHEMA_INSTRUCTION_V1 directly.
 */
export const SCHEMA_INSTRUCTION = SCHEMA_INSTRUCTION_V2;
