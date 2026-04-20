import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db/client";

/**
 * Show notable_quote + short_rationale for responses the MODEL flagged
 * incoherent (not an extraction failure). This confirms whether the
 * model is self-hedging on an ambiguous flag definition vs actually
 * returning garbled content.
 *
 * Run: npx tsx scripts/inspect-self-flagged.ts
 */

async function main() {
  const database = db();

  const rows = await database
    .select({
      model: schema.runs.modelDisplayName,
      promptId: schema.responses.promptId,
      notableQuote: schema.responses.notableQuote,
      shortRationale: schema.responses.shortRationale,
      rawJson: schema.responses.rawJson,
    })
    .from(schema.responses)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.responses.runId))
    .where(
      sql`${schema.responses.flagIncoherent} = true AND (${schema.responses.rawJson} ->> '_extraction_failed') IS NULL`,
    )
    .limit(12);

  for (const r of rows) {
    const rj = (r.rawJson ?? {}) as { flags?: Record<string, boolean> };
    const flags = rj.flags ?? {};
    const activeFlags = Object.entries(flags)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .join(",");
    console.log(`\n[${r.model}] ${r.promptId}  flags:{${activeFlags}}`);
    console.log(`  quote:    ${(r.notableQuote ?? "").slice(0, 220)}`);
    console.log(`  rational: ${(r.shortRationale ?? "").slice(0, 220)}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
