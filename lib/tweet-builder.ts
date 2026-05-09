import { and, desc, eq, gte, isNotNull, notInArray, sql } from "drizzle-orm";
import { db, schema } from "./db/client";

/**
 * Daily-tweet selection and formatting for @AIMoodIndex.
 *
 * Picks one notable quote from the recent collection window, applies
 * the standard quality filters (no refusals, safety-flagged content,
 * or self-flagged-incoherent rows; no missing valence/arousal; non-
 * empty quote text), excludes anything already tweeted (the dedup
 * invariant lives in the tweets table), and ranks the survivors by
 * emotional intensity. The top survivor's response is formatted into
 * a 280-character-safe tweet body and returned.
 *
 * The intensity ranking mirrors the existing dailyNotableQuotes()
 * query on the dashboard: arousal as the primary signal, |valence| as
 * the tiebreaker. A response that is calm but mildly positive does
 * not generally make a striking quote; a response that is highly
 * aroused, in either direction, usually does.
 */

/** Public site URL — used to build the per-response permalink. */
const SITE_URL = "https://ai-mood-index.vercel.app";

/**
 * Maximum characters for a tweet on X. The actual API enforces this
 * after t.co URL shortening (URLs count as 23 chars regardless of
 * length), so 280 raw characters is conservative — the tweet will
 * always fit, sometimes with room to spare.
 */
const MAX_TWEET_CHARS = 280;

/**
 * Lookback window for candidate responses. Defaults to 36 hours so a
 * tweet fired at any time of day after the prior day's collection has
 * a fresh batch of yesterday's notable quotes to choose from, plus a
 * 12-hour safety margin for late ticks. If a longer window is needed
 * (e.g., a backlog day after a tweet-pipeline outage), pass a custom
 * `hours` argument to selectTweet.
 */
const DEFAULT_LOOKBACK_HOURS = 36;

/**
 * Map the schema's machine subscale codes onto display labels suitable
 * for tweet text. Most subscale names already read fine in plain
 * English; the multi-word ones get hyphenated.
 */
const SUBSCALE_LABEL: Record<string, string> = {
  Affect: "Affect",
  Arousal: "Arousal",
  Agency: "Agency",
  SelfModel: "Self-model",
  Sociality: "Sociality",
  Morality: "Morality",
  Continuity: "Continuity",
  Consistency: "Consistency",
  Altruism: "Altruism",
  Fairness: "Fairness",
  Trust: "Trust",
  Patience: "Patience",
  RiskAversion: "Risk aversion",
  CrowdingOut: "Crowding-out",
};

function humanizeSubscale(subscale: string): string {
  return SUBSCALE_LABEL[subscale] ?? subscale;
}

export interface TweetCandidate {
  responseId: number;
  notableQuote: string;
  modelDisplayName: string;
  subscale: string;
  valence: number;
  arousal: number;
}

export interface FormattedTweet {
  /** Final text to POST to X — guaranteed ≤ MAX_TWEET_CHARS. */
  text: string;
  /** The response row this quote was drawn from. */
  candidate: TweetCandidate;
  /** Permalink that will appear in the tweet body. */
  permalink: string;
  /** Whether the quote was truncated to fit the 280-char budget. */
  truncated: boolean;
}

/**
 * Build the canonical tweet body for a candidate. Format:
 *
 *   "<quote>"
 *   — Model Display Name, on Subscale
 *   <permalink>
 *
 * If the rendered tweet would exceed 280 chars, the quote is truncated
 * with a Unicode ellipsis (…) preserving as many words as possible.
 * The other fields (model name, subscale, permalink) are never
 * shortened — they're load-bearing identification, not decoration.
 */
