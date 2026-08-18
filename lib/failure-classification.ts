/**
 * Provider-failure taxonomy.
 *
 * Before panel v5 the pipeline had exactly one response to a failed call:
 * write `<api error: …>` into the response row, flag it incoherent, and
 * carry on to the next prompt. When the failure was permanent — the model
 * no longer exists, the key is dead, the credits are gone — that produced
 * 21 identical error rows per day per slot and a run whose status was
 * still "completed", because "completed" only ever meant "no unfilled
 * placeholder rows remain".
 *
 * The 2026-08-17 audit measured the cost of that: 4,882 api_error rows,
 * four slots dark for between 31 and 86 days, and nothing anywhere in the
 * product saying so. Two Groq models were decommissioned on the same day
 * (2026-07-17) and the panel silently narrowed from 7 to 3.
 *
 * This module separates failures that are worth retrying from failures
 * that mean "this slot cannot collect today, stop calling it". The
 * collector uses `isPermanent` to abort a run on the FIRST such error
 * rather than on the 21st, and stamps `kind` onto runs.failure_kind so the
 * cause survives in the data and on /health.
 */

export type FailureKind =
  /** Model ID is gone, renamed, or not available to this account (404). */
  | "model_unavailable"
  /** Key rejected: missing, revoked, or wrong project (401/403). */
  | "auth"
  /** Account needs money: credits exhausted, card required (402). */
  | "billing"
  /** Daily budget spent — tokens-per-day or free-models-per-day. */
  | "quota_daily"
  /** Short-window rate limit; the same call may succeed in seconds. */
  | "rate_limit"
  /** Our call exceeded its deadline. */
  | "timeout"
  /** Provider's JSON-mode constrainer rejected the generation. */
  | "json_contract"
  /** Provider-side 5xx. */
  | "server"
  /** Anything we haven't taught this function to recognise. */
  | "unknown";

export interface FailureClassification {
  kind: FailureKind;
  /**
   * True when retrying — this call, this prompt, or the remaining 20
   * prompts in the sample — cannot possibly succeed until a human changes
   * something (swaps the model ID, fixes the key, adds a payment method).
   * The collector aborts the whole run when it sees one of these.
   */
  isPermanent: boolean;
  /**
   * True when the rest of today is lost but tomorrow is fine, so the run
   * should stop early without being treated as a configuration error.
   */
  isDailyExhaustion: boolean;
  /** Verbatim provider message, truncated for storage. */
  message: string;
}

const MAX_MESSAGE_LEN = 500;

/**
 * Order matters: the first pattern that matches wins, so the most
 * specific and most consequential checks come first. Every regex here was
 * written against a message string actually observed in the corpus or in
 * live probing on 2026-08-17 — the comment on each says where it came
 * from, so a future reader can tell a real pattern from a guess.
 */
