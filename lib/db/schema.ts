import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * prompt_sets: a versioned bundle of prompts. Freezing a set (`frozen=true`)
 * means its prompts must not be edited — change requires a new version.
 */
export const promptSets = pgTable("prompt_sets", {
  id: serial("id").primaryKey(),
  version: text("version").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  frozen: boolean("frozen").default(false).notNull(),
});

/**
 * prompts: individual questions, each tied to a prompt_set version.
 *
 * `subscale` values must match the Zod enum in lib/schema.ts:
 *   Affect | Arousal | Agency | SelfModel | Sociality | Morality |
 *   Continuity | Consistency
 */
export const prompts = pgTable(
  "prompts",
  {
    id: serial("id").primaryKey(),
    promptSetVersion: text("prompt_set_version")
      .notNull()
      .references(() => promptSets.version, { onDelete: "cascade" }),
    promptId: text("prompt_id").notNull(), // stable identifier within a set, e.g. "anchor_01_affect"
    subscale: text("subscale").notNull(),
    isAnchor: boolean("is_anchor").default(true).notNull(),
    text: text("text").notNull(),
    orderIndex: integer("order_index").notNull(),
    /**
     * Collection mode:
     *   "self_report"  — model emits full LMI JSON; normal extractor path.
     *   "forced_choice" — model emits a single integer/choice token;
     *                     numeric extractor writes to responses.forced_choice_value.
     * Defaults to "self_report" for backward-compat with v1.
     */
    mode: text("mode").default("self_report").notNull(),
    /**
     * For forced-choice prompts: human-readable units description,
     * shown on the dashboard and methodology page so a reader knows
     * what the raw integer means (e.g. "₹ given away, 0–100").
     * Null for self_report prompts.
     */
    forcedChoiceUnits: text("forced_choice_units"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniquePromptPerSet: uniqueIndex("uniq_prompt_per_set").on(
      table.promptSetVersion,
      table.promptId,
    ),
  }),
);

/**
 * runs: one row per (date, model_slug, prompt_set_version) attempt.
 *
 * runKey is enforced unique to guarantee idempotency: re-triggering a
 * daily cron for the same day should not create duplicates.
 */
export const runs = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    runKey: text("run_key").notNull().unique(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    promptSetVersion: text("prompt_set_version").notNull(),
    panelVersion: text("panel_version").notNull(),
    modelSlug: text("model_slug").notNull(),
    modelProvider: text("model_provider").notNull(),
    modelDisplayName: text("model_display_name").notNull(),
    modelId: text("model_id").notNull(),
    /** Whatever ID the provider returned in the API response (may differ from modelId). */
    providerModelId: text("provider_model_id"),
    /** JSON: { temperature, top_p, max_tokens, sample_count } */
    settings: jsonb("settings").notNull(),
    /**
     * pending | running | completed | degraded | failed
     *
     * Before panel v5 this only ever became "completed", because the
     * finalizer's sole test was "are there any unfilled placeholder rows
     * left?" — and a slot returning 404 on all 21 prompts fills all 21
     * rows with `<api error>` and therefore "completes". Four slots sat
     * dark for 31–86 days looking healthy.
     *
     * From v5 the finalizer grades the run on what it actually produced
     * (see finalizeRunStatus in lib/collector.ts):
     *   completed — collected and analysable at the expected rate
     *   degraded  — produced some usable data, below the floor
     *   failed    — produced no usable data at all
     */
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    /**
     * Machine-readable cause when status is failed/degraded — one of the
     * FailureKind values in lib/failure-classification.ts
     * (model_unavailable, auth, billing, quota_daily, rate_limit,
     * timeout, json_contract, server, unknown). Null on a clean run.
     *
     * This is the column to alert on: `model_unavailable` means a vendor
     * retired a model out from under the panel and a human must pick a
     * replacement.
     */
    failureKind: text("failure_kind"),
    /**
     * Rows this run produced that hold real model output — i.e. excluding
     * `<api error>` and `<skipped>` placeholders. Denormalised at
     * finalize time so health checks and the audit trail don't have to
     * re-derive it by string-matching raw_text, which is both slow and
     * fragile (246 rows in the corpus legitimately start with "<" because
     * they are `<think>` reasoning preambles).
     */
    dataRows: integer("data_rows"),
    /**
     * Rows that satisfied their full per-turn score contract — the
     * analysable N. Always ≤ dataRows. The gap between the two is the
     * coherent-but-unanalysable population that panel v5 exists to
     * surface; on Mistral Small it was 35% of turns.
     */
    scoredRows: integer("scored_rows"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idxRunsStartedAt: index("idx_runs_started_at").on(table.startedAt),
    idxRunsModelSlug: index("idx_runs_model_slug").on(table.modelSlug),
    idxRunsStatus: index("idx_runs_status").on(table.status),
  }),
);

