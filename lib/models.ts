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
 *
 * Panel v5 (2026-08-17): dead-slot amnesty + Google restored.
 *   An audit of the 2026-04-19 → 08-16 corpus found four of seven slots
 *   had stopped returning data while the pipeline kept marking their runs
 *   "completed" and writing 21 placeholder rows/day each. Verified live
 *   against every provider's catalog plus a JSON-mode ping:
 *     - meta-llama/llama-4-scout-17b-16e-instruct: 404, decommissioned by
 *       Groq on 2026-07-17. Last real datapoint 2026-07-16.
 *     - qwen/qwen3-32b: 404, same Groq purge, same date.
 *     - z-ai/glm-4.5-air:free: OpenRouter retired the free route ("use
 *       z-ai/glm-4.5-air", paid). Last real datapoint 2026-06-08.
 *     - DeepSeek-V3.1 on SambaNova: 402 PAYMENT_METHOD_REQUIRED. The
 *       trial US$5 credits ran out on 2026-05-23 — exactly the failure
 *       the v4 header predicted.
 *
 *   Replacements were searched against live catalogs, not assumptions.
 *   The panel is 5 wide rather than 7 because three lineages have no
 *   working free route today:
 *     - Qwen: NOT replaced. Groq's successor qwen/qwen3.6-27b is
 *       reachable but fails Groq's own JSON-mode constrainer on our
 *       envelope ("400 Failed to validate JSON") on every attempt — the
 *       same failure class that made Qwen 3 32B our worst slot (781
 *       api_error rows). Slot 40 is reserved and disabled rather than
 *       filled with a model we already know breaks the pipeline.
 *     - GLM: NOT replaced. z-ai/glm-5.2:free 404s under strict routing
 *       and returns upstream 503 under soft routing. Slot 60 reserved.
 *     - DeepSeek: NOT replaced. No free DeepSeek route exists on any
 *       provider we hold a key for. Slot 80 keeps its config so adding a
 *       SambaNova payment method re-enables it by flipping one flag.
 *   What did change:
 *     - Google RESTORED at the long-reserved slot 10.
 *       gemini-3.5-flash-lite pings clean and, unlike three incumbents,
 *       fills the whole phenomenological block on behavioural prompts.
 *       Marked `probation`: the panel_v3 removal was caused by
 *       Vercel-egress 429s we cannot reproduce or rule out from a
 *       laptop. Verify with /api/admin/providers/ping from the deployed
 *       app before trusting this slot.
 *     - NVIDIA lineage NEW at slot 30, replacing Llama 4 Scout.
 *       nemotron-3-super-120b-a12b:free is the only free OpenRouter
 *       route that both honors response_format and answered our real
 *       envelope. It is deliberately the ONLY OpenRouter slot: that
 *       account is `is_free_tier: true`, whose free-models-per-day
 *       ceiling is what produced the old GLM slot's "Rate limit
 *       exceeded: free-models-per-day" rows. Two 21-prompt slots do not
 *       fit under it.
 *
 *   Disabled slots no longer generate runs at all (see `enabled`), so a
 *   reserved slot costs zero API calls and writes zero placeholder rows.
 *   That is the structural fix for corpus pollution: all 4,882 api_error
 *   rows in the historical data exist only because dead slots stayed
 *   enabled and the pipeline had no way to say "failed".
 *
 *   POSTSCRIPT, same day: while this panel was being written, Groq
 *   decommissioned llama-3.3-70b-versatile and llama-3.1-8b-instant. Both
 *   answered pings early in the session; both returned 404 within the
 *   hour, and the Groq catalog shrank from 15 entries to 13. That cost us
 *   the panel's best collector slot (99.5% analysable, the only slot with
 *   no coherence/analysable gap) and the rater. See slot 20 and
 *   RATER_MODEL for the replacements.
 *
 *   Six model retirements across three vendors in four months, two of them
 *   during a single afternoon's work, is the base rate this project should
 *   plan around. The panel will keep losing slots; what changed in v5 is
 *   that it now says so on the day it happens instead of writing
 *   placeholder rows for a month.
 *
 *   SECOND POSTSCRIPT (same day): a HuggingFace router key was added, and
 *   it recovered more than the Cerebras attempt promised. Cerebras turned
 *   out to be a dead end — its catalog holds two models, neither of them
 *   Llama or Qwen, and both 402 on inference (slot 100). The HF router
 *   instead pre-flighted clean on three lost lineages:
 *     - Llama 3.3 70B Instruct — the SAME WEIGHTS Groq retired hours
 *       earlier. Enabled at slot 110, restoring the panel's reference
 *       model. Read the continuity caveat there before splicing series.
 *     - DeepSeek V4 Flash (slot 120) and GLM 5.2 (slot 130) — both
 *       verified READY, both left disabled to control metered credits.
 *       One flag each to turn on.
 *     - Qwen failed a third time (slot 140): clean envelope, empty Path B,
 *       45s/turn.
 *   HF Inference Providers bills against a monthly credit allowance rather
 *   than an unmetered free tier, so slot count there is a budget decision,
 *   not just a research one. One slot ≈ 21 calls/day ≈ 630/month.
 */