export function classifyFailure(err: unknown): FailureClassification {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const message = raw.slice(0, MAX_MESSAGE_LEN);

  const permanent = (kind: FailureKind): FailureClassification => ({
    kind,
    isPermanent: true,
    isDailyExhaustion: false,
    message,
  });
  const transient = (
    kind: FailureKind,
    isDailyExhaustion = false,
  ): FailureClassification => ({
    kind,
    isPermanent: false,
    isDailyExhaustion,
    message,
  });

  // ---- Permanent: the model is gone ----
  // Groq, 2026-07-17 onward, 651 rows each for Llama 4 Scout and Qwen 3
  // 32B: "The model `X` does not exist or you do not have access to it."
  if (/does not exist or you do not have access/i.test(raw)) {
    return permanent("model_unavailable");
  }
  // Google, probed 2026-08-17 on gemini-2.5-flash-lite: "This model
  // models/X is no longer available to new users."
  if (/no longer available/i.test(raw)) {
    return permanent("model_unavailable");
  }
  // OpenRouter, 2026-05-30 onward, 1,502 rows: "This model is unavailable
  // for free. The paid version is available now - use this slug instead".
  // Distinct from a 402 because the ACCOUNT is fine; the free route died.
  if (/unavailable for free/i.test(raw)) {
    return permanent("model_unavailable");
  }
  if (/model_not_found|\bmodel not found\b/i.test(raw)) {
    return permanent("model_unavailable");
  }

  // ---- Permanent: the account is the problem ----
  // SambaNova, 2026-05-23 onward, 1,843 rows across three message
  // variants: "402 A payment method is required…", code
  // PAYMENT_METHOD_REQUIRED, balance_units: 0.
  if (
    /payment method (is )?required|PAYMENT_METHOD_REQUIRED|insufficient (credit|balance|funds)|\bbalance_units\b/i.test(
      raw,
    )
  ) {
    return permanent("billing");
  }
  if (/\b402\b/.test(raw)) return permanent("billing");
  if (
    /invalid api key|invalid_api_key|unauthorized|forbidden|authentication|\b401\b|\b403\b/i.test(
      raw,
    )
  ) {
    return permanent("auth");
  }
  // Our own error from providers.ts when the env var is absent. Permanent
  // by definition — no retry can conjure a key, and every remaining prompt
  // would fail identically.
  //
  // This matters most at deploy time. Panel v5 runs seven slots across
  // five providers, so shipping code that enables a slot before its key
  // reaches Vercel is an easy mistake. Without this branch that mistake
  // costs 21 placeholder rows per slot per day — the exact pollution the
  // v5 failure signal exists to prevent. With it, the run aborts on the
  // first prompt and /health names the slot.
  if (/Missing API key for provider/i.test(raw)) {
    return permanent("auth");
  }

  // ---- Transient but terminal for today ----
  // Groq TPD: "Rate limit reached for model X … on tokens per day (TPD):
  // Limit 100000, Used 99006 … Please try again in 13m34s."
  // OpenRouter free tier: "Rate limit exceeded: free-models-per-day."
  if (
    /per day|\bTPD\b|free-models-per-day|try again in \d+m|daily (limit|quota)/i.test(
      raw,
    )
  ) {
    return transient("quota_daily", true);
  }

  // ---- Ordinary transients ----
  // Groq's JSON-mode constrainer: "400 Failed to generate JSON" /
  // "400 Failed to validate JSON. Please adjust your prompt." The second
  // is what qwen/qwen3.6-27b returns on our envelope every time, which is
  // why slot 40 ships disabled.
  if (/Failed to (generate|validate) JSON/i.test(raw)) {
    return transient("json_contract");
  }
  if (/timed? ?out|timeout|APIConnectionTimeoutError/i.test(raw)) {
    return transient("timeout");
  }
  if (/\b429\b|rate limit/i.test(raw)) return transient("rate_limit");
  if (/\b5\d\d\b|ECONNRESET|ETIMEDOUT|fetch failed/i.test(raw)) {
    return transient("server");
  }

  return transient("unknown");
}

/**
 * Human-readable one-liner for /health and /admin. Deliberately says what
 * to DO about it, because the whole point of panel v5 is that a dead slot
 * should be impossible to mistake for a working one.
 */
export function describeFailureKind(kind: FailureKind): string {
  switch (kind) {
    case "model_unavailable":
      return "Model ID no longer served — pick a replacement in lib/models.ts";
    case "auth":
      return "API key rejected — check the provider env var";
    case "billing":
      return "Provider needs payment — credits exhausted";
    case "quota_daily":
      return "Daily quota spent — recovers at the provider's reset";
    case "rate_limit":
      return "Rate limited — transient, pacing may need raising";
    case "timeout":
      return "Calls exceeded their deadline";
    case "json_contract":
      return "Provider's JSON mode rejected our envelope";
    case "server":
      return "Provider-side error";
    case "unknown":
      return "Unrecognised failure — read error_message";
  }
}
