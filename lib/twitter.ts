import { TwitterApi } from "twitter-api-v2";

/**
 * OAuth1.0a user-context client for the @AIMoodIndex automation account.
 *
 * The account uses the X Free tier (write access ~1500 posts/month) which
 * is well above our once-a-day cadence. We only ever post to @AIMoodIndex
 * itself; no read endpoints other than the credentials-verification call
 * are used.
 *
 * All four secrets must be present. The wrapper is the single place in
 * the codebase that touches the X SDK, so a future provider swap or a
 * change to OAuth2.0 user-context flow is a one-file edit.
 */

interface TwitterEnv {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

function readEnv(): TwitterEnv {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  const missing: string[] = [];
  if (!apiKey) missing.push("TWITTER_API_KEY");
  if (!apiSecret) missing.push("TWITTER_API_SECRET");
  if (!accessToken) missing.push("TWITTER_ACCESS_TOKEN");
  if (!accessSecret) missing.push("TWITTER_ACCESS_SECRET");
  if (missing.length > 0) {
    throw new Error(
      `Missing X API credential env vars: ${missing.join(", ")}. ` +
        `All four OAuth1.0a values are required for any X API call.`,
    );
  }

  return {
    apiKey: apiKey!,
    apiSecret: apiSecret!,
    accessToken: accessToken!,
    accessSecret: accessSecret!,
  };
}

let cached: TwitterApi | null = null;

function client(): TwitterApi {
  if (cached) return cached;
  const env = readEnv();
  cached = new TwitterApi({
    appKey: env.apiKey,
    appSecret: env.apiSecret,
    accessToken: env.accessToken,
    accessSecret: env.accessSecret,
  });
  return cached;
}

/**
 * Confirm the configured credentials authenticate to the expected
 * @AIMoodIndex account, without posting anything. Used by the
 * admin-panel verification button so we can confirm key wiring before
 * publishing real content.
 *
 * Returns the authenticated user's screen name (e.g. "AIMoodIndex") on
 * success. Throws on any auth error so the caller can surface the
 * upstream message verbatim — these errors are usually about scope or
 * wrong-key combinations and the message is the most useful diagnostic.
 */
export async function verifyCredentials(): Promise<{
  username: string;
  userId: string;
  name: string;
}> {
  const me = await client().v2.me();
  return {
    username: me.data.username,
    userId: me.data.id,
    name: me.data.name,
  };
}

/**
 * Post a single tweet from the authenticated account. `text` must be
 * within the X 280-character limit; the caller is responsible for
 * truncation and formatting decisions.
 *
 * Returns the new tweet's id on success so callers can persist it
 * (the AMI tweets table records this for audit + dedup). Throws on
 * any upstream error.
 */
export async function postTweet(text: string): Promise<{
  tweetId: string;
  text: string;
}> {
  if (!text || text.trim().length === 0) {
    throw new Error("postTweet: refusing to post an empty tweet.");
  }
  if (text.length > 280) {
    throw new Error(
      `postTweet: text exceeds 280 characters (${text.length}). ` +
        `Truncate or shorten upstream of this call.`,
    );
  }
  const result = await client().v2.tweet(text);
  return { tweetId: result.data.id, text: result.data.text };
}
