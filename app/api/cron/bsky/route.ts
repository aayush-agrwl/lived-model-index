import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin, isAuthorizedCron } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { selectTweet } from "@/lib/tweet-builder";
import { postBluesky } from "@/lib/bluesky";

/**
 * POST /api/cron/bsky
 *
 * Daily-fire Bluesky equivalent of /api/cron/tweet. Picks the most
 * striking un-posted (on Bluesky) notable quote from the recent
 * collection window, formats it into the same canonical body the X
 * pipeline uses, and posts it from @aimoodindex.bsky.social via the
 * AT Protocol. Records the post in the bsky_posts table for
 * deduplication.
 *
 * The selection logic excludes only Bluesky-already-posted responses
 * — the X dedup table is consulted by the X cron, not by this one —
 * so the same response can be tweeted on X and posted on Bluesky on
 * the same day. That's intentional: the bot's voice should be
 * consistent across platforms, and platform-specific dedup means a
 * platform that's offline today doesn't permanently lose access to
 * today's quote.
 *
 * Query parameters:
 *   ?dryRun=true — return the formatted post body and the response it
 *                  would have come from, without posting or recording
 *                  anything.
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

  const formatted = await selectTweet(undefined, "bluesky").catch((err) => {
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

  // Post to Bluesky, then record. Same ordering rationale as the X
  // pipeline: post first (the AT Protocol response is the authoritative
  // identifier), record on success. If the DB insert fails, surface a
  // warning with the post URI so the operator can manually backfill.
  let posted: { uri: string; cid: string; text: string };
  try {
    posted = await postBluesky(formatted.text);
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
    await database.insert(schema.bskyPosts).values({
      responseId: formatted.candidate.responseId,
      postUri: posted.uri,
      cid: posted.cid,
      text: posted.text,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: true,
        warning: "posted to Bluesky but failed to record in bsky_posts table",
        postUri: posted.uri,
        cid: posted.cid,
        responseId: formatted.candidate.responseId,
        dbError: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    posted: true,
    postUri: posted.uri,
    cid: posted.cid,
    text: posted.text,
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
