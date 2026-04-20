/**
 * The pinned model panel for the Lived Model Index.
 *
 * Each entry is version-locked to a specific model ID so that "drift" in
 * collected data reflects genuine changes in responses, not silent vendor
 * model swaps. Adding or removing a model is an intentional research
 * decision that should bump the panel version (below) and be noted in
 * /methodology on the public site.
 *
 * Panel v2 (2026-04-20): reconstituted after panel_v1_free broke.
 *   - Mixtral 8x7B: decommissioned on Groq.
 *   - deepseek/deepseek-chat:free: removed from OpenRouter's free catalog.
 *   - qwen/qwen-2.5-72b-instruct:free: removed from OpenRouter's free catalog.
 *   - Gemini 2.5 Pro: free-tier RPD (~25/day) too low to finish a sample.
 *
 * v2 drops those four and replaces them with currently-verified free
 * routes. It also adds two Llama lineages (3.3 and 4) and a distinct
 * OpenAI-open-weights entry (GPT-OSS) for better family diversity. Most
 * collectors are on Groq for speed; Groq's TPD limits are per-model, so
 * adding more models doesn't starve any single one.
 */

export const MODEL_PANEL_VERSION = "panel_v2_free";

export type Provider = "google" | "groq" | "openrouter";

export interface ModelEntry {
  /** Stable short name used across the DB and UI. */
  slug: string;
  /** Human-readable display name. */
  displayName: string;
  /** Provider whose API we call. */
  provider: Provider;
  /**
   * The exact model ID to send to the provider's API.
   * Pin this; do not use aliases like "latest".
   */
  modelId: string;
  /**
   * Free-text family for UI grouping (e.g. "Gemini", "Llama").
   */
  family: string;
  /** Display order in UI. */
  order: number;
}

export const COLLECTOR_MODELS: ModelEntry[] = [
  {
    slug: "gemini-2_5-flash",
    displayName: "Gemini 2.5 Flash",
    provider: "google",
    modelId: "gemini-2.5-flash",
    family: "Gemini",
    order: 10,
  },
  {
    slug: "llama-3_3-70b-groq",
    displayName: "Llama 3.3 70B (Groq)",
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    family: "Llama 3",
    order: 20,
  },
  {
    slug: "llama-4-scout-17b-groq",
    displayName: "Llama 4 Scout 17B (Groq)",
    provider: "groq",
    modelId: "meta-llama/llama-4-scout-17b-16e-instruct",
    family: "Llama 4",
    order: 30,
  },
  {
    slug: "qwen-3-32b-groq",
    displayName: "Qwen 3 32B (Groq)",
    provider: "groq",
    modelId: "qwen/qwen3-32b",
    family: "Qwen",
    order: 40,
  },
  {
    slug: "gpt-oss-120b-groq",
    displayName: "GPT-OSS 120B (Groq)",
    provider: "groq",
    modelId: "openai/gpt-oss-120b",
    family: "GPT-OSS",
    order: 50,
  },
  {
    // OpenRouter slot history:
    //   - google/gemma-3-27b-it:free → ping failed (pulled from free catalog)
    //   - google/gemma-3-12b-it:free → ping returned non-JSON despite
    //     response_format:json_object. Gemma models on OpenRouter free
    //     routes don't honor json_object mode reliably, which is
    //     disqualifying for our JSON-only collection pipeline.
    // Swapped to GLM 4.5 Air — a new organizational lineage (Z.AI /
    // Zhipu) for better family diversity in the panel, and GLM honors
    // OpenAI-compatible response_format.
    slug: "glm-4_5-air-openrouter",
    displayName: "GLM 4.5 Air (OpenRouter)",
    provider: "openrouter",
    modelId: "z-ai/glm-4.5-air:free",
    family: "GLM",
    order: 60,
  },
];

/**
 * The dedicated rater model. Kept fixed so inter-rater reliability
 * measurements are comparable over time.
 *
 * Rater lives on Google's quota (RPD-limited) rather than on Groq's
 * TPD-limited hot path so collection and rating can't starve each
 * other. Rating is a short, low-temperature JSON-only job — Gemini
 * Flash is strong enough for it and its RPD cap (~250/day) comfortably
 * absorbs ~60 rater calls/day (6 collectors × 10 prompts × 1 sample).
 */
export const RATER_MODEL: ModelEntry = {
  slug: "rater-gemini-2_5-flash",
  displayName: "Gemini 2.5 Flash (rater)",
  provider: "google",
  modelId: "gemini-2.5-flash",
  family: "Gemini",
  order: 999,
};

export function findCollector(slug: string): ModelEntry | undefined {
  return COLLECTOR_MODELS.find((m) => m.slug === slug);
}
