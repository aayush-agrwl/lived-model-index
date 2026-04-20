import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { COLLECTOR_MODELS, MODEL_PANEL_VERSION } from "./models";
import { ANCHOR_V1_VERSION, ANCHOR_V1_PROMPTS } from "./prompts/anchor-v1";

/** Number of samples per (model, prompt) per day. N=3 at temp=1. */
export const SAMPLES_PER_MODEL = 3;
export const CURRENT_PROMPT_SET = ANCHOR_V1_VERSION;

/** UTC day string, e.g. "2026-04-19". */
export function todayUtc(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function runKeyFor(date: string, modelSlug: string, promptSetVersion: string) {
  return `${date}__${modelSlug}__${promptSetVersion}`;
}

export interface BootstrapResult {
  date: string;
  runsCreated: number;
  runsExisting: number;
  placeholderRowsCreated: number;
}

/**
 * Create today's runs and queue placeholder response rows. Idempotent:
 * re-running returns counts without duplicating.
 */
export async function bootstrapDailyRuns(date: string = todayUtc()): Promise<BootstrapResult> {
  const database = db();
  let runsCreated = 0;
  let runsExisting = 0;
  let placeholderRowsCreated = 0;

  for (const model of COLLECTOR_MODELS) {
    const runKey = runKeyFor(date, model.slug, CURRENT_PROMPT_SET);

    // Try to find an existing run for today.
    const existing = await database
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.runKey, runKey))
      .limit(1);

    let runId: number;

    if (existing.length === 0) {
      const inserted = await database
        .insert(schema.runs)
        .values({
          runKey,
          promptSetVersion: CURRENT_PROMPT_SET,
          panelVersion: MODEL_PANEL_VERSION,
          modelSlug: model.slug,
          modelProvider: model.provider,
          modelDisplayName: model.displayName,
          modelId: model.modelId,
          settings: {
            temperature: 1.0,
            top_p: 1.0,
            max_tokens: 0,
            sample_count: SAMPLES_PER_MODEL,
          } as never,
          status: "pending",
        })
        .returning({ id: schema.runs.id });
      runId = inserted[0].id;
      runsCreated++;
    } else {
      runId = existing[0].id;
      runsExisting++;
    }

    // Ensure 30 placeholder response rows exist: 10 prompts × 3 samples.
    for (let sampleIndex = 0; sampleIndex < SAMPLES_PER_MODEL; sampleIndex++) {
      for (const prompt of ANCHOR_V1_PROMPTS) {
        try {
          const result = await database
            .insert(schema.responses)
            .values({
              runId,
              promptId: prompt.promptId,
              sampleIndex,
            })
            .onConflictDoNothing({
              target: [
                schema.responses.runId,
                schema.responses.promptId,
                schema.responses.sampleIndex,
              ],
            })
            .returning({ id: schema.responses.id });
          if (result.length > 0) placeholderRowsCreated++;
        } catch {
          // swallow — onConflictDoNothing already handles the race
        }
      }
    }
  }

  return { date, runsCreated, runsExisting, placeholderRowsCreated };
}

/**
 * Count work remaining today: pending samples to collect, responses to rate.
 */
export async function todayStatus(date: string = todayUtc()) {
  const database = db();

  // Find today's run IDs (by runKey prefix — easier than date parsing).
  const todayRuns = await database
    .select()
    .from(schema.runs)
    .where(gte(schema.runs.startedAt, new Date(`${date}T00:00:00Z`)));

  const runIds = todayRuns.map((r) => r.id);
  if (runIds.length === 0) {
    return {
      date,
      runs: 0,
      collectTotal: 0,
      collectDone: 0,
      rateTotal: 0,
      rateDone: 0,
    };
  }

  const placeholder = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.responses)
    .where(sql`${schema.responses.runId} IN (${sql.join(runIds, sql`, `)})`);
  const collectTotal = placeholder[0]?.count ?? 0;

  const collectDoneRows = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.responses)
    .where(
      and(
        sql`${schema.responses.runId} IN (${sql.join(runIds, sql`, `)})`,
        sql`${schema.responses.rawJson} IS NOT NULL`,
      ),
    );
  const collectDone = collectDoneRows[0]?.count ?? 0;

  const rateDoneRows = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.responses)
    .where(
      and(
        sql`${schema.responses.runId} IN (${sql.join(runIds, sql`, `)})`,
        sql`${schema.responses.raterRatedAt} IS NOT NULL`,
      ),
    );
  const rateDone = rateDoneRows[0]?.count ?? 0;

  return {
    date,
    runs: todayRuns.length,
    collectTotal,
    collectDone,
    rateTotal: collectDone, // only collected rows are ratable
    rateDone,
  };
}
