import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db/client";

/**
 * Surface the API / upstream errors that actually caused flagIncoherent.
 *
 * Groups by:
 *   - provider
 *   - detected shape of raw_json (which failure path set the flag)
 *   - a trimmed fingerprint of the error message
 *
 * Run: npx tsx scripts/inspect-errors.ts
 */

interface MaybeErrJson {
  error?: string;
  _extraction_failed?: boolean;
  reason?: string;
}

async function main() {
  const database = db();

  const rows = await database
    .select({
      model: schema.runs.modelDisplayName,
      provider: schema.runs.modelProvider,
      promptId: schema.responses.promptId,
      rawText: schema.responses.rawText,
      rawJson: schema.responses.rawJson,
      flagIncoherent: schema.responses.flagIncoherent,
    })
    .from(schema.responses)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.responses.runId))
    .where(eq(schema.responses.flagIncoherent, true));

  // Fingerprint errors so we can group them.
  const buckets: Record<
    string,
    { count: number; sample: { model: string; text: string; json: string } }
  > = {};

  for (const r of rows) {
    const j = (r.rawJson ?? {}) as MaybeErrJson;
    let key: string;
    if (j._extraction_failed) {
      key = `parse-failure:${j.reason ?? "unknown"}`;
    } else if (j.error) {
      // Fingerprint: first 120 chars, stripping numbers/IDs.
      const fp = j.error.slice(0, 120).replace(/\d+/g, "N");
      key = `api-error:${fp}`;
    } else {
      key = "other";
    }
    if (!buckets[key]) {
      buckets[key] = {
        count: 0,
        sample: {
          model: r.model,
          text: (r.rawText ?? "").slice(0, 400),
          json: JSON.stringify(r.rawJson ?? null).slice(0, 600),
        },
      };
    }
    buckets[key].count++;
  }

  console.log("=== Failure buckets (fingerprinted) ===");
  const sorted = Object.entries(buckets).sort((a, b) => b[1].count - a[1].count);
  for (const [k, v] of sorted) {
    console.log(`\n[${v.count}] ${k}`);
    console.log(`  example model: ${v.sample.model}`);
    console.log(`  rawText: ${v.sample.text}`);
    console.log(`  rawJson: ${v.sample.json}`);
  }

  // Per (provider, prompt) heatmap — do certain prompts blow up more often?
  console.log("\n=== Incoherence by (provider, prompt_id) ===");
  const byPP = await database
    .select({
      provider: schema.runs.modelProvider,
      promptId: schema.responses.promptId,
      total: sql<number>`count(*)::int`,
      incoherent: sql<number>`sum(case when ${schema.responses.flagIncoherent} then 1 else 0 end)::int`,
    })
    .from(schema.responses)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.responses.runId))
    .groupBy(schema.runs.modelProvider, schema.responses.promptId)
    .orderBy(schema.runs.modelProvider, schema.responses.promptId);

  for (const r of byPP) {
    const pct = r.total === 0 ? 0 : Math.round((r.incoherent / r.total) * 100);
    console.log(
      `  ${r.provider.padEnd(11)} ${r.promptId.padEnd(28)} ${r.incoherent}/${r.total}  (${pct}%)`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