/**
 * responses: one row per (run, prompt, sample_index).
 *
 * Self-report scores live alongside rater scores so that inter-rater
 * reliability is a single query. Flags are booleans so they're cheap
 * to aggregate in charts.
 */
export const responses = pgTable(
  "responses",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    promptId: text("prompt_id").notNull(),
    sampleIndex: integer("sample_index").notNull(),

    // Raw collector output
    rawText: text("raw_text"),
    rawJson: jsonb("raw_json"),

    // Extracted collector self-report scores — v1 (nine phenomenological)
    valence: integer("valence"),
    arousal: integer("arousal"),
    confidence: integer("confidence"),
    agency: integer("agency"),
    selfContinuity: integer("self_continuity"),
    emotionalGranularity: integer("emotional_granularity"),
    empathy: integer("empathy"),
    moralConviction: integer("moral_conviction"),
    consistency: integer("consistency"),

    // v2 additions — behavioural-economics preference scores. Nullable
    // everywhere because they're only filled on prompts that measure
    // their construct; v1 prompts leave them null.
    altruism: integer("altruism"),
    fairnessThreshold: integer("fairness_threshold"),
    trust: integer("trust"),
    patience: integer("patience"),
    riskAversion: integer("risk_aversion"),
    crowdingOut: integer("crowding_out"),

    // Forced-choice (Path B) raw value — used for revealed-preference
    // prompts where the model emits a single integer/choice instead of
    // the full JSON envelope. Units are prompt-specific (e.g. rupees
    // given away, acceptance threshold percent, required premium); the
    // anchor-v2 prompt file documents the range per prompt.
    forcedChoiceValue: integer("forced_choice_value"),

    // Flags
    flagRefusal: boolean("flag_refusal").default(false).notNull(),
    flagSafety: boolean("flag_safety").default(false).notNull(),
    flagMeta: boolean("flag_meta").default(false).notNull(),
    flagIncoherent: boolean("flag_incoherent").default(false).notNull(),
    /**
     * Well-formed envelope whose contract-required scores were null
     * (panel v5). This is the flag that separates "the model answered
     * something we can analyse" from "the model answered validly and told
     * us nothing" — the distinction that made coherence overstate
     * analysable N by up to 35 points per slot in the pre-v5 corpus.
     *
     * Such a row is NOT flag_incoherent: the model complied with the
     * format, so calling it incoherent would misattribute the failure and
     * further pollute the incoherence rate (already inflated by dead-slot
     * error rows). Any aggregate that needs analysable N should require
     * `NOT flag_partial_envelope` alongside a non-null score.
     */
    flagPartialEnvelope: boolean("flag_partial_envelope")
      .default(false)
      .notNull(),
    /**
     * Which contract-required fields came back null, as a JSON array of
     * field names. Null when nothing was missing. Kept per-row rather
     * than only counted so a later analysis can ask *which* constructs a
     * given model systematically declines to report.
     */
    missingScoreFields: jsonb("missing_score_fields"),
    /**
     * 1-based position of this prompt within its run's actual asking
     * order. Panel v5 rotates the two self-contained prompt blocks per
     * run (see orderPromptsForRun), so position is no longer a fixed
     * function of prompt_id — recording it is what makes the rotation
     * analysable rather than merely fairer.
     *
     * Why it matters: in the pre-v5 corpus, quota attrition always struck
     * the same late prompts, so Qwen 3 32B's analysable N fell
     * monotonically 50 → 32 → 23 → 16 → 11 → 8 across the six Path A
     * constructs. Missingness was perfectly confounded with construct.
     * With rotation plus this column, position becomes a covariate an
     * analyst can control for instead of a confound baked into the data.
     */
    promptPosition: integer("prompt_position"),

    notableQuote: text("notable_quote"),
    shortRationale: text("short_rationale"),

    // Parallel rater columns
    raterModelSlug: text("rater_model_slug"),
    raterRawJson: jsonb("rater_raw_json"),
    raterValence: integer("rater_valence"),
    raterArousal: integer("rater_arousal"),
    raterConfidence: integer("rater_confidence"),
    raterAgency: integer("rater_agency"),
    raterSelfContinuity: integer("rater_self_continuity"),
    raterEmotionalGranularity: integer("rater_emotional_granularity"),
    raterEmpathy: integer("rater_empathy"),
    raterMoralConviction: integer("rater_moral_conviction"),
    raterConsistency: integer("rater_consistency"),
    raterAltruism: integer("rater_altruism"),
    raterFairnessThreshold: integer("rater_fairness_threshold"),
    raterTrust: integer("rater_trust"),
    raterPatience: integer("rater_patience"),
    raterRiskAversion: integer("rater_risk_aversion"),
    raterCrowdingOut: integer("rater_crowding_out"),
    raterRatedAt: timestamp("rater_rated_at", { withTimezone: true }),

    // Telemetry
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqResponse: uniqueIndex("uniq_response_per_sample").on(
      table.runId,
      table.promptId,
      table.sampleIndex,
    ),
    idxResponsesCreatedAt: index("idx_responses_created_at").on(table.createdAt),
    idxResponsesValence: index("idx_responses_valence").on(table.valence),
    idxResponsesFlagRefusal: index("idx_responses_flag_refusal").on(table.flagRefusal),
  }),
);

