import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin, isAuthorizedCron } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { selectTweet } from "@/lib/tweet-builder";
import { postTweet } from "@/lib/twitter";

/**
 * POST /api/cron/tweet
 *
 * Daily-fire endpoint that picks the most striking un-tweeted notable
 * quote from the recent collection window, formats it into the
 * canonical tweet body (verbatim quote + model attribution + subscale
 * + response permalink), and posts it from @AIMoodIndex via the X
 * API. Records the post in the tweets table for deduplication.
 *
 * Query parameters:
 *   ?dryRun=true — return the formatted tweet body and the response
 *                  it would have come from, without posting or
 *                  recording anything. Useful for previewing what
 *                  today's tweet will look like, or for the admin
 *                  panel's manual-trigger button to render a confirm
 *                  step before going live.
 *
 * On a day where no candidate response passes the filters (refusals,
 * safety-flagged content, self-flagged-incoherent rows, missing
 * affect data, all-already-tweeted), the endpoint returns
 * { ok: true, skipped: "no eligible candidate" } — explicitly silent
 * rather than degrading content.
 *
 * Access: cron bearer secret OR admin cookie.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req) && !isAuthorizedAdmin()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  const formatted = await selectTweet().catch((err) => {
    return { _error: err instanceof Error ? err.message : String(err) } as const;
  });

  if (formatted && "_error" in formatted) {
    return NextResponse.json(
      { ok: false, phase: "select", error: formatted._error },
      { status: 500 },
    );
  }

  if (!formatted) {
    return NextResponse.json({
      ok: true,
      skipped: "no eligible candidate in lookback window",
    });
  }

  // Dry run: surface what would have been posted without touching X
  // or the tweets table. This is the path the admin "Preview tweet"
  // button uses, and it's safe to call repeatedly.
  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      text: formatted.text,
      length: formatted.text.length,
      truncated: formatted.truncated,
      candidate: {
        responseId: formatted.candidate.responseId,
        modelDisplayName: formatted.candidate.modelDisplayName,
        subscale: formatted.candidate.subscale,
        valence: formatted.candidate.valence,
        arousal: formatted.candidate.arousal,
      },
      permalink: formatted.permalink,
    });
  }

  // Live post. Order: post first, record on success. If posting
  // succeeds but the DB insert fails, the next tick will skip the
  // already-tweeted response (the X API itself is the system of
  // record), but we'd lose the audit row — handled by surfacing the
  // failure with the tweet id so the operator can manually backfill
  // the tweets row if needed.
  let tweetId: string;
  try {
    const posted = await postTweet(formatted.text);
    tweetId = posted.tweetId;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        phase: "post",
        error: err instanceof Error ? err.message : String(err),
        candidate: { responseId: formatted.candidate.responseId },
      },
      { status: 500 },
    );
  }

  try {
    const database = db();
    await database.insert(schema.tweets).values({
      responseId: formatted.candidate.responseId,
      tweetId,
      text: formatted.text,
    });
  } catch (err) {
    // The tweet is already live on X; flag the DB miss but report
    // success on the post itself. The operator should manually insert
    // a tweets row to restore dedup safety on the next run.
    return NextResponse.json(
      {
        ok: true,
        warning: "posted to X but failed to record in tweets table",
        tweetId,
        responseId: formatted.candidate.responseId,
        dbError: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    posted: true,
    tweetId,
    text: formatted.text,
    candidate: {
      responseId: formatted.candidate.responseId,
      modelDisplayName: formatted.candidate.modelDisplayName,
      subscale: formatted.candidate.subscale,
    },
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
