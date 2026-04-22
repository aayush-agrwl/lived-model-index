/**
 * Seed Anchor Set v1 into the prompt_sets and prompts tables.
 *
 * Idempotent: safe to re-run. Existing rows are not duplicated; missing
 * rows are inserted; the set is marked frozen.
 *
 * Usage:
 *   npm run db:seed
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db, schema } from "../lib/db/client";
import { ANCHOR_V1_PROMPTS, ANCHOR_V1_VERSION } from "../lib/prompts/anchor-v1";
import { eq } from "drizzle-orm";

async function main() {
  console.log(`Seeding prompt set: ${ANCHOR_V1_VERSION}`);
  const database = db();

  // Upsert the prompt_set row.
  const existingSet = await database
    .select()
    .from(schema.promptSets)
    .where(eq(schema.promptSets.version, ANCHOR_V1_VERSION))
    .limit(1);

  if (existingSet.length === 0) {
    await database.insert(schema.promptSets).values({
      version: ANCHOR_V1_VERSION,
      name: "Anchor Set v1",
      description:
        "The frozen 10-prompt anchor battery for the AI Mood Index. " +
        "Do not edit. Changes require a new version.",
      frozen: true,
    });
    console.log(`  Inserted prompt_set ${ANCHOR_V1_VERSION}`);
  } else {
    console.log(`  prompt_set ${ANCHOR_V1_VERSION} already exists; skipping.`);
  }

  // Upsert each prompt.
  let inserted = 0;
  let skipped = 0;

  for (const prompt of ANCHOR_V1_PROMPTS) {
    const existing = await database
      .select()
      .from(schema.prompts)
      .where(eq(schema.prompts.promptId, prompt.promptId))
      .limit(1);

    // Note: equality on (promptSetVersion, promptId) is enforced by the
    // composite unique index; we check promptId alone because the scope is
    // the whole prompts table and promptIds are globally unique across sets
    // in our convention ("anchor_v1_01" style).
    const alreadyInThisSet = existing.find(
      (p) => p.promptSetVersion === ANCHOR_V1_VERSION,
    );

    if (alreadyInThisSet) {
      skipped++;
      continue;
    }

    await database.insert(schema.prompts).values({
      promptSetVersion: ANCHOR_V1_VERSION,
      promptId: prompt.promptId,
      subscale: prompt.subscale,
      isAnchor: true,
      text: prompt.text,
      orderIndex: prompt.orderIndex,
    });
    inserted++;
    console.log(`  Inserted ${prompt.promptId} (${prompt.subscale})`);
  }

  console.log(`\nDone. Inserted: ${inserted}, skipped: ${skipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
