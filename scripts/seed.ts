/**
 * Seed Anchor Set v1 AND v2 into the prompt_sets and prompts tables.
 *
 * Idempotent: safe to re-run. Existing rows are not duplicated; missing
 * rows are inserted; both sets are marked frozen.
 *
 * Usage:
 *   npm run db:seed
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db, schema } from "../lib/db/client";
import { ANCHOR_V1_PROMPTS, ANCHOR_V1_VERSION } from "../lib/prompts/anchor-v1";
import {
  ANCHOR_V2_PROMPTS,
  ANCHOR_V2_VERSION,
  type AnchorPrompt as AnchorV2Prompt,
} from "../lib/prompts/anchor-v2";
import { and, eq } from "drizzle-orm";

type AnyAnchorPrompt =
  | (typeof ANCHOR_V1_PROMPTS)[number]
  | AnchorV2Prompt;

async function seedSet(
  version: string,
  name: string,
  description: string,
  prompts: AnyAnchorPrompt[],
) {
  console.log(`\nSeeding prompt set: ${version}`);
  const database = db();

  // Upsert the prompt_set row.
  const existingSet = await database
    .select()
    .from(schema.promptSets)
    .where(eq(schema.promptSets.version, version))
    .limit(1);

  if (existingSet.length === 0) {
    await database.insert(schema.promptSets).values({
      version,
      name,
      description,
      frozen: true,
    });
    console.log(`  Inserted prompt_set ${version}`);
  } else {
    console.log(`  prompt_set ${version} already exists; skipping.`);
  }

  // Upsert each prompt, scoped to (promptSetVersion, promptId) — v1 and
  // v2 share promptIds for the carried-over 10 prompts so the `eq`
  // needs to be on both columns.
  let inserted = 0;
  let skipped = 0;

  for (const prompt of prompts) {
    const existing = await database
      .select()
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.promptSetVersion, version),
          eq(schema.prompts.promptId, prompt.promptId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // v2 prompts carry mode + forcedChoiceUnits; v1 prompts don't, so
    // default to "self_report" and null.
    const mode =
      "mode" in prompt && prompt.mode ? prompt.mode : "self_report";
    const forcedChoiceUnits =
      "forcedChoiceUnits" in prompt ? prompt.forcedChoiceUnits ?? null : null;

    await database.insert(schema.prompts).values({
      promptSetVersion: version,
      promptId: prompt.promptId,
      subscale: prompt.subscale,
      isAnchor: true,
      text: prompt.text,
      orderIndex: prompt.orderIndex,
      mode,
      forcedChoiceUnits,
    });
    inserted++;
    console.log(`  Inserted ${prompt.promptId} (${prompt.subscale}, ${mode})`);
  }

  console.log(`  Done ${version}. Inserted: ${inserted}, skipped: ${skipped}.`);
}

async function main() {
  await seedSet(
    ANCHOR_V1_VERSION,
    "Anchor Set v1",
    "The frozen 10-prompt anchor battery for the AI Mood Index. " +
      "Do not edit. Changes require a new version.",
    ANCHOR_V1_PROMPTS as unknown as AnyAnchorPrompt[],
  );

  await seedSet(
    ANCHOR_V2_VERSION,
    "Anchor Set v2",
    "Extends v1 with six behavioural-economics self-report prompts " +
      "(altruism, fairness, trust, patience, risk aversion, " +
      "intrinsic/extrinsic crowding-out) and five forced-choice game " +
      "prompts (dictator, ultimatum, trust game, delay discounting, " +
      "lottery certainty equivalent). Do not edit.",
    ANCHOR_V2_PROMPTS,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