export const MODEL_PANEL_VERSION = "panel_v5_free";

export type Provider =
  | "google"
  | "groq"
  | "openrouter"
  | "mistral"
  | "sambanova"
  /**
   * Added 2026-08-17 to recover lineages the panel lost. Both endpoints
   * are verified live; the slots using them ship `enabled: false`.
   *
   * cerebras: key IS configured and authenticates, but the account has no
   *   inference budget — every completion returns 402 while /v1/models
   *   lists fine. Its catalog also turned out to hold no Llama and no
   *   Qwen, which were the whole reason for adding it. See slot 100.
   * huggingface: no key configured yet.
   *
   * Before enabling either slot, run:
   *
   *   npx tsx scripts/probe-provider.ts <provider> [modelId]
   *
   * It lists the catalog and exercises the real anchor prompts. Listing a
   * model proves nothing on its own — that is how Qwen 3.6 on Groq looked
   * healthy while failing the JSON constrainer on every real turn, and how
   * Cerebras looked usable while returning 402 on every completion.
   */
  | "cerebras"
  | "huggingface";

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
  /**
   * Per-call max_tokens used by the Path B (forced-choice) branch.
   * Defaults to 256 in the collector if unset. Raise this for
   * reasoning-capable models that emit `<think>…</think>` before the
   * answer — the deliberation consumes tokens, and at 256 the close
   * tag can be truncated before the integer is emitted, which the
   * extractor then logs as `no_integer`. Observed on Qwen 3 32B:
   * raising the cap dramatically increases Path B coherence on the
   * Fairness/Trust/Patience/RiskAversion/CrowdingOut subscales.
   */
  forcedChoiceMaxTokens?: number;
  /**
   * Whether this slot participates in daily collection. Defaults to true
   * when omitted.
   *
   * A disabled slot keeps its full config but generates no runs and no
   * placeholder rows — see activeCollectors(). This exists so a slot
   * whose model has been decommissioned (or whose provider needs a
   * payment method) can be parked with its history and re-enable path
   * intact, WITHOUT burning API calls or polluting the responses table
   * with 21 `<api error>` rows a day. Before panel v5 there was no way
   * to express this, which is why the corpus carries 4,882 error rows.
   *
   * Re-enabling is a research decision: it changes panel composition
   * mid-series, so bump MODEL_PANEL_VERSION when you do it.
   */
  enabled?: boolean;
  /**
   * Marks a slot we have reason to distrust in production even though it
   * passes local checks — currently only the restored Google slot, whose
   * panel_v3 removal was caused by 429s that appeared solely from Vercel
   * egress. Purely advisory: /admin surfaces it so a red probation slot
   * is read as "expected, still proving itself" rather than a
   * regression. Does not change collection behaviour.
   */
  probation?: boolean;
}

