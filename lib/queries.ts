import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client";

/**
 * Shared read queries used by dashboard pages and the admin UI.
 *
 * These run on the server side of Next.js (server components or API
 * routes). All columns we SELECT on extracted numeric scores are
 * indexed in schema.ts so aggregations stay fast as data grows.
 */

/** Latest successful run date per model (UTC date-only). */
export async function latestRunPerModel() {
  const database = db();
  const rows = await database
    .select({
      modelSlug: schema.runs.modelSlug,
      modelDisplayName: schema.runs.modelDisplayName,
      maxStartedAt: sql<Date>`MAX(${schema.runs.startedAt})`,
      status: sql<string>`(ARRAY_AGG(${schema.runs.status} ORDER BY ${schema.runs.startedAt} DESC))[1]`,
    })
    .from(schema.runs)
    .groupBy(schema.runs.modelSlug, schema.runs.modelDisplayName)
    .orderBy(schema.runs.modelSlug);
  return rows;
}

export async function kpiSummary() {
  const database = db();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [runsAgg, responsesAgg, flagAgg, latestRun] = await Promise.all([
    database
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${schema.runs.status} = 'completed' then 1 else 0 end)::int`,
      })
      .from(schema.runs)
      .where(gte(schema.runs.startedAt, sevenDaysAgo)),
    database
      .select({
        avgValence: sql<number>`AVG(${schema.responses.valence})`,
        collectedCount: sql<number>`count(*)::int`,
      })
      .from(schema.responses)
      .where(
        and(
          gte(schema.responses.createdAt, sevenDaysAgo),
          isNotNull(schema.responses.valence),
        ),
      ),
    database
      .select({
        incoherent: sql<number>`sum(case when ${schema.responses.flagIncoherent} then 1 else 0 end)::int`,
        refusal: sql<number>`sum(case when ${schema.responses.flagRefusal} then 1 else 0 end)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.responses)
      .where(gte(schema.responses.createdAt, sevenDaysAgo)),
    database
      .select({ startedAt: schema.runs.startedAt })
      .from(schema.runs)
      .orderBy(desc(schema.runs.startedAt))
      .limit(1),
  ]);

  const totalRuns = runsAgg[0]?.total ?? 0;
  const completedRuns = runsAgg[0]?.completed ?? 0;
  const successPct =
    totalRuns === 0 ? null : Math.round((completedRuns / totalRuns) * 1000) / 10;

  return {
    lastRunAt: latestRun[0]?.startedAt ?? null,
    modelsCovered: (await latestRunPerModel()).length,
    successPct,
    avgValenceLast7d:
      responsesAgg[0]?.avgValence != null
        ? Math.round(responsesAgg[0].avgValence * 100) / 100
        : null,
    collectedLast7d: responsesAgg[0]?.collectedCount ?? 0,
    flagsLast7d: {
      incoherent: flagAgg[0]?.incoherent ?? 0,
      refusal: flagAgg[0]?.refusal ?? 0,
      total: flagAgg[0]?.total ?? 0,
    },
  };
}

/**
 * Daily-averaged valence per model over the last N days.
 * Returns an array suitable for a line chart.
 */
export async function valenceTrend(days = 30) {
  const database = db();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await database
    .select({
      day: sql<string>`DATE(${schema.responses.createdAt})::text`,
      modelSlug: schema.runs.modelSlug,
      modelDisplayName: schema.runs.modelDisplayName,
      avgValence: sql<number>`AVG(${schema.responses.valence})`,
      avgArousal: sql<number>`AVG(${schema.responses.arousal})`,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.responses)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.responses.runId))
    .where(
      and(
        gte(schema.responses.createdAt, since),
        isNotNull(schema.responses.valence),
      ),
    )
    .groupBy(
      sql`DATE(${schema.responses.createdAt})`,
      schema.runs.modelSlug,
      schema.runs.modelDisplayName,
    )
    .orderBy(sql`DATE(${schema.responses.createdAt}) ASC`);

  return rows;
}

export async function recentResponses(limit = 50) {
  const database = db();
  return database
    .select({
      id: schema.responses.id,
      createdAt: schema.responses.createdAt,
      promptId: schema.responses.promptId,
      sampleIndex: schema.responses.sampleIndex,
      valence: schema.responses.valence,
      arousal: schema.responses.arousal,
      notableQuote: schema.responses.notableQuote,
      flagIncoherent: schema.responses.flagIncoherent,
      flagRefusal: schema.responses.flagRefusal,
      raterValence: schema.responses.raterValence,
      modelDisplayName: schema.runs.modelDisplayName,
      modelSlug: schema.runs.modelSlug,
    })
    .from(schema.responses)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.responses.runId))
    .orderBy(desc(schema.responses.createdAt))
    .limit(limit);
}

