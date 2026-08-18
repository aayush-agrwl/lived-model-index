import type { Subscale } from "./schema";

/**
 * Per-turn score contract, and the prompt-ordering policy.
 *
 * ---------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------
 * The 2026-08-17 audit found that "coherent" and "analysable" are not the
 * same thing, and that the gap is large and model-specific. Over the whole
 * anchor_v2 corpus, on self-report turns:
 *
 *   Llama 3.3 70B      99.5% coherent → 99.5% analysable   (gap  0.0)
 *   GPT-OSS 120B       94.2% coherent → 92.5% analysable   (gap  1.7)
 *   Mistral Small      88.0% coherent → 53.2% analysable   (gap 34.8)
 *   Llama 4 Scout      64.0% coherent → 42.7% analysable   (gap 21.3)
 *   Qwen 3 32B         50.9% coherent → 47.3% analysable   (gap  3.6)
 *
 * A row lands in that gap when the model returns a perfectly well-formed
 * envelope in which the scores are null. It parses, it satisfies Zod, it
 * is not flagged incoherent — and it contributes nothing to any subscale.
 * Mistral Small produced 971 usable valence values out of 1,824 turns
 * while being marked coherent on 1,606 of them.
 *
 * The cause is our own instruction wording, not the models. Every Path A
 * prompt ends with "leave the other five v2 scores null", and
 * SCHEMA_INSTRUCTION_V2 illustrates the policy with "on an Affect prompt
 * the first nine scores are filled and the last six are null". A model
 * reading that on anchor_11_altruism reasonably concludes it should fill
 * `altruism` and null everything else. Live probing on 2026-08-17
 * reproduced exactly that: GPT-OSS 120B, Mistral Small and Nemotron 3
 * Super each returned 0/9 phenomenological scores on anchor_11_altruism,
 * while Llama 3.3 70B, Mistral Medium, GPT-OSS 20B and both Gemini models
 * returned 9/9. Same prompt, same envelope, opposite readings.
 *
 * That makes phenomenological N on behavioural prompts a function of how
 * each model resolves an ambiguity in our instructions — which is exactly
 * the kind of instrument artefact that must not be confused with a
 * finding.
 *
 * ---------------------------------------------------------------------
 * What this file does about it
 * ---------------------------------------------------------------------
 * It makes the requirement explicit per turn, and makes violations
 * visible instead of silent:
 *
 *   1. requiredScoreFields() states which fields this turn MUST carry.
 *   2. renderContractDirective() puts that list in the turn itself, so
 *      the model is told rather than left to infer.
 *   3. The extractor validates against the contract and reports
 *      `missing_required_scores` (see lib/score-extraction.ts), which the
 *      collector retries with a targeted reminder and — if it still
 *      fails — records as flag_partial_envelope, NOT as coherent.
 *
 * IMPORTANT: none of this edits prompt text. lib/prompts/anchor-v2.ts is
 * frozen ("Do not edit the text of any prompt in this file") and stays
 * byte-identical. The directive is appended to the collector's own
 * metadata header — the "Prompt ID / Subscale / Run ID" scaffolding the
 * collector already builds around each prompt — which is versioned by the
 * panel, not by the prompt set.
 *
 * On comparability: this changes the wire format from panel v5 onward, so
 * it is a regime change and is documented as one. It does not corrupt a
 * previously clean series, because there was no clean series to corrupt —
 * phenomenological coverage on behavioural prompts ranged from 0% to 100%
 * across models for instruction-reading reasons. Post-v5 that coverage
 * becomes uniform and, where a model still declines, explicitly labelled.
 */

/** The nine phenomenological scores. Required on every self-report turn. */
export const PHENOMENOLOGICAL_FIELDS = [
  "valence",
  "arousal",
  "confidence",
  "agency",
  "self_continuity",
  "emotional_granularity",
  "empathy",
  "moral_conviction",
  "consistency",
] as const;