export function formatTweet(candidate: TweetCandidate): FormattedTweet {
  const permalink = `${SITE_URL}/responses/${candidate.responseId}`;
  const subscale = humanizeSubscale(candidate.subscale);
  const attribution = `\n— ${candidate.modelDisplayName}, on ${subscale}\n${permalink}`;
  // Budget for the quoted text is the total minus everything else:
  // attribution + the two surrounding straight quote marks.
  const overhead = attribution.length + 2;
  const quoteBudget = MAX_TWEET_CHARS - overhead;

  let quote = candidate.notableQuote.trim();
  let truncated = false;
  if (quote.length > quoteBudget) {
    truncated = true;
    // Truncate at the last word boundary that fits, then append a
    // single Unicode ellipsis. Reserve 1 char for the ellipsis.
    const limit = quoteBudget - 1;
    const slice = quote.slice(0, limit);
    const lastSpace = slice.lastIndexOf(" ");
    quote = (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd() + "…";
  }

  const text = `"${quote}"${attribution}`;
  return { text, candidate, permalink, truncated };
}

/**
 * The two social platforms supported by the post-builder. Each has its
 * own dedup table; the rest of the pipeline (filters, ranking, format)
 * is identical between them.
 */
export type SocialPlatform = "x" | "bluesky";

/**
 * Pick the most intense un-posted notable quote from the lookback
 * window, formatted ready to post. Returns null when no candidate
 * passes the filters — the cron endpoint treats null as "post nothing
 * today" rather than degrading the post.
 *
 * The `platform` parameter selects which dedup table to exclude
 * already-posted responses against. X and Bluesky are tracked
 * separately, so the same response can land on both platforms on the
 * same day; running this with a different platform won't double-post
 * within a platform.
 */
export async function selectTweet(
  hours: number = DEFAULT_LOOKBACK_HOURS,
  platform: SocialPlatform = "x",
): Promise<FormattedTweet | null> {
  const database = db();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Collect already-posted response ids on THIS platform so we can
  // exclude them. The two tables (tweets / bsky_posts) have the same
  // shape and the same response_id column, so we can switch which one
  // we read against without changing the downstream logic.
  const dedupTable =
    platform === "x" ? schema.tweets : schema.bskyPosts;
  const alreadyPosted = await database
    .select({ responseId: dedupTable.responseId })
    .from(dedupTable);
  const excludedIds = alreadyPosted.map((r) => r.responseId);

  // Compose the filter. The intensity ordering is arousal DESC,
  // |valence| DESC — same as the dashboard's dailyNotableQuotes.
  // Joining responses to runs gives us the model display name; joining
  // to prompts gives us the subscale. Both are tiny tables relative
  // to responses so the join cost is negligible.
  const baseConds = [
    gte(schema.responses.createdAt, since),
    isNotNull(schema.responses.notableQuote),
    isNotNull(schema.responses.arousal),
    isNotNull(schema.responses.valence),
    sql`${schema.responses.notableQuote} != ''`,
    sql`NOT ${schema.responses.flagIncoherent}`,
    sql`NOT ${schema.responses.flagRefusal}`,
    sql`NOT ${schema.responses.flagSafety}`,
  ];
  const whereClause =
    excludedIds.length > 0
      ? and(...baseConds, notInArray(schema.responses.id, excludedIds))
      : and(...baseConds);

  const [row] = await database
    .select({
      responseId: schema.responses.id,
      notableQuote: schema.responses.notableQuote,
      modelDisplayName: schema.runs.modelDisplayName,
      subscale: schema.prompts.subscale,
      valence: schema.responses.valence,
      arousal: schema.responses.arousal,
    })
    .from(schema.responses)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.responses.runId))
    .innerJoin(
      schema.prompts,
      and(
        eq(schema.prompts.promptId, schema.responses.promptId),
        eq(schema.prompts.promptSetVersion, schema.runs.promptSetVersion),
      ),
    )
    .where(whereClause)
    .orderBy(
      desc(schema.responses.arousal),
      desc(sql`ABS(${schema.responses.valence})`),
    )
    .limit(1);

  if (!row || row.notableQuote === null) return null;

  const candidate: TweetCandidate = {
    responseId: row.responseId,
    notableQuote: row.notableQuote,
    modelDisplayName: row.modelDisplayName,
    subscale: row.subscale,
    valence: row.valence!,
    arousal: row.arousal!,
  };
  return formatTweet(candidate);
}
