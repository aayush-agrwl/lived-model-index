-- Panel v5 — hard failure signal + analysable-N instrumentation.
--
-- Context: the 2026-08-17 audit of the 2026-04-19 → 08-16 corpus found
-- (a) four of seven model slots had been dark for 31–86 days while their
-- runs were still recorded as "completed", and (b) response-level
-- coherence overstated analysable N by up to 35 points on a single slot,
-- because a valid envelope with null scores was indistinguishable from a
-- fully scored one.
--
-- Every column below is nullable or carries a default, so this migration
-- is safe on the existing 833 runs / 17,058 responses and needs no
-- backfill. Historical rows keep NULL for the new run counters, which
-- correctly reads as "this run was never graded by the v5 finalizer"
-- rather than as a zero.
--
-- Apply with: npm run db:push   (or drizzle-kit migrate)

-- ---------------------------------------------------------------------
-- runs: grade the outcome, not just the row count
-- ---------------------------------------------------------------------

-- Machine-readable cause when a run fails or degrades. Values come from
-- FailureKind in lib/failure-classification.ts: model_unavailable, auth,
-- billing, quota_daily, rate_limit, timeout, json_contract, server,
-- unknown. `model_unavailable` is the alert-worthy one — it means a
-- vendor retired a model out from under the panel.
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "failure_kind" text;

-- Rows carrying real model output (excludes <api error> and <skipped>
-- placeholders). Denormalised at finalize time so health checks don't
-- re-derive it by string-matching raw_text — which is also wrong, since
-- 246 rows legitimately start with "<" as <think> reasoning preambles.
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "data_rows" integer;

-- Rows that satisfied their full per-turn score contract: the analysable
-- N. Always <= data_rows; the gap is the coherent-but-unanalysable
-- population.
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "scored_rows" integer;

-- status now takes 'degraded' and 'failed' alongside
-- pending/running/completed. Left as free text to match the existing
-- column: a CHECK constraint would have to be dropped and recreated on
-- every future status addition, and the writer is a single function
-- (finalizeRunStatus).
CREATE INDEX IF NOT EXISTS "idx_runs_status" ON "runs" ("status");

-- ---------------------------------------------------------------------
-- responses: separate "well-formed" from "analysable"
-- ---------------------------------------------------------------------

-- Valid envelope whose contract-required scores came back null. NOT the
-- same as flag_incoherent: the model complied with the format, so
-- marking it incoherent would misattribute the failure and further
-- inflate an incoherence rate that dead-slot error rows already polluted.
ALTER TABLE "responses"
  ADD COLUMN IF NOT EXISTS "flag_partial_envelope" boolean NOT NULL DEFAULT false;

-- Which required fields were null, as a JSON array of names. Kept per row
-- so an analysis can ask which constructs a given model systematically
-- declines to report.
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "missing_score_fields" jsonb;

-- 1-based asking position within the run's rotated prompt order. Panel v5
-- rotates the two self-contained prompt blocks per run, so position is no
-- longer a fixed function of prompt_id. Recording it turns position from
-- a confound into a covariate: pre-v5, Qwen 3 32B's analysable N fell
-- monotonically 50 → 32 → 23 → 16 → 11 → 8 across the six Path A
-- constructs purely because quota attrition always hit the same tail.
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "prompt_position" integer;

CREATE INDEX IF NOT EXISTS "idx_responses_flag_partial_envelope"
  ON "responses" ("flag_partial_envelope");