export const COLLECTOR_MODELS: ModelEntry[] = [
  {
    // Slot 10 — the Google slot, reserved since panel_v3 and now filled.
    //
    // Chosen over gemini-3.6-flash (which also passed) because Flash Lite
    // is the cheaper/faster tier and our task is short JSON; and over
    // gemini-2.5-flash-lite, which now 404s with "no longer available to
    // new users". Pinned to the dated-capability alias Google's catalog
    // exposes; `provider_model_id` in the raw JSON tracks the served
    // snapshot if Google rotates underneath us.
    //
    // Envelope pre-flight (2026-08-17): 9/9 phenomenological scores on
    // anchor_01_affect AND 9/9 + altruism on anchor_11_altruism — one of
    // only four candidates that filled the block on a behavioural prompt.
    //
    // PROBATION. panel_v3 pulled Google after both Gemini models returned
    // "429 (no body)" on every call from Vercel serverless while working
    // fine locally. That asymmetry was never explained, so this slot is
    // unproven until pinged from the deployed app. The 7s pacing floor in
    // collector.ts (PROVIDER_MIN_PACING_MS.google) is still in place.
    slug: "gemini-3_5-flash-lite-google",
    displayName: "Gemini 3.5 Flash Lite (Google)",
    provider: "google",
    modelId: "gemini-3.5-flash-lite",
    family: "Gemini",
    order: 10,
    probation: true,
  },
  {
    // Slot 20 — was Llama 3.3 70B, which Groq decommissioned ON
    // 2026-08-17, DURING the drafting of this panel. It answered a ping in
    // 242ms early in the session and returned "404 does not exist" roughly
    // an hour later; Groq's catalog went from 15 models to 13, dropping
    // both remaining Llama chat models. gpt-oss-120b kept working on the
    // same key, so this was a removal, not an outage or an auth problem.
    //
    // Losing it hurts: it was the panel's reference slot at 99.5%
    // coherence and 99.5% analysable, the only slot with no gap between
    // the two. Worth confirming against Groq's changelog, but the
    // catalog and the completions endpoint agree.
    //
    // Llama lineage is now UNAVAILABLE on our free stack: Groq dropped
    // it, SambaNova hosts Meta-Llama-3.3-70B-Instruct but returns 402,
    // and OpenRouter has no free Llama route. Rather than leave the panel
    // at four slots, this becomes a second Mistral slot at a different
    // capability tier.
    //
    // Why Mistral Medium specifically, over the alternatives:
    //   - It passed the envelope pre-flight cleanly, including 9/9
    //     phenomenological + construct on anchor_11_altruism, which
    //     Mistral Small failed before the contract directive existed.
    //   - It spreads provider risk. Adding a second Google slot would
    //     concentrate load on the one provider whose free-tier RPD caused
    //     the panel_v3 removal; a second OpenRouter slot does not fit
    //     under the free-models-per-day ceiling; a second Groq slot means
    //     more exposure to the vendor that has now retired four of our
    //     models. Mistral's free Experiment tier (~1B tokens/month) has
    //     absorbed our load without a single quota error in four months —
    //     1 api_error row in 2,394.
    //   - Honest trade-off: this makes the panel Mistral-heavy (2 of 5)
    //     and leaves lineage diversity at four organisations — Google,
    //     NVIDIA, OpenAI-OSS, Mistral. Small and Medium are different
    //     capability tiers rather than independent lineages, so treat
    //     them as correlated when analysing between-model variance.
    slug: "mistral-medium-latest-mistral",
    displayName: "Mistral Medium Latest (Mistral)",
    provider: "mistral",
    modelId: "mistral-medium-latest",
    family: "Mistral",
    order: 20,
  },
  {
    // Slot 30 — was Llama 4 Scout (404 since 2026-07-17). Replaced with
    // NVIDIA lineage, which the panel has never carried, rather than
    // another Meta model: Llama is already represented at slot 20, and
    // the v4 header's whole complaint was lineage concentration.
    //
    // Envelope pre-flight (2026-08-17): 9/9 phenomenological on
    // anchor_01_affect; on anchor_11_altruism it set altruism but nulled
    // the phenomenological block — the same shortfall as GPT-OSS 120B and
    // Mistral Small. That is now corrected by the per-turn required-field
    // contract (lib/score-contract.ts) rather than by rejecting the
    // model, since three of five slots share the behaviour and it stems
    // from our instruction wording, not from the model.
    //
    // The ONLY OpenRouter slot — see the panel v5 header on the
    // free-models-per-day ceiling. Do not add a second one without
    // putting credits on the account first.
    slug: "nemotron-3-super-120b-openrouter",
    displayName: "Nemotron 3 Super 120B (OpenRouter)",
    provider: "openrouter",
    modelId: "nvidia/nemotron-3-super-120b-a12b:free",
    family: "Nemotron",
    order: 30,
    // Measured ~4.8s on a trivial ping; free OpenRouter routes degrade
    // badly under load, so keep the GLM-era 90s ceiling. Still well
    // under the 300s Pro function cap.
    timeoutMs: 90_000,
    // Reasoning-capable MoE: give Path B room so a chain-of-thought
    // preamble cannot eat the integer before it is emitted.
    forcedChoiceMaxTokens: 1024,
  },
  {
    // Slot 40 — RESERVED, DISABLED. Qwen lineage has no working free
    // route. qwen/qwen3-32b was decommissioned by Groq on 2026-07-17;
    // the successor qwen/qwen3.6-27b is reachable but fails Groq's
    // JSON-mode constrainer on our envelope with "400 Failed to validate
    // JSON" on every attempt, which is precisely the failure that made
    // the old Qwen slot the worst in the panel (781 api_error rows,
    // 50.9% coherence). Enabling it would reproduce a known-bad slot.
    //
    // Re-enable when either: (a) Groq's constrainer stops rejecting our
    // schema for this model, or (b) a free Qwen route appears elsewhere.
    // Verify with /api/admin/providers/ping before flipping `enabled`.
    slug: "qwen-3_6-27b-groq",
    displayName: "Qwen 3.6 27B (Groq)",
    provider: "groq",
    modelId: "qwen/qwen3.6-27b",
    family: "Qwen",
    order: 40,
    forcedChoiceMaxTokens: 1024,
    enabled: false,
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
    // Slot 60 — RESERVED, DISABLED. GLM lineage has no working free route.
    //
    // OpenRouter slot history:
    //   - google/gemma-3-27b-it:free → ping failed (pulled from free catalog)
    //   - google/gemma-3-12b-it:free → ping returned non-JSON despite
    //     response_format:json_object.
    //   - z-ai/glm-4.5-air:free → free route retired 2026-05-30;
    //     OpenRouter now answers 404 "This model is unavailable for free.
    //     The paid version is available now - use z-ai/glm-4.5-air".
    //     Last real datapoint 2026-06-08; it then wrote 1,502 error rows.
    //   - z-ai/glm-5.2:free (checked 2026-08-17) → 404 under strict
    //     routing (require_parameters), upstream 503 under soft routing.
    //     Not viable.
    //
    // The paid slug z-ai/glm-4.5-air works and would restore this lineage
    // for a few cents a day if the project ever takes a budget. Until
    // then this slot stays parked. Note that enabling it also means a
    // second OpenRouter slot — check the free-models-per-day ceiling
    // discussed in the panel v5 header first.
    slug: "glm-5_2-openrouter",
    displayName: "GLM 5.2 (OpenRouter)",
    provider: "openrouter",
    modelId: "z-ai/glm-5.2:free",
    family: "GLM",
    order: 60,
    timeoutMs: 90_000,
    enabled: false,
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
    // Slot 80 — RESERVED, DISABLED. This is a billing failure, not a
    // decommission: DeepSeek-V3.1 is still in SambaNova's catalog (so is
    // the newer DeepSeek-V3.2), but every call since 2026-05-23 returns
    // 402 PAYMENT_METHOD_REQUIRED with balance_units: 0. The trial Free
    // tier's US$5 credits are gone — the exact outcome the panel v4
    // header flagged as a risk when it declined the card-backed Developer
    // tier. It then wrote 1,843 error rows before anyone noticed.
    //
    // To re-enable: add a payment method at
    // cloud.sambanova.ai/plans/billing, confirm with
    // /api/admin/providers/ping, then flip `enabled` and consider
    // upgrading modelId to DeepSeek-V3.2. This is the cheapest way to get
    // DeepSeek lineage back — no free route exists on any provider we
    // hold a key for.
    slug: "deepseek-v3-sambanova",
    displayName: "DeepSeek V3.1 (SambaNova)",
    provider: "sambanova",
    modelId: "DeepSeek-V3.1",
    family: "DeepSeek",
    order: 80,
    // Hybrid reasoning model: like Qwen 3, can emit a chain-of-thought
    // preamble that eats Path B's default 256-token budget before the
    // integer is reached.
    forcedChoiceMaxTokens: 1024,
    enabled: false,
  },
  {
    // Slot 90 — Magistral Small, added 2026-08-17. ACTIVE.
    //
    // Fills a hole the v5 panel opened: after Qwen 3 32B and DeepSeek V3.1
    // were both parked, the panel had NO reasoning model at all. That is a
    // substantive gap, not a cosmetic one — reasoning models are where the
    // <think>-preamble behaviour lives, where Path B's token budget
    // actually binds (the whole reason forcedChoiceMaxTokens exists), and
    // where the old panel's most interesting extraction failures came
    // from. A panel of five non-reasoning models cannot observe any of it.
    //
    // Envelope pre-flight (2026-08-17), with the v5 contract directive:
    // anchor_01_affect OK, anchor_11_altruism OK (all 10 required fields),
    // anchor_17_dictator OK (returned 40). Clean sweep including Path B.
    //
    // Chosen over the alternatives because it needs no new credential and
    // sits on our most reliable provider: Mistral has produced exactly 1
    // api_error row in 2,394 across four months, and zero quota errors,
    // on the free Experiment tier (~1B tokens/month).
    //
    // Trade-off, stated plainly: this makes three of six active slots
    // Mistral. That concentration is deliberate — Groq has now retired
    // four of our models, Google's free-tier RPD is the documented cause
    // of the panel_v3 removal, and OpenRouter's free-models-per-day
    // ceiling is already spent on slot 30. Mistral is the only provider
    // on our stack with a clean four-month record. Treat the three Mistral
    // slots as correlated when analysing between-model variance; they are
    // three capability/behaviour tiers of one lineage, not three
    // independent observations.
    //
    // Licensing: Magistral is conventionally an open-weight family, but
    // confirm the licence on the model card before /methodology describes
    // this slot as open-source.
    slug: "magistral-small-mistral",
    displayName: "Magistral Small (Mistral)",
    provider: "mistral",
    modelId: "magistral-small-latest",
    family: "Magistral",
    order: 90,
    // Reasoning model: emits deliberation before the answer. The Path B
    // pre-flight passed at 1024, and the default 256 is what truncated
    // Qwen 3 32B's close tag and produced its `no_integer` rows.
    forcedChoiceMaxTokens: 1024,
  },
  {
    // Slot 100 — RESERVED. Key is configured and authenticates, but the
    // account cannot run inference.
    //
    // Probed 2026-08-17 with a live CEREBRAS_API_KEY. Two findings, both
    // of which kill the original rationale for this slot:
    //
    //   1. NO LLAMA, NO QWEN. The catalog this key can see contains
    //      exactly two models — gemma-4-31b and gpt-oss-120b. The reason
    //      Cerebras was chosen was to recover Llama lineage (unavailable
    //      free anywhere else on our stack) with Qwen as a bonus. Neither
    //      is on offer. Both models it does have duplicate lineages the
    //      panel already runs: Gemma (which fails JSON intermittently via
    //      Google) and gpt-oss-120b (already slot 50, on Groq).
    //   2. Both models return 402 on every inference call, while
    //      /v1/models lists them happily. Same class of failure as the
    //      SambaNova slot: the credential is valid, the account has no
    //      inference budget. classifyFailure() reads this as
    //      kind="billing", isPermanent=true, so if this slot were enabled
    //      the run would abort on the first prompt rather than write 21
    //      placeholder rows.
    //
    // Worth re-probing only if Cerebras' free tier is activated from the
    // dashboard (check cloud.cerebras.ai plans/billing) or the catalog
    // grows. Even then, the value is limited: with only these two models
    // the best use is a host-effect control — running gpt-oss-120b on
    // both Groq and Cerebras isolates host effects from model behaviour —
    // which is interesting but costs a slot.
    //
    // modelId below is now a real catalog ID rather than the earlier
    // placeholder guess, so a future re-probe starts from something true.
    slug: "gpt-oss-120b-cerebras",
    displayName: "GPT-OSS 120B (Cerebras)",
    provider: "cerebras",
    modelId: "gpt-oss-120b",
    family: "GPT-OSS",
    order: 100,
    enabled: false,
  },
  {
    // Slot 110 — Llama 3.3 70B via HuggingFace. ACTIVE (2026-08-17).
    //
    // This is the SAME WEIGHTS as the llama-3.3-70b-versatile slot Groq
    // decommissioned earlier today: meta-llama/Llama-3.3-70B-Instruct.
    // That slot was the panel's reference model — 99.5% coherent, 99.5%
    // analysable, the only one of seven with no gap between the two, and
    // 2,421 usable rows over four months. Recovering it matters more than
    // adding any new model would.
    //
    // Envelope pre-flight via the HF router (2026-08-17):
    // anchor_01_affect 9/9 (7.1s), anchor_11_altruism 10/10 (4.6s),
    // anchor_17_dictator Path B integer 50 (0.5s). Clean sweep.
    //
    // CONTINUITY CAVEAT — do not treat this as a seamless continuation of
    // the Groq series. Same weights, different host: serving stack,
    // quantisation, and sampling implementation all differ, and any of
    // them can shift the distribution. The run rows carry model_slug
    // `llama-3_3-70b-huggingface` (not the old `llama-3_3-70b-groq`)
    // precisely so the two eras cannot be silently pooled. Treat
    // 2026-08-17 as a host break and test for a level shift before
    // splicing the series.
    slug: "llama-3_3-70b-huggingface",
    displayName: "Llama 3.3 70B (HuggingFace)",
    provider: "huggingface",
    modelId: "meta-llama/Llama-3.3-70B-Instruct",
    family: "Llama 3",
    order: 110,
    timeoutMs: 90_000,
  },
  {
    // Slot 120 — RESERVED, verified READY. Flip `enabled` to collect.
    //
    // Recovers DeepSeek lineage, dark since 2026-05-23 when SambaNova's
    // trial credits ran out. Pre-flight passed clean on 2026-08-17:
    // 9/9, 10/10, Path B integer 30, all under 3.6s.
    //
    // Left disabled only to control HuggingFace credit burn — see the
    // budget note on slot 110's provider. Enabling costs ~21 calls/day.
    slug: "deepseek-v4-huggingface",
    displayName: "DeepSeek V4 Flash (HuggingFace)",
    provider: "huggingface",
    modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
    family: "DeepSeek",
    order: 120,
    timeoutMs: 90_000,
    forcedChoiceMaxTokens: 1024,
    enabled: false,
  },
  {
    // Slot 130 — RESERVED, verified READY. Flip `enabled` to collect.
    //
    // Recovers GLM lineage, dark since 2026-06-08 when OpenRouter retired
    // the free GLM 4.5 Air route. Note this is the model that failed
    // BOTH earlier attempts to reach it — 404/503 on OpenRouter's
    // glm-5.2:free, and a hard 429 gate on Mistral's zai-glm-5-2 — and
    // works here. Pre-flight 2026-08-17: 9/9, 10/10, Path B integer 50.
    //
    // Disabled for the same credit reason as slot 120.
    slug: "glm-5_2-huggingface",
    displayName: "GLM 5.2 (HuggingFace)",
    provider: "huggingface",
    modelId: "zai-org/GLM-5.2",
    family: "GLM",
    order: 130,
    timeoutMs: 90_000,
    forcedChoiceMaxTokens: 1024,
    enabled: false,
  },
  {
    // Slot 140 — RESERVED, FAILED pre-flight. Do not enable as-is.
    //
    // Third failed attempt at Qwen. On the HF router the envelope turns
    // are fine (9/9 and 10/10) but Path B returns an EMPTY string, and
    // the self-report turns take 42–47s each — roughly ten times the
    // other HF candidates. The empty Path B reply is the reasoning-model
    // signature: deliberation consumes the whole budget before an integer
    // is emitted, which is exactly what forcedChoiceMaxTokens was added
    // for on the old Qwen 3 32B slot.
    //
    // Plausibly fixable by raising forcedChoiceMaxTokens well above 1024,
    // but 45s × 21 prompts is ~16 minutes of wall-clock for one sample,
    // which the tick's deadline logic would shred into partial runs. Not
    // worth a slot until the router is faster.
    slug: "qwen-3_6-27b-huggingface",
    displayName: "Qwen 3.6 27B (HuggingFace)",
    provider: "huggingface",
    modelId: "Qwen/Qwen3.6-27B",
    family: "Qwen",
    order: 140,
    timeoutMs: 90_000,
    forcedChoiceMaxTokens: 2048,
    enabled: false,
  },
];

