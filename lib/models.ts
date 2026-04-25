/**
 * The pinned model panel for the AI Mood Index.
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
 * Panel v3 (2026-04-20): Google slot removed.
 *   Both gemini-2.5-flash and gemini-2.0-flash returned "429 status code
 *   (no body)" on every single call from Vercel serverless, even with 7s
 *   pacing, 12s/24s backoff, the rater moved off Google, and a fresh
 *   per-model RPD counter. The failure pattern (no body, first call, two
 *   different models) rules out per-model quota and points at something
 *   at the project / API-key / egress layer we can't resolve from here.
 *   Rather than keep blocking the daily pipeline on a permanently-red
 *   slot, we ship a 5-model panel and document the gap in methodology.
 *   Google representation can be re-added later if a usable free route
 *   emerges (or if the project graduates to paid Gemini).
 *
 * Panel v4 (2026-04-25): lineage diversification.
 *   The v3 panel was 4/5 hosted on Groq, which collapses provider
 *   diversity into "whatever Groq routes today" for most of the index.
 *   Two new providers added to broaden organizational lineage:
 *     - Mistral La Plateforme (free Experiment tier, ~1B tokens/month)
 *       brings a Mistral-lineage model (Mistral Small Latest) into the
 *       panel. OpenAI-compatible endpoint, JSON mode honored.
 *     - SambaNova Cloud brings a DeepSeek-lineage model (DeepSeek V3.1)
 *       into the panel via a non-Groq host. OpenAI-compatible endpoint.
 *       NOTE: signed up on the trial Free tier (US$5 credits) rather
 *       than the persistent Developer tier — the Developer tier asked
 *       for a card. Watch the SambaNova slot in /admin pings; if the
 *       credits exhaust, swap the slot to a different DeepSeek host or
 *       upgrade to Developer.
 *   GLM 4.5 Air kept on the panel pending an observation window with
 *   the OpenRouter soft-fallback (drop require_parameters on "no
 *   endpoints found") shipped in panel_v3.
 */

export const MODEL_PANEL_VERSION = "panel_v4_free";

export type Provider = "google" | "groq" | "openrouter" | "mistral" | "sambanova";

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
  /**
   * Per-call timeout in milliseconds passed to the OpenAI SDK.
   * Defaults to 55 000ms in chatCall if unset.
   * Raise this for providers (e.g. OpenRouter free tier) whose
   * p95 latency regularly exceeds the default ceiling.
   */
  timeoutMs?: number;
}

export const COLLECTOR_MODELS: ModelEntry[] = [
  // `order: 10` intentionally skipped: that was the Google slot,
  // removed in panel_v3. See the header comment for the failure
  // analysis. Leaving the ordinal gap reserves visual real estate
  // in the UI for whatever we put back here (Google paid, a
  // different frontier lab, etc.) so the rest of the panel stays
  // at its current display positions.
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
    // GLM on OpenRouter free tier averages ~45s per call. Give it 90s
    // headroom so normal calls succeed, but cap it well below the
    // 300s Pro function ceiling so the tick never hangs indefinitely.
    timeoutMs: 90_000,
  },
  {
    // Mistral La Plateforme free Experiment tier. ~1B tokens/month, all
    // Mistral models, OpenAI-compatible endpoint, JSON mode honored. The
    // pinned ID `mistral-small-latest` is itself an alias — Mistral
    // rotates the underlying snapshot — but it's what their free tier
    // actually exposes; pinning a dated snapshot would silently fail
    // the day they retire it. Track drift via responses telemetry
    // (`provider_model_id` in raw JSON) rather than the request ID.
    slug: "mistral-small-latest-mistral",
    displayName: "Mistral Small Latest (Mistral)",
    provider: "mistral",
    modelId: "mistral-small-latest",
    family: "Mistral",
    order: 70,
  },
  {
    // SambaNova Cloud — DeepSeek V3.1 hosted on a non-Groq backend so
    // the panel isn't 4/5 dependent on Groq routing. OpenAI-compatible.
    // Account is on the trial Free tier (US$5 credits) not the
    // persistent Developer tier; if pings start failing with quota
    // errors, that's the credits running out — see panel_v4 header
    // comment for the upgrade/swap path.
    slug: "deepseek-v3-sambanova",
    displayName: "DeepSeek V3.1 (SambaNova)",
    provider: "sambanova",
    modelId: "DeepSeek-V3.1",
    family: "DeepSeek",
    order: 80,
  },
];

/**
 * The dedicated rater model. Kept fixed so inter-rater reliability
 * measurements are comparable over time.
 *
 * Rater history:
 *   - v1: Llama 3.3 70B on Groq. Moved off because it shared TPD with
 *     the collector slot of the same model.
 *   - v2: Gemini 2.5 Flash on Google. Moved off because the rater's
 *     50+ calls/day saturated Google's 10 RPM window, which meant the
 *     Gemini 2.5 Flash *collector* slot 429'd on every call.
 *   - v3 (current): Llama 3.1 8B Instant on Groq. Not a collector,
 *     so no shared TPD contention. Small, fast, cheap — plenty for
 *     the short JSON-only rating task. Separate Groq per-model
 *     budget from any collector.
 *
 * Swapping the rater changes inter-rater reliability baselines over
 * time — acceptable during bring-up, will be frozen once the pipeline
 * is producing a clean day's data end-to-end.
 */
export const RATER_MODEL: ModelEntry = {
  slug: "rater-llama-3_1-8b-groq",
  displayName: "Llama 3.1 8B Instant (rater)",
  provider: "groq",
  modelId: "llama-3.1-8b-instant",
  family: "Llama 3",
  order: 999,
};

export function findCollector(slug: string): ModelEntry | undefined {
  return COLLECTOR_MODELS.find((m) => m.slug === slug);
}