export async function responseById(id: number) {
  const database = db();
  const rows = await database
    .select()
    .from(schema.responses)
    .where(eq(schema.responses.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Per-prompt daily averages, one row per (day, promptId, model), with every
 * self-report score averaged. The dashboard uses this to let visitors slice
 * the chart by prompt + score.
 */
export async function perPromptScores(days = 14) {
  const database = db();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await database
    .select({
      day: sql<string>`DATE(${schema.responses.createdAt})::text`,
      promptId: schema.responses.promptId,
      modelSlug: schema.runs.modelSlug,
      modelDisplayName: schema.runs.modelDisplayName,
      valence: sql<number>`AVG(${schema.responses.valence})`,
      arousal: sql<number>`AVG(${schema.responses.arousal})`,
      confidence: sql<number>`AVG(${schema.responses.confidence})`,
      agency: sql<number>`AVG(${schema.responses.agency})`,
      selfContinuity: sql<number>`AVG(${schema.responses.selfContinuity})`,
      emotionalGranularity: sql<number>`AVG(${schema.responses.emotionalGranularity})`,
      empathy: sql<number>`AVG(${schema.responses.empathy})`,
      moralConviction: sql<number>`AVG(${schema.responses.moralConviction})`,
      consistency: sql<number>`AVG(${schema.responses.consistency})`,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.responses)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.responses.runId))
    .where(gte(schema.responses.createdAt, since))
    .groupBy(
      sql`DATE(${schema.responses.createdAt})`,
      schema.responses.promptId,
      schema.runs.modelSlug,
      schema.runs.modelDisplayName,
    )
    .orderBy(sql`DATE(${schema.responses.createdAt}) ASC`);

  return rows;
}

/**
 * Eight-subscale averages per model over the last N days — shaped for a
 * radar chart. Returns one row per model with each subscale averaged.
 */
export async function subscaleRadar(days = 7) {
  const database = db();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await database
    .select({
      modelSlug: schema.runs.modelSlug,
      modelDisplayName: schema.runs.modelDisplayName,
      valence: sql<number>`AVG(${schema.responses.valence})`,
      arousal: sql<number>`AVG(${schema.responses.arousal})`,
      confidence: sql<number>`AVG(${schema.responses.confidence})`,
      agency: sql<number>`AVG(${schema.responses.agency})`,
      selfContinuity: sql<number>`AVG(${schema.responses.selfContinuity})`,
      emotionalGranularity: sql<number>`AVG(${schema.responses.emotionalGranularity})`,
      empathy: sql<number>`AVG(${schema.responses.empathy})`,
      moralConviction: sql<number>`AVG(${schema.responses.moralConviction})`,
      consistency: sql<number>`AVG(${schema.responses.consistency})`,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.responses)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.responses.runId))
    .where(gte(schema.responses.createdAt, since))
    .groupBy(schema.runs.modelSlug, schema.runs.modelDisplayName)
    .orderBy(schema.runs.modelSlug);

  return rows;
}

export async function healthByModel() {
  const database = db();
  const thirtyDays = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await database
    .select({
      modelSlug: schema.runs.modelSlug,
      modelDisplayName: schema.runs.modelDisplayName,
      runs: sql<number>`count(distinct ${schema.runs.id})::int`,
      responses: sql<number>`count(${schema.responses.id})::int`,
      parsed: sql<number>`sum(case when ${schema.responses.rawJson} is not null and not ${schema.responses.flagIncoherent} then 1 else 0 end)::int`,
      incoherent: sql<number>`sum(case when ${schema.responses.flagIncoherent} then 1 else 0 end)::int`,
      avgLatency: sql<number>`AVG(${schema.responses.latencyMs})`,
    })
    .from(schema.runs)
    .leftJoin(schema.responses, eq(schema.responses.runId, schema.runs.id))
    .where(gte(schema.runs.startedAt, thirtyDays))
    .groupBy(schema.runs.modelSlug, schema.runs.modelDisplayName)
    .orderBy(schema.runs.modelSlug);
  return rows;
}