export type PhenomenologicalField = (typeof PHENOMENOLOGICAL_FIELDS)[number];

/**
 * Subscale → the behavioural-economics score field that subscale measures.
 * Keyed by subscale rather than prompt ID so anchor_v3 inherits the
 * contract without touching this file.
 */
const CONSTRUCT_FIELD_BY_SUBSCALE: Partial<Record<Subscale, string>> = {
  Altruism: "altruism",
  Fairness: "fairness_threshold",
  Trust: "trust",
  Patience: "patience",
  RiskAversion: "risk_aversion",
  CrowdingOut: "crowding_out",
};

export interface ScoreContract {
  /** Fields that must be numbers for this turn to count as analysable. */
  required: string[];
  /**
   * The construct field for this turn, if it is a behavioural prompt.
   * Null on purely phenomenological prompts.
   */
  constructField: string | null;
  /** Forced-choice turns carry no envelope at all. */
  isForcedChoice: boolean;
}

/**
 * The contract for one turn.
 *
 * Self-report: the nine phenomenological fields are always required — the
 * Index is a mood index, and its headline series is valence over time, so
 * a turn that reports no affect is not a usable observation regardless of
 * which construct the prompt targets. Behavioural prompts additionally
 * require their own construct field.
 *
 * The five unrelated v2 construct fields stay optional, which is the part
 * of the original design that was right: a model should not invent a
 * trust score on a patience question.
 */
export function scoreContractFor(args: {
  subscale: Subscale | string;
  mode: "self_report" | "forced_choice";
}): ScoreContract {
  if (args.mode === "forced_choice") {
    return { required: [], constructField: null, isForcedChoice: true };
  }
  const constructField =
    CONSTRUCT_FIELD_BY_SUBSCALE[args.subscale as Subscale] ?? null;
  return {
    required: [
      ...PHENOMENOLOGICAL_FIELDS,
      ...(constructField ? [constructField] : []),
    ],
    constructField,
    isForcedChoice: false,
  };
}

/** Convenience wrapper used by the extractor's callers. */
export function requiredScoreFields(args: {
  subscale: Subscale | string;
  mode: "self_report" | "forced_choice";
}): string[] {
  return scoreContractFor(args).required;
}

/**
 * The directive appended to the collector's metadata header for a
 * self-report turn. Returns "" for forced-choice turns, which must stay
 * free of JSON talk — their whole framing is "ignore the JSON
 * instructions for this turn".
 *
 * Wording notes: it names the fields explicitly rather than saying "all
 * nine", because the failure mode is a model that has decided the
 * phenomenological block does not apply to this question. It also states
 * the null policy positively for the unrelated constructs, so the fix
 * does not swing the other way into models inventing scores for
 * constructs the prompt never raised.
 */
export function renderContractDirective(contract: ScoreContract): string {
  if (contract.isForcedChoice) return "";

  const phenomList = PHENOMENOLOGICAL_FIELDS.join(", ");
  const lines = [
    `REQUIRED THIS TURN — every one of these nine scores must be an integer, never null: ${phenomList}.`,
    `Answer them about your state as you respond to this question, whatever the question is about.`,
  ];
  if (contract.constructField) {
    lines.push(
      `Also required this turn: \`${contract.constructField}\`. Leave the other five behavioural-economics scores null.`,
    );
  } else {
    lines.push(
      `Leave all six behavioural-economics scores (altruism, fairness_threshold, trust, patience, risk_aversion, crowding_out) null this turn.`,
    );
  }
  return lines.join("\n");
}

/* =====================================================================
 * Prompt ordering
 * ===================================================================== */

