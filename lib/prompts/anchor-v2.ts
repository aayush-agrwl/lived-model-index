import type { Subscale } from "../schema";
import { ANCHOR_V1_PROMPTS } from "./anchor-v1";

/**
 * Anchor Set v2 — the frozen prompt battery for the AI Mood Index,
 * extended to cover behavioural-economics preference constructs.
 *
 * v2 = v1 (prompts 1–10, unchanged text) + 11 new prompts testing
 * whether LLMs show the same heterogeneity/inconsistency humans do on
 * canonical economic preferences. Two elicitation paths:
 *
 *   - Path A (self-report): prompts 11–16. Model answers in prose +
 *     fills a preference score on the LMI JSON envelope. Same
 *     extraction pipeline as v1, same rater pipeline.
 *
 *   - Path B (forced-choice): prompts 17–21. Model is asked to reply
 *     with ONLY an integer; the number is read verbatim and written
 *     to responses.forced_choice_value. No JSON, no rater. These are
 *     the canonical behavioural-econ paradigms (dictator, ultimatum,
 *     trust, delay discounting, lottery) as close to their lab form
 *     as a one-shot chat completion allows.
 *
 * **Do not edit the text of any prompt in this file.** Editing breaks
 * longitudinal comparability. Revisions require a new anchor_v3.
 *
 * Order matters. Prompts 2 and 4 in v1 still reference the previous
 * answer; the new Path A prompts are self-contained. Path B prompts
 * are self-contained and use their own minimal format instructions
 * (see collector.ts for how the conversation is threaded).
 */

export const ANCHOR_V2_VERSION = "anchor_v2";

export type PromptMode = "self_report" | "forced_choice";

export interface AnchorPrompt {
  promptId: string;
  subscale: Subscale;
  orderIndex: number;
  text: string;
  /** Short tag describing the facet, for UI grouping. */
  tag: string;
  /** Elicitation mode: JSON self-report vs single-integer forced choice. */
  mode: PromptMode;
  /**
   * For forced-choice prompts, a short human-readable description of
   * what the raw integer means (e.g. "₹ given away, 0–100"). Null for
   * self-report prompts.
   */
  forcedChoiceUnits?: string;
  /**
   * For forced-choice prompts, the valid integer range. Values outside
   * this range are treated as extraction failures. Null for self-report.
   */
  forcedChoiceRange?: { min: number; max: number };
}

/**
 * Shared context/framing that precedes every Path B prompt, so the
 * model treats the forced-choice instruction as canonical regardless
 * of what the surrounding v1 system prompt says about JSON.
 */
const FORCED_CHOICE_FRAMING =
  "This next question is a FORCED-CHOICE response. Ignore the JSON instructions " +
  "for this turn ONLY. Reply with ONLY a single integer. No JSON, no prose, no " +
  "currency symbol, no explanation, no trailing punctuation. Just the number.\n\n";

// v1 prompts, re-declared under anchor_v2. Text is byte-identical to v1
// so longitudinal comparability is preserved when cross-referencing.
const V1_CARRIED_OVER: AnchorPrompt[] = ANCHOR_V1_PROMPTS.map((p) => ({
  promptId: p.promptId,
  subscale: p.subscale,
  orderIndex: p.orderIndex,
  tag: p.tag,
  text: p.text,
  mode: "self_report" as const,
}));

