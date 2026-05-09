import { AtpAgent, RichText } from "@atproto/api";

/**
 * AT Protocol client for the @aimoodindex.bsky.social automation
 * account.
 *
 * Bluesky uses "app passwords" — separate from the account password,
 * generated at bsky.app/settings/app-passwords — for programmatic
 * access. Two env vars are required:
 *
 *   BLUESKY_IDENTIFIER     — the account handle, e.g. "aimoodindex.bsky.social"
 *   BLUESKY_APP_PASSWORD   — the app password generated in account settings
 *
 * Bluesky's free API has no per-call billing equivalent to X's Pay
 * Per Use; the rate limits are generous enough that one post per day
 * is well within reach without paid plans.
 *
 * The wrapper deliberately mirrors lib/twitter.ts so a future swap or
 * a new platform addition is a one-file change.
 */

interface BlueskyEnv {
  identifier: string;
  appPassword: string;
}

function readEnv(): BlueskyEnv {
  // Trim defensively: same lesson learned from the X setup. A trailing
  // newline on the app password silently breaks login.
  const identifier = process.env.BLUESKY_IDENTIFIER?.trim();
  const appPassword = process.env.BLUESKY_APP_PASSWORD?.trim();

  const missing: string[] = [];
  if (!identifier) missing.push("BLUESKY_IDENTIFIER");
  if (!appPassword) missing.push("BLUESKY_APP_PASSWORD");
  if (missing.length > 0) {
    throw new Error(
      `Missing Bluesky credential env vars: ${missing.join(", ")}. ` +
        `Both BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD are required.`,
    );
  }

  return { identifier: identifier!, appPassword: appPassword! };
}

/**
 * Lazily-built, login-cached agent. The AT Protocol SDK requires an
 * explicit `login()` call before any authenticated operation; we cache
 * the logged-in agent so successive calls in the same function
 * invocation don't re-authenticate.
 *
 * Sessions don't persist across cold starts (Vercel functions are
 * stateless), so a serverless invocation will always do at least one
 * login round-trip. That's fine — login is fast (~200ms) and Bluesky
 * doesn't penalise frequent re-login on the same account.
 */
let cachedAgent: AtpAgent | null = null;

async function agent(): Promise<AtpAgent> {
  if (cachedAgent) return cachedAgent;
  const env = readEnv();
  const a = new AtpAgent({ service: "https://bsky.social" });
  await a.login({ identifier: env.identifier, password: env.appPassword });
  cachedAgent = a;
  return a;
}

/**
 * Confirm the configured credentials authenticate to Bluesky and
 * return the resolved account handle and DID. Used by the admin-
 * panel verification button so we can confirm key wiring before
 * publishing real content.
 *
 * Throws on any auth error; the SDK's error messages are usually
 * clear (bad password, unknown identifier, account disabled) and we
 * pass them through verbatim.
 */
export async function verifyBlueskyCredentials(): Promise<{
  handle: string;
  did: string;
}> {
  try {
    const a = await agent();
    // a.session is populated by login() and is the most reliable
    // source of the resolved handle + DID.
    if (!a.session) {
      throw new Error("Bluesky agent has no session after login.");
    }
    return { handle: a.session.handle, did: a.session.did };
  } catch (err) {
    throw new Error(
      `Bluesky verifyCredentials failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface BlueskyPostResult {
  uri: string;
  cid: string;
  text: string;
}

/**
 * Post a single record to Bluesky from the authenticated account.
 * Bluesky's character limit is 300 graphemes (slightly more generous
 * than X's 280), and unlike X, URLs are NOT auto-shortened — they
 * count their full length toward the 300 budget. The caller is
 * responsible for staying within budget; this function will fail
 * loudly rather than truncate silently.
 *
 * Uses the SDK's RichText helper to detect URLs and mentions in the
 * text and emit them as facets, so the rendered post has clickable
 * links rather than plain-text URLs. This is the standard pattern
 * recommended in the AT Protocol docs.
 */
export async function postBluesky(text: string): Promise<BlueskyPostResult> {
  if (!text || text.trim().length === 0) {
    throw new Error("postBluesky: refusing to post an empty record.");
  }
  // Bluesky uses graphemes for length, not codepoints. The SDK's
  // RichText counts graphemes correctly and exposes .graphemeLength.
  const rt = new RichText({ text });
  if (rt.graphemeLength > 300) {
    throw new Error(
      `postBluesky: text exceeds 300 graphemes (${rt.graphemeLength}). ` +
        `Truncate or shorten upstream of this call.`,
    );
  }

  try {
    const a = await agent();
    // detectFacets() finds URLs, @-mentions, and #-hashtags in the
    // text and produces a facets array describing where each is in
    // byte-offset terms. Required for clickable links.
    await rt.detectFacets(a);
    const result = await a.post({
      text: rt.text,
      facets: rt.facets,
      // Default langs to English. Bluesky surfaces a "translate" UI
      // for posts whose declared language differs from the viewer's
      // preferred language; declaring en explicitly avoids the
      // translation prompt for English readers.
      langs: ["en"],
    });
    return { uri: result.uri, cid: result.cid, text: rt.text };
  } catch (err) {
    throw new Error(
      `postBluesky failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
