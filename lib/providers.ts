import OpenAI from "openai";
import type { Provider } from "./models";

/**
 * Unified OpenAI-compatible client layer.
 *
 * All three providers on our free-tier stack expose an OpenAI-compatible
 * Chat Completions endpoint, so a single SDK suffices:
 *
 *   - Google Gemini via its OpenAI compatibility endpoint
 *   - Groq natively
 *   - OpenRouter natively
 *
 * If we later add Anthropic or a native-only API, this file gains a branch
 * without other files needing to change.
 */

const BASE_URLS: Record<Provider, string> = {
  google: "https://generativelanguage.googleapis.com/v1beta/openai/",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

function apiKeyFor(provider: Provider): string {
  const env = {
    google: process.env.GOOGLE_API_KEY,
    groq: process.env.GROQ_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  }[provider];

  if (!env) {
    throw new Error(
      `Missing API key env var for provider "${provider}". ` +
        `Expected GOOGLE_API_KEY | GROQ_API_KEY | OPENROUTER_API_KEY in the environment.`,
    );
  }
  return env;
}

/**
 * Cached clients per provider. OpenAI's SDK is safe to reuse.
 */
const clients: Partial<Record<Provider, OpenAI>> = {};

export function clientFor(provider: Provider): OpenAI {
  const cached = clients[provider];
  if (cached) return cached;

  const client = new OpenAI({
    baseURL: BASE_URLS[provider],
    apiKey: apiKeyFor(provider),
    // OpenRouter recommends these identifying headers:
    ...(provider === "openrouter" && {
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/ai-mood-index",
        "X-Title": "AI Mood Index",
      },
    }),
  });

  clients[provider] = client;
  return client;
}

export interface ChatCallParams {
  provider: Provider;
  modelId: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /**
   * Whether to request JSON-object output mode. Supported by all three
   * providers via the OpenAI-compatible response_format field.
   */
  jsonMode?: boolean;
  /**
   * Per-call timeout in milliseconds. The OpenAI SDK's default is 10
   * minutes, which lets a slow provider (e.g. OpenRouter free tier) hang
   * the entire tick. Defaults to 55 000ms; raise in ModelEntry.timeoutMs
   * for models whose p95 latency exceeds that ceiling.
   */
  timeoutMs?: number;
}

export interface ChatCallResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  providerModelId: string | null;
}

/**
 * Transient errors worth retrying. 4xx for quota / 429 / 408, 5xx in general.
 * A daily TPD exhaustion (message mentions "try again in" with minutes) is
 * explicitly NOT retried — sleeping 15 minutes inside a 60s serverless
 * function is pointless.
 */
function isRetriable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/try again in \d+m/i.test(msg)) return false; // long cooldown — give up
  if (/per day|TPD/i.test(msg)) return false; // daily quota — give up
  // Timeout: retrying a call that already took 55–90s is never worth it.
  if (/timed? ?out|timeout/i.test(msg)) return false;
  if (err instanceof Error && err.name === "APIConnectionTimeoutError") return false;
  if (/\b429\b/.test(msg)) return true;
  if (/\b408\b/.test(msg)) return true;
  if (/\b5\d\d\b/.test(msg)) return true;
  if (/ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)) return true;
  return false;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function chatCall(params: ChatCallParams): Promise<ChatCallResult> {
  const { provider, modelId, messages, temperature, topP, maxTokens, jsonMode, timeoutMs } = params;
  const client = clientFor(provider);
  // Default to 55s. OpenAI SDK default is 10 minutes, which lets a slow
  // OpenRouter free-tier model hang the entire tick function indefinitely.
  const callTimeoutMs = timeoutMs ?? 55_000;

  const maxAttempts = 3;
  let lastErr: unknown;
  // Track whether we've already softened OpenRouter routing on a prior
  // attempt in this same call. Once we drop require_parameters in
  // response to a "no endpoints" error, we stay in soft mode for the
  // remaining retries — flipping back and forth would just reproduce
  // the same failure.
  let openrouterStrict = true;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const started = Date.now();
      // OpenRouter-specific routing preferences — spread onto the OpenAI
      // body only for the OpenRouter provider path. Two hints:
      //   - sort: "throughput" picks the fastest (tokens/s) available
      //     backend for this model. For slow free-tier routes like
      //     GLM 4.5 Air, this can cut per-call latency materially.
      //   - require_parameters: true filters out backends that silently
      //     ignore params we care about (specifically response_format
      //     for JSON mode). Should also reduce our JSON-contract retry
      //     rate on the OpenRouter slot.
      //
      // If a prior attempt got "404 No endpoints found that can handle
      // the requested parameters", we drop require_parameters for the
      // retry. The strict filter occasionally collapses the candidate
      // pool to zero on free-tier routes (GLM 4.5 Air free, especially)
      // when no backend that day advertises response_format support.
      // Reaching the model and possibly getting non-JSON back is better
      // than getting nothing — our extraction layer handles non-JSON
      // gracefully (Zod safeParse → coercion → flag as incoherent).
      // The `provider` field isn't in the OpenAI schema, so we cast via
      // `unknown` to an empty record — TypeScript won't see the fields,
      // but the runtime spread still carries them onto the request body.
      const openrouterRouting =
        provider === "openrouter"
          ? ({
              provider: openrouterStrict
                ? { sort: "throughput", require_parameters: true }
                : { sort: "throughput" },
            } as unknown as Record<string, never>)
          : {};
      const completion = await client.chat.completions.create(
        {
          model: modelId,
          messages,
          temperature: temperature ?? 1.0,
          top_p: topP ?? 1.0,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          ...openrouterRouting,
        },
        { timeout: callTimeoutMs },
      );
      const latencyMs = Date.now() - started;

      const content = completion.choices[0]?.message?.content ?? "";
      const usage = completion.usage;

      return {
        content,
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        latencyMs,
        providerModelId: completion.model ?? null,
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err ?? "");

      // OpenRouter "no endpoints found" with strict filtering on:
      // soften routing and retry immediately. Doesn't count against
      // the retry budget so we still have full attempts left if the
      // soft path also fails for an unrelated reason.
      const isOpenrouterNoEndpoints =
        provider === "openrouter" &&
        openrouterStrict &&
        /No endpoints found/i.test(msg);
      if (isOpenrouterNoEndpoints && attempt < maxAttempts) {
        openrouterStrict = false;
        // No backoff — this isn't a rate limit, it's a routing miss.
        continue;
      }

      if (attempt === maxAttempts || !isRetriable(err)) throw err;
      // Backoff sized to the failure type. 429s against Google free
      // tier need close to a full 60s window to clear — a 1s/3s
      // backoff effectively guaranteed a second and third failure.
      // 5xx / transient network errors clear much faster so we keep
      // those quick.
      const is429 = /\b429\b/.test(msg);
      const baseMs = is429 ? 12_000 : 1_000;
      const delay =
        baseMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
      await sleep(delay);
    }
  }

  throw lastErr;
}
