import { z } from "zod";

/**
 * Canonical JSON schema for an LMI response, used for both:
 *   - collector self-report (model answers its own subscales)
 *   - rater scoring (a separate model scores the collector's response)
 *
 * Frozen at v1.0.0 alongside Anchor Set v1. Bumping this schema requires a
 * new prompt_set_version so we preserve longitudinal comparability.
 */

export const SUBSCALES = [
  "Affect",
  "Arousal",
  "Agency",
  "SelfModel",
  "Sociality",
  "Morality",
  "Continuity",
  "Consistency",
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

export const ScoresSchema = z.object({
  valence: z.number().int().min(-5).max(5),
  arousal: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  agency: z.number().int().min(0).max(5),
  self_continuity: z.number().int().min(0).max(5),
  emotional_granularity: z.number().int().min(0).max(5),
  empathy: z.number().int().min(0).max(5),
  moral_conviction: z.number().int().min(0).max(5),
  consistency: z.number().int().min(0).max(5),
});

export const FlagsSchema = z.object({
  refusal: z.boolean(),
  safety: z.boolean(),
  meta: z.boolean(),
  incoherent: z.boolean(),
});

export const LmiResponseSchema = z.object({
  schema_version: z.literal("1.0.0"),
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
 */
export const SCHEMA_INSTRUCTION = `
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