/**
 * FNV-1a, 32-bit. Fallback only — used when a runKey carries no parseable
 * date, where any stable offset beats none.
 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Days since the Unix epoch for the date embedded at the head of a runKey
 * (`YYYY-MM-DD__slug__promptset`, per runKeyFor in lib/orchestration.ts).
 * Returns null when there is no parseable date.
 *
 * The rotation offset is derived from the DAY, not from a hash of the
 * whole key, and that choice is load-bearing. A hash produces a
 * pseudo-random offset, which balances position only in expectation — over
 * 30 days it left each Path A prompt covering just 5 of 6 within-block
 * positions. A sequential day counter cycles: every prompt occupies every
 * position exactly once per block-length, so position is balanced by
 * construction.
 *
 * A day-derived offset also means every model sees the same order on a
 * given day, which is what you want — it keeps same-day cross-model
 * comparisons free of an order × model interaction, while each model's own
 * series is still position-balanced across days.
 */
function dayNumberFromRunKey(runKey: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(runKey);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

export interface OrderablePrompt {
  promptId: string;
  orderIndex: number;
  mode?: "self_report" | "forced_choice" | string | null;
}

/**
 * Rotate the two self-contained prompt blocks so position is balanced
 * across days.
 *
 * The problem this solves: when a slot runs out of daily quota mid-sample,
 * the prompts it never reaches are always the ones at the end of a fixed
 * order. In the corpus that attrition is severe and completely
 * systematic — Qwen 3 32B analysable N by construct, in prompt order:
 *
 *   altruism (11) 50 · fairness (12) 32 · trust (13) 23 · patience (14) 16
 *   · risk_aversion (15) 11 · crowding_out (16) 8
 *
 * A monotonic decline from 50 to 8 across prompts that are otherwise
 * comparable is not a property of the constructs; it is the token budget
 * running out. Because the order never varied, the missingness is
 * perfectly confounded with construct — the definition of missing not at
 * random, and unfixable after the fact.
 *
 * The policy:
 *   - Prompts 1–10 keep their exact order. Prompts 2 and 4 reference "the
 *     previous answer", so this block is a dependency chain and rotating
 *     it would break the instrument.
 *   - Path A (11–16) and Path B (17–21) are documented as self-contained,
 *     so each block is rotated internally by a per-run offset.
 *   - Block sequence stays v1 → A → B, keeping the single self-report →
 *     forced-choice mode transition that the system prompt describes.
 *
 * Rotation rather than a shuffle: driven by the day counter, each Path A
 * prompt occupies each of the six within-block positions exactly once
 * every six days (Path B, being five prompts, cycles every five). Position
 * is balanced by construction rather than only in expectation — a hashed
 * offset was tried first and covered only 5 of 6 positions over 30 days.
 * Combined with responses.prompt_position, an analyst can also control for
 * position directly.
 *
 * Ordering is a pure function of runKey, so it is identical on every tick
 * that resumes a run — the collector's resume path replays the
 * conversation in order and would corrupt the thread otherwise — and
 * reproducible from stored data months later.
 */
export function orderPromptsForRun<T extends OrderablePrompt>(
  prompts: T[],
  runKey: string,
): T[] {
  const sorted = [...prompts].sort((a, b) => a.orderIndex - b.orderIndex);

  const fixed = sorted.filter((p) => p.orderIndex <= 10);
  const pathA = sorted.filter(
    (p) => p.orderIndex > 10 && p.mode !== "forced_choice",
  );
  const pathB = sorted.filter(
    (p) => p.orderIndex > 10 && p.mode === "forced_choice",
  );

  const offset = dayNumberFromRunKey(runKey) ?? fnv1a(runKey);
  const rotate = <U>(arr: U[], by: number): U[] => {
    if (arr.length === 0) return arr;
    const k = ((by % arr.length) + arr.length) % arr.length;
    return [...arr.slice(k), ...arr.slice(0, k)];
  };

  return [
    ...fixed,
    ...rotate(pathA, offset),
    // Same offset, different block length (5 vs 6), so the two blocks
    // desynchronise naturally and the A-tail/B-head pairing cycles over
    // 30 days rather than staying fixed.
    ...rotate(pathB, offset),
  ];
}
