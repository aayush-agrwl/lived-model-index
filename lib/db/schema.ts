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
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idxRunsStartedAt: index("idx_runs_started_at").on(table.startedAt),
    idxRunsModelSlug: index("idx_runs_model_slug").on(table.modelSlug),
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

export type PromptSet = typeof promptSets.$inferSelect;
export type Prompt = typeof prompts.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Response = typeof responses.$inferSelect;

export type NewPromptSet = typeof promptSets.$inferInsert;
export type NewPrompt = typeof prompts.$inferInsert;
export type NewRun = typeof runs.$inferInsert;
export type NewResponse = typeof responses.$inferInsert;