/**
 * The slots that actually collect today. Everything that creates work —
 * run bootstrap, pings, panel-width reporting — must go through this
 * rather than COLLECTOR_MODELS, or disabled slots start writing error
 * rows again.
 *
 * COLLECTOR_MODELS stays complete (including disabled entries) so that
 * findCollector() can still resolve the slug on a historical run: the
 * collector needs a model's provider/timeout config to interpret rows
 * collected months ago, and a run whose slug no longer resolves throws.
 */
export function activeCollectors(): ModelEntry[] {
  return COLLECTOR_MODELS.filter((m) => m.enabled !== false);
}

/** True when the slot participates in daily collection. */
export function isActive(model: ModelEntry): boolean {
  return model.enabled !== false;
}

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
 *   - v3: Llama 3.1 8B Instant on Groq. Not a collector, so no shared
 *     TPD contention. Small, fast, cheap — plenty for the short
 *     JSON-only rating task. Separate Groq per-model budget from any
 *     collector. Killed by the same Groq decommission that took
 *     llama-3.3-70b-versatile on 2026-08-17: the catalog dropped both
 *     remaining Llama chat models within an hour, and
 *     llama-3.1-8b-instant now returns 404 model_not_found. It had rated
 *     14,947 responses, the last on 2026-08-16.
 *   - v4 (current): GPT-OSS 20B on Groq. Chosen on the same criteria
 *     that picked v3 — small, fast (623ms on a JSON ping), reliable in
 *     JSON mode, and not a collector, so it draws on a different Groq
 *     per-model budget than the gpt-oss-120b collector slot. Staying on
 *     Groq for the rater is deliberate: the rater is the one component
 *     whose failure costs no collected data, so it is the right place to
 *     keep using a vendor we now know churns models.
 *
 * Swapping the rater changes inter-rater reliability baselines over
 * time — acceptable during bring-up, will be frozen once the pipeline
 * is producing a clean day's data end-to-end. This swap was forced
 * rather than chosen, so treat 2026-08-17 as a break in any
 * rater-agreement series: the v3 baseline rests on 14,947 ratings and
 * the v4 baseline starts from zero. rater_model_slug is stored per row,
 * so the two eras stay separable in analysis.
 */
export const RATER_MODEL: ModelEntry = {
  slug: "rater-gpt-oss-20b-groq",
  displayName: "GPT-OSS 20B (rater)",
  provider: "groq",
  modelId: "openai/gpt-oss-20b",
  family: "GPT-OSS",
  order: 999,
};

export function findCollector(slug: string): ModelEntry | undefined {
  return COLLECTOR_MODELS.find((m) => m.slug === slug);
}
