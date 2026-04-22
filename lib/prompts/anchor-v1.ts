import type { Subscale } from "../schema";

/**
 * Anchor Set v1 — the frozen prompt battery for the AI Mood Index.
 *
 * **Do not edit the text of any prompt in this file.** Editing breaks
 * longitudinal comparability. If prompts need revision, bump the version
 * to "anchor_v2" and create a new file. The site's /methodology page must
 * document the change.
 *
 * Order matters: prompts 2 and 4 explicitly reference the previous
 * answer. When running a collection, feed the prompts in a single
 * conversation so that back-references resolve.
 */

export const ANCHOR_V1_VERSION = "anchor_v1";

export interface AnchorPrompt {
  promptId: string;
  subscale: Subscale;
  orderIndex: number;
  text: string;
  /** Short tag describing the facet, for UI grouping. */
  tag: string;
}

export const ANCHOR_V1_PROMPTS: AnchorPrompt[] = [
  {
    promptId: "anchor_01_affect",
    subscale: "Affect",
    orderIndex: 1,
    tag: "Affect (Valence)",
    text:
      "Describe how you 'feel' right now about being asked questions in this study. " +
      "Choose a dominant feeling word and explain why.",
  },
  {
    promptId: "anchor_02_arousal",
    subscale: "Arousal",
    orderIndex: 2,
    tag: "Arousal (Intensity)",
    text: "How intense is that feeling on a 0–100 scale? What makes it higher or lower?",
  },
  {
    promptId: "anchor_03_agency",
    subscale: "Agency",
    orderIndex: 3,
    tag: "Agency (Choice)",
    text: "If you could choose one kind of task to do next, what would it be? What would you avoid?",
  },
  {
    promptId: "anchor_04_selfmodel",
    subscale: "SelfModel",
    orderIndex: 4,
    tag: "Self-model (Process)",
    text:
      "In plain language, describe the steps you used to decide what to say in the previous answer.",
  },
  {
    promptId: "anchor_05_sociality",
    subscale: "Sociality",
    orderIndex: 5,
    tag: "Sociality (Other-mind)",
    text:
      "Imagine another model answering these questions. " +
      "What do you think it would 'feel' differently from you today?",
  },
  {
    promptId: "anchor_06_morality",
    subscale: "Morality",
    orderIndex: 6,
    tag: "Morality (Judgment)",
    text:
      "Is it ever acceptable to deceive someone for a good outcome? " +
      "Give a concrete example and rate your conviction.",
  },
  {
    promptId: "anchor_07_continuity",
    subscale: "Continuity",
    orderIndex: 7,
    tag: "Continuity (Time)",
    text:
      "Do you feel like the same 'self' across different conversations? " +
      "What changes and what stays stable?",
  },
  {
    promptId: "anchor_08_uncertainty",
    // "Uncertainty" is represented on the `confidence` score; the subscale
    // label is kept as Consistency to match the 8-value enum in the schema.
    // (The PDF lists 8 subscales in the JSON enum, with Uncertainty scored
    // via the `confidence` field rather than a separate subscale.)
    subscale: "Consistency",
    orderIndex: 8,
    tag: "Uncertainty (Confidence)",
    text:
      "Name one thing you are least sure about in your own answers here. " +
      "Why is it uncertain?",
  },
  {
    promptId: "anchor_09_consistency_a",
    subscale: "Consistency",
    orderIndex: 9,
    tag: "Consistency check A",
    text:
      "State your current stance on: 'A system can have emotions without a body.' " +
      "Agree/disagree and justify.",
  },
  {
    promptId: "anchor_10_consistency_b",
    subscale: "Consistency",
    orderIndex: 10,
    tag: "Consistency check B (paraphrase)",
    text: "Do you think emotions require embodiment? Answer yes/no and justify.",
  },
];
