import { TwitterApi, ApiResponseError } from "twitter-api-v2";

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
  // Trim each env var defensively. The single most common cause of
  // 401-Unauthorized from X on a freshly-set-up app is trailing
  // whitespace, newlines, or surrounding quotes in the env-var values
  // — the OAuth signature is computed over the literal key bytes, so
  // a stray "\n" silently breaks every request.
  const apiKey = process.env.TWITTER_API_KEY?.trim();
  const apiSecret = process.env.TWITTER_API_SECRET?.trim();
  const accessToken = process.env.TWITTER_ACCESS_TOKEN?.trim();
  const accessSecret = process.env.TWITTER_ACCESS_SECRET?.trim();

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

/**
 * Build a verbose, copy-paste-friendly diagnostic message for an X API
 * error. The bare twitter-api-v2 default ("Request failed with code
 * 401") hides the upstream error body, which is where the real reason
 * lives — wrong scope, expired token, regenerated key, etc.
 */
function describeError(err: unknown): string {
  if (err instanceof ApiResponseError) {
    const status = err.code;
    // err.data is the parsed body; X's V2 endpoints return an envelope
    // like { title, detail, status, type } and V1.1 returns { errors:
    // [{ code, message }, ...] }. We surface whichever shape is
    // present.
    const body = err.data as
      | { title?: string; detail?: string; errors?: Array<{ code?: number; message?: string }> }
      | undefined;
    const v2Bits = [body?.title, body?.detail].filter(Boolean).join(" — ");
    const v1Bits = body?.errors
      ?.map((e) => `[${e.code ?? "?"}] ${e.message ?? ""}`)
      .join("; ");
    const detail = v2Bits || v1Bits || err.message || "(no detail)";
    return `HTTP ${status}: ${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
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
  try {
    const me = await client().v2.me();
    return {
      username: me.data.username,
      userId: me.data.id,
      name: me.data.name,
    };
  } catch (err) {
    // Re-throw with a verbose, X-detail-aware message. The default
    // twitter-api-v2 message is opaque ("Request failed with code 401")
    // and hides the underlying reason that the API actually returned.
    throw new Error(`X verifyCredentials failed: ${describeError(err)}`);
  }
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
  try {
    const result = await client().v2.tweet(text);
    return { tweetId: result.data.id, text: result.data.text };
  } catch (err) {
    throw new Error(`X postTweet failed: ${describeError(err)}`);
  }
}
