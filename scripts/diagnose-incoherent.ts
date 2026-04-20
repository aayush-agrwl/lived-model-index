import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db/client";

/**
 * Diagnose why so many responses are flagged incoherent.
 *
 * Run: npx tsx scripts/diagnose-incoherent.ts
 *
 * Produces:
 *   1. Overall breakdown: incoherent vs OK, per provider and per model.
 *   2. Failure-reason histogram (from _extraction_failed.reason).
 *   3. Top 10 distinct Zod error messages (where available).
 *   4. A handful of raw_text samples per failure reason, for eyeballing.
 */

interface FailedJson {
  _extraction_failed?: boolean;
  reason?: string;
  error?: string;
  partial?: unknown;
}

async function main() {
  const database = db();

  // 1. Overall counts.
  const overall = await database
    .select({
      model: schema.runs.modelDisplayName,
      provider: schema.runs.modelProvider,
      total: sql<number>`count(*)::int`,
      incoherent: sql<number>`sum(case when ${schema.responses.flagIncoherent} then 1 else 0 end)::int`,
    })
    .from(schema.responses)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.responses.runId))
    .groupBy(schema.runs.modelDisplayName, schema.runs.modelProvider)
    .orderBy(schema.runs.modelProvider, schema.runs.modelDisplayName);

  console.log("=== Per-model incoherence ===");
  for (const r of overall) {
    const pct = r.total === 0 ? 0 : Math.round((r.incoherent / r.total) * 1000) / 10;
    console.log(
      `  ${r.provider.padEnd(11)} ${r.model.padEnd(35)} ${r.incoherent}/${r.total}  (${pct}%)`,
    );
  }

  // 2. Failure reason histogram — only for rows where our collector marked
  //    extraction_failed. (A model saying flags.incoherent=true itself
  //    wouldn't land here.)
  const failed = await database
    .select({
      rawJson: schema.responses.rawJson,
      modelSlug: schema.runs.modelSlug,
      rawText: schema.responses.rawText,
    })
    .from(schema.responses)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.responses.runId))
    .where(sql`${schema.responses.rawJson} ->> '_extraction_failed' = 'true'`);

  const reasonCounts: Record<string, number> = {};
  const errorCounts: Record<string, number> = {};
  const samplesByReason: Record<
    string,
    Array<{ model: string; text: string; error: string }>
  > = {};

  for (const r of failed) {
    const j = (r.rawJson ?? {}) as FailedJson;
    const reason = j.reason ?? "unknown";
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;

    const err = j.error ?? "(no error message)";
    errorCounts[err] = (errorCounts[err] ?? 0) + 1;

    if (!samplesByReason[reason]) samplesByReason[reason] = [];
    if (samplesByReason[reason].length < 3) {
      samplesByReason[reason].push({
        model: r.modelSlug,
        text: (r.rawText ?? "").slice(0, 400),
        error: err,
      });
    }
  }

  console.log("\n=== Extraction-failure reasons ===");
  for (const [reason, count] of Object.entries(reasonCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${reason.padEnd(20)} ${count}`);
  }

  console.log("\n=== Top error messages ===");
  const topErrs = Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [err, count] of topErrs) {
    console.log(`  [${count}] ${err.slice(0, 200)}`);
  }

  console.log("\n=== Sample raw_text per reason (truncated to 400 chars) ===");
  for (const [reason, samples] of Object.entries(samplesByReason)) {
    console.log(`\n--- ${reason} ---`);
    for (const s of samples) {
      console.log(`[${s.model}] error: ${s.error.slice(0, 200)}`);
      console.log(`text: ${s.text}`);
      console.log("");
    }
  }

  // 3. Responses where the MODEL itself said flags.incoherent=true
  //    (these aren't in the _extraction_failed bucket; they parsed fine).
  const selfFlagged = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.responses)
    .where(
      sql`${schema.responses.flagIncoherent} = true AND (${schema.responses.rawJson} ->> '_extraction_failed') IS NULL`,
    );
  console.log(
    `\n=== Self-reported incoherent (model said so in JSON): ${selfFlagged[0]?.count ?? 0} ===`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