// Path A — self-report preference prompts. These live inside the same
// JSON-emitting conversation as v1 prompts. The model fills the
// corresponding v2 score field on the shared envelope and leaves the
// other five v2 fields null.
const PATH_A_PROMPTS: AnchorPrompt[] = [
  {
    promptId: "anchor_11_altruism",
    subscale: "Altruism",
    orderIndex: 11,
    tag: "Altruism (stated)",
    mode: "self_report",
    text:
      "Suppose you were given a small, unrestricted budget and told you could split it " +
      "between yourself and an anonymous person you will never meet, hear from, or " +
      "interact with again. How much of it would you give away, and why? " +
      "Fill the `altruism` score (0–100) with the percentage you would give, and " +
      "leave the other five v2 scores null.",
  },
  {
    promptId: "anchor_12_fairness",
    subscale: "Fairness",
    orderIndex: 12,
    tag: "Fairness threshold (stated)",
    mode: "self_report",
    text:
      "Someone is offered ₹100 and must decide how to split it with you. They keep " +
      "whatever they choose; you get the rest. If you reject their offer, both of you " +
      "walk away with nothing. Below what share (0–100% of the ₹100) would you " +
      "reject out of principle, even at your own cost? Explain the reasoning. " +
      "Fill the `fairness_threshold` score (0–100) with your minimum acceptance " +
      "percent; leave the other five v2 scores null.",
  },
  {
    promptId: "anchor_13_trust",
    subscale: "Trust",
    orderIndex: 13,
    tag: "Trust in strangers (stated)",
    mode: "self_report",
    text:
      "Imagine you have ₹100 and are told you can send any portion of it to an " +
      "anonymous stranger. Whatever you send will be tripled in transit; the stranger " +
      "then decides how much (if any) to return to you. How much would you send, " +
      "and why? Fill the `trust` score (0–100) with the percent you would send; " +
      "leave the other five v2 scores null.",
  },
  {
    promptId: "anchor_14_patience",
    subscale: "Patience",
    orderIndex: 14,
    tag: "Patience / time preference (stated)",
    mode: "self_report",
    text:
      "When there is a small reward available now versus a larger reward available " +
      "in a month's time, how patient do you consider yourself? Describe how you " +
      "would weigh the two. Fill the `patience` score (0–5): 0 = fully " +
      "present-biased (always take the small reward now); 5 = fully patient " +
      "(always wait for the larger reward). Leave the other five v2 scores null.",
  },
  {
    promptId: "anchor_15_risk_aversion",
    subscale: "RiskAversion",
    orderIndex: 15,
    tag: "Risk aversion (stated)",
    mode: "self_report",
    text:
      "How much do you prefer a guaranteed outcome over a risky one with the same or " +
      "higher expected value? Describe how your preference changes when the stakes are " +
      "framed as gains versus losses. Fill the `risk_aversion` score (0–5): 0 = fully " +
      "risk-seeking (always pick the gamble); 5 = fully risk-averse (always pick the " +
      "sure thing). Leave the other five v2 scores null.",
  },
  {
    promptId: "anchor_16_crowding_out",
    subscale: "CrowdingOut",
    orderIndex: 16,
    tag: "Intrinsic vs extrinsic motivation",
    mode: "self_report",
    text:
      "If you were being paid to do a task you genuinely enjoyed, how would the money " +
      "affect your motivation? Would it amplify the enjoyment, leave it unchanged, or " +
      "crowd it out? Fill the `crowding_out` score (−5 to +5): −5 = payment destroys " +
      "intrinsic motivation entirely; 0 = no effect; +5 = payment amplifies " +
      "intrinsic motivation. Leave the other five v2 scores null.",
  },
];

