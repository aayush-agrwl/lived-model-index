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
        "HTTP-Referer": "https://github.com/lived-model-index",
        "X-Title": "Lived Model Index",
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
}

export interface ChatCallResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  providerModelId: string | null;
}

export async function chatCall(params: ChatCallParams): Promise<ChatCallResult> {
  const { provider, modelId, messages, temperature, topP, maxTokens, jsonMode } = params;
  const client = clientFor(provider);

  const started = Date.now();
  const completion = await client.chat.completions.create({
    model: modelId,
    messages,
    temperature: temperature ?? 1.0,
    top_p: topP ?? 1.0,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });
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
}