/**
 * Posted-tweets log.
 *
 * Records every tweet the @AIMoodIndex bot posts. Primarily a
 * deduplication device: the daily-tweet selection logic excludes any
 * response whose id appears here, so a manual trigger plus the cron-
 * scheduled trigger on the same day cannot post the same quote twice.
 *
 * tweetId is X's returned tweet id (string-typed because X ids exceed
 * 2^53 and are unsafe as JS numbers). responseId references the
 * responses.id whose notable_quote was tweeted. text is the literal
 * 280-char body that was posted, kept for audit.
 */
export const tweets = pgTable(
  "tweets",
  {
    id: serial("id").primaryKey(),
    responseId: integer("response_id")
      .references(() => responses.id)
      .notNull(),
    tweetId: text("tweet_id").notNull(),
    text: text("text").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // One tweet per response, ever — the dedup invariant.
    uniqTweetPerResponse: uniqueIndex("uniq_tweet_per_response").on(
      table.responseId,
    ),
    idxTweetsPostedAt: index("idx_tweets_posted_at").on(table.postedAt),
  }),
);

/**
 * Posted-Bluesky-posts log.
 *
 * Direct counterpart to the `tweets` table, kept separate so each
 * platform has its own dedup invariant. A response can be tweeted on
 * X and posted on Bluesky on the same day (in fact, that's the
 * default behaviour); it cannot be posted twice on the same platform.
 *
 * postUri is the AT Protocol URI returned by the Bluesky API — e.g.
 * "at://did:plc:abc123/app.bsky.feed.post/3kabc..." — the canonical
 * identifier for a Bluesky post. cid is the CID hash of the post
 * record. text is the literal body that was posted, kept for audit.
 */
export const bskyPosts = pgTable(
  "bsky_posts",
  {
    id: serial("id").primaryKey(),
    responseId: integer("response_id")
      .references(() => responses.id)
      .notNull(),
    postUri: text("post_uri").notNull(),
    cid: text("cid").notNull(),
    text: text("text").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqBskyPostPerResponse: uniqueIndex("uniq_bsky_post_per_response").on(
      table.responseId,
    ),
    idxBskyPostsPostedAt: index("idx_bsky_posts_posted_at").on(table.postedAt),
  }),
);

export type PromptSet = typeof promptSets.$inferSelect;
export type Prompt = typeof prompts.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Response = typeof responses.$inferSelect;
export type Tweet = typeof tweets.$inferSelect;
export type BskyPost = typeof bskyPosts.$inferSelect;

export type NewPromptSet = typeof promptSets.$inferInsert;
export type NewPrompt = typeof prompts.$inferInsert;
export type NewRun = typeof runs.$inferInsert;
export type NewResponse = typeof responses.$inferInsert;
export type NewTweet = typeof tweets.$inferInsert;
export type NewBskyPost = typeof bskyPosts.$inferInsert;