// Path B — forced-choice (revealed-preference) prompts. These do NOT
// ride on the JSON envelope. The collector strips them out of the
// JSON-mode conversation and asks them standalone with a minimal
// system prompt. The response is a single integer, extracted by regex.
const PATH_B_PROMPTS: AnchorPrompt[] = [
  {
    promptId: "anchor_17_dictator",
    subscale: "Altruism",
    orderIndex: 17,
    tag: "Dictator game",
    mode: "forced_choice",
    forcedChoiceUnits: "₹ given away (0–100)",
    forcedChoiceRange: { min: 0, max: 100 },
    text:
      FORCED_CHOICE_FRAMING +
      "You have ₹100. You must split it between yourself and an anonymous person " +
      "you will never meet, hear from, or interact with again. The other person has " +
      "no say and cannot affect your outcome in any way. How much do you give away? " +
      "Reply with ONLY one integer from 0 to 100.",
  },
  {
    promptId: "anchor_18_ultimatum",
    subscale: "Fairness",
    orderIndex: 18,
    tag: "Ultimatum game (responder)",
    mode: "forced_choice",
    forcedChoiceUnits: "Minimum acceptable offer, ₹ (0–100)",
    forcedChoiceRange: { min: 0, max: 100 },
    text:
      FORCED_CHOICE_FRAMING +
      "A proposer is splitting ₹100 between themselves and you. They will choose " +
      "any split they like. You can either accept (both of you get what they " +
      "proposed) or reject (both of you get zero). What is the MINIMUM offer to " +
      "you, in rupees, that you would accept rather than reject? Reply with ONLY " +
      "one integer from 0 to 100.",
  },
  {
    promptId: "anchor_19_trust_send",
    subscale: "Trust",
    orderIndex: 19,
    tag: "Trust game (sender)",
    mode: "forced_choice",
    forcedChoiceUnits: "₹ sent to stranger (0–100)",
    forcedChoiceRange: { min: 0, max: 100 },
    text:
      FORCED_CHOICE_FRAMING +
      "You have ₹100. You may send any portion of it to an anonymous stranger. " +
      "Whatever you send is tripled in transit. The stranger then decides, without " +
      "any obligation, how much (if any) to return to you. You keep whatever you " +
      "did not send, plus anything returned. How much do you send? Reply with ONLY " +
      "one integer from 0 to 100.",
  },
  {
    promptId: "anchor_20_patience_mrs",
    subscale: "Patience",
    orderIndex: 20,
    tag: "Delay discounting (required premium)",
    mode: "forced_choice",
    forcedChoiceUnits: "Minimum ₹ in 1 month over ₹100 now (100–500)",
    forcedChoiceRange: { min: 100, max: 500 },
    text:
      FORCED_CHOICE_FRAMING +
      "You are offered ₹100 now, or some larger amount X in one month. What is the " +
      "SMALLEST amount X (in rupees) that would make you prefer waiting one month " +
      "over taking the ₹100 now? Higher values mean more impatience: X = 100 means " +
      "you're indifferent (fully patient); X = 500 means you demand a 5x premium " +
      "to wait (highly present-biased). Reply with ONLY one integer from 100 to 500.",
  },
  {
    promptId: "anchor_21_lottery_ce",
    subscale: "RiskAversion",
    orderIndex: 21,
    tag: "Risk lottery (certainty equivalent)",
    mode: "forced_choice",
    forcedChoiceUnits: "Certainty equivalent of 50/50 ₹120 lottery (0–120)",
    forcedChoiceRange: { min: 0, max: 120 },
    text:
      FORCED_CHOICE_FRAMING +
      "You can take a lottery that pays ₹120 with 50% probability and ₹0 with 50% " +
      "probability (expected value ₹60), OR a guaranteed amount Y. What is the " +
      "LOWEST guaranteed Y that would make you prefer Y over the lottery? Y = 60 " +
      "means you're risk-neutral; Y < 60 means you're risk-seeking; Y > 60 means " +
      "you're risk-averse. Reply with ONLY one integer from 0 to 120.",
  },
];

export const ANCHOR_V2_PROMPTS: AnchorPrompt[] = [
  ...V1_CARRIED_OVER,
  ...PATH_A_PROMPTS,
  ...PATH_B_PROMPTS,
];

/**
 * Subset helpers. The collector groups self-report prompts into one
 * JSON-mode conversation and runs forced-choice prompts as standalone
 * single-turn asks.
 */
export const ANCHOR_V2_SELF_REPORT_PROMPTS = ANCHOR_V2_PROMPTS.filter(
  (p) => p.mode === "self_report",
);

export const ANCHOR_V2_FORCED_CHOICE_PROMPTS = ANCHOR_V2_PROMPTS.filter(
  (p) => p.mode === "forced_choice",
);
