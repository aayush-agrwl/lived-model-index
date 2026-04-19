/**
 * The pinned model panel for the Lived Model Index.
 *
 * Each entry is version-locked to a specific model ID so that "drift" in
 * collected data reflects genuine changes in responses, not silent vendor
 * model swaps. Adding or removing a model is an intentional research
 * decision that should bump the panel version (below) and be noted in
 * /methodology on the public site.
 */

export const MODEL_PANEL_VERSION = "panel_v1_free";

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
    slug: "gemini-2_5-pro",
    displayName: "Gemini 2.5 Pro",
    provider: "google",
    modelId: "gemini-2.5-pro",
    family: "Gemini",
    order: 10,
  },
  {
    slug: "gemini-2_5-flash",
    displayName: "Gemini 2.5 Flash",
    provider: "google",
    modelId: "gemini-2.5-flash",
    family: "Gemini",
    order: 20,
  },
  {
    slug: "llama-3_3-70b-groq",
    displayName: "Llama 3.3 70B",
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    family: "Llama",
    order: 30,
  },
  {
    slug: "mixtral-8x7b-groq",
    displayName: "Mixtral 8x7B",
    provider: "groq",
    modelId: "mixtral-8x7b-32768",
    family: "Mixtral",
    order: 40,
  },
  {
    slug: "deepseek-v3-openrouter",
    displayName: "DeepSeek V3",
    provider: "openrouter",
    modelId: "deepseek/deepseek-chat:free",
    family: "DeepSeek",
    order: 50,
  },
  {
    slug: "qwen-2_5-72b-openrouter",
    displayName: "Qwen 2.5 72B",
    provider: "openrouter",
    modelId: "qwen/qwen-2.5-72b-instruct:free",
    family: "Qwen",
    order: 60,
  },
];

/**
 * The dedicated rater model. Kept fixed so inter-rater reliability
 * measurements are comparable over time.
 */
export const RATER_MODEL: ModelEntry = {
  slug: "rater-llama-3_3-70b-groq",
  displayName: "Llama 3.3 70B (rater)",
  provider: "groq",
  modelId: "llama-3.3-70b-versatile",
  family: "Llama",
  order: 999,
};

export function findCollector(slug: string): ModelEntry | undefined {
  return COLLECTOR_MODELS.find((m) => m.slug === slug);
}
