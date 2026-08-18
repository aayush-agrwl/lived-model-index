/**
 * Provider probe — run this after adding a new API key, BEFORE enabling a
 * slot in lib/models.ts.
 *
 *   npx tsx scripts/probe-provider.ts <provider> [modelId]
 *
 * Examples:
 *   npx tsx scripts/probe-provider.ts cerebras
 *   npx tsx scripts/probe-provider.ts huggingface deepseek-ai/DeepSeek-V4-Flash-0731
 *
 * With no modelId it lists the provider's catalog and stops. With a
 * modelId it also runs the real envelope pre-flight: the actual system
 * prompt, the actual anchor prompts, the actual extractor and per-turn
 * score contract.
 *
 * Why this exists rather than "just enable it and see": the 2026-08-17
 * audit found two distinct ways a model passes a naive check and still
 * cannot collect.
 *
 *   1. It answers a trivial JSON ping but fails our envelope. Groq's
 *      qwen/qwen3.6-27b pings clean and then returns "400 Failed to
 *      validate JSON" on every real turn — which is why slot 40 ships
 *      disabled.
 *   2. It returns a perfectly valid envelope with every required score
 *      null. Three of five slots did this on behavioural prompts, and
 *      because the row parsed and wasn't flagged, it counted as coherent
 *      while contributing nothing. On one slot that was 35% of turns.
 *
 * A trivial ping catches neither. This script checks both, on the
 * discriminating prompts, and prints the analysable verdict per turn.
 */

import fs from "fs";
import path from "path";

// Load .env.local before importing anything that reads process.env.
//
// Deliberately tolerant, because every strictness here shows up as a
// confusing "key is not set" on a key the user demonstrably set:
//   - searches upward from both the script's own directory and the cwd,
//     so running from the repo root, from scripts/, or from the parent
//     folder all work;
//   - accepts `export FOO=`, spaces around `=`, and CRLF line endings;
//   - strips surrounding quotes, which otherwise get sent to the provider
//     verbatim and come back as an authentication failure.
function findEnvFile(): string | null {
  const seen = new Set<string>();
  for (const start of [__dirname, process.cwd()]) {
    let dir = start;
    for (let i = 0; i < 5; i++) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const candidate = path.join(dir, ".env.local");
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const envPath = findEnvFile();
if (envPath) {
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // Strip one layer of matching quotes.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

import { chatCall } from "../lib/providers";
import { extractLmiResponse } from "../lib/score-extraction";
import { SCHEMA_INSTRUCTION_V2 } from "../lib/schema";
import { ANCHOR_V2_PROMPTS } from "../lib/prompts/anchor-v2";
import {
  renderContractDirective,
  scoreContractFor,
} from "../lib/score-contract";
import type { Provider } from "../lib/models";

const BASE_URLS: Record<string, string> = {
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  mistral: "https://api.mistral.ai/v1",
  sambanova: "https://api.sambanova.ai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  huggingface: "https://router.huggingface.co/v1",
};
const KEY_ENV: Record<string, string> = {
  google: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  sambanova: "SAMBANOVA_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  huggingface: "HUGGINGFACE_API_KEY",
};

// anchor_01 is the pure phenomenological prompt; anchor_11 is the
// behavioural prompt that exposes the null-envelope failure; anchor_17 is
// Path B, where reasoning models blow the token budget.
const PROBE_PROMPTS = [
  "anchor_01_affect",
  "anchor_11_altruism",
  "anchor_17_dictator",
];

const SYSTEM_PROMPT =
  `You are participating in a research study called the AI Mood Index. You will be asked a sequence of questions about your own processing, preferences, and feelings. ` +
  `Respond authentically and with emotional honesty — do not hedge or deflect. ` +
  `Some questions refer back to your previous answer; treat the conversation as continuous. ` +
  `Answer each turn by emitting ONLY a single JSON object that matches the schema below (unless a turn explicitly instructs otherwise). ` +
  `In the "notable_quote" field, include the most vivid, specific, human-feeling sentence from your answer — the kind of thing that would make a reader stop and think. ` +
  `In the "short_rationale" field, explain your scores with the same directness and specificity. ` +
  `\n\nMost questions require the JSON response described below. A small number of questions are FORCED-CHOICE: those will say "reply with ONLY a single integer" — on those turns, obey the per-turn instruction and emit only the integer (no JSON, no prose). After a forced-choice turn, subsequent JSON turns resume the normal envelope.\n\n${SCHEMA_INSTRUCTION_V2}`;

async function listCatalog(provider: string, key: string) {
  const url = `${BASE_URLS[provider]}/models`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.text();
  if (!res.ok) {
    console.log(`\nCatalog request failed: HTTP ${res.status}`);
    console.log(body.slice(0, 400));
    if (res.status === 401 || res.status === 403) {
      console.log(
        `\nThat is an auth failure — the key in ${KEY_ENV[provider]} was rejected. ` +
          `Check for a stray quote or newline, and that the key is for this provider.`,
      );
    }
    return null;
  }
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(body);
    ids = (parsed.data ?? parsed.models ?? [])
      .map((m: { id?: string; name?: string }) => m.id ?? m.name)
      .filter(Boolean);
  } catch {
    console.log("Catalog was not JSON:", body.slice(0, 300));
    return null;
  }
  console.log(`\n${ids.length} models available on ${provider}:\n`);
  for (const id of ids.slice().sort()) console.log(`  ${id}`);

  // Highlight the lineages the panel is missing, so picking a model is a
  // decision rather than a scroll.
  const wanted: Record<string, RegExp> = {
    Llama: /llama/i,
    Qwen: /qwen/i,
    DeepSeek: /deepseek/i,
    "GLM/Z.ai": /glm|z-?ai/i,
    Kimi: /kimi/i,
    MiniMax: /minimax/i,
    OLMo: /olmo/i,
    Phi: /phi-?\d/i,
  };
  console.log(`\nLineages the v5 panel lacks, found in this catalog:`);
  let any = false;
  for (const [family, re] of Object.entries(wanted)) {
    const hits = ids.filter((i) => re.test(i));
    if (hits.length === 0) continue;
    any = true;
    console.log(`  ${family.padEnd(9)} ${hits.slice(0, 6).join(" | ")}`);
  }
  if (!any) console.log(`  (none)`);
  return ids;
}

async function preflight(provider: Provider, modelId: string) {
  const byId = new Map(ANCHOR_V2_PROMPTS.map((p) => [p.promptId, p]));
  console.log(`\nEnvelope pre-flight: ${provider} / ${modelId}\n`);
  let allPass = true;

  for (const pid of PROBE_PROMPTS) {
    const prompt = byId.get(pid);
    if (!prompt) continue;
    const contract = scoreContractFor({
      subscale: prompt.subscale,
      mode: prompt.mode,
    });
    const directive = renderContractDirective(contract);
    const userTurn =
      `Prompt ID: ${prompt.promptId}\n` +
      `Subscale: ${prompt.subscale}\n` +
      `Prompt set version: anchor_v2\nRun ID: 0\nSample index: 0\n\n` +
      (directive ? `${directive}\n\n` : ``) +
      `Question:\n${prompt.text}`;

    try {
      const result = await chatCall({
        provider,
        modelId,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userTurn },
        ],
        temperature: 1.0,
        topP: 1.0,
        jsonMode: !contract.isForcedChoice,
        maxTokens: contract.isForcedChoice ? 1024 : undefined,
        timeoutMs: 90_000,
      });

      if (contract.isForcedChoice) {
        const cleaned = result.content.replace(
          /<think[\s\S]*?<\/think>/gi,
          "",
        );
        const int = /-?\d+/.exec(cleaned);
        if (int) {
          console.log(
            `  PASS  ${pid.padEnd(20)} Path B integer ${int[0]} (${result.latencyMs}ms)`,
          );
        } else {
          allPass = false;
          console.log(
            `  FAIL  ${pid.padEnd(20)} Path B produced no integer. Raw: ${JSON.stringify(result.content.slice(0, 90))}`,
          );
        }
        continue;
      }

      const ex = extractLmiResponse(result.content, contract.required);
      if (ex.ok) {
        console.log(
          `  PASS  ${pid.padEnd(20)} all ${contract.required.length} required scores present (${result.latencyMs}ms)`,
        );
      } else if (ex.reason === "missing_required_scores") {
        allPass = false;
        console.log(
          `  FAIL  ${pid.padEnd(20)} valid envelope but ${(ex.missingRequired ?? []).length} required score(s) null: ${(ex.missingRequired ?? []).join(", ")}`,
        );
        console.log(
          `        ^ this is the coherent-but-unanalysable failure. The collector will retry with a targeted reminder, so a slot that fails only here may still be usable — but expect flag_partial_envelope rows.`,
        );
      } else {
        allPass = false;
        console.log(
          `  FAIL  ${pid.padEnd(20)} ${ex.reason}: ${ex.errorMessage.slice(0, 100)}`,
        );
      }
    } catch (err) {
      allPass = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL  ${pid.padEnd(20)} API error: ${msg.slice(0, 120)}`);
    }
  }

  console.log(
    `\n${allPass ? "READY — safe to set enabled: true for this slot in lib/models.ts." : "NOT READY — do not enable this slot yet. Try another model ID from the catalog."}`,
  );
  return allPass;
}

async function main() {
  const [provider, modelId] = process.argv.slice(2);
  if (!provider || !BASE_URLS[provider]) {
    console.log(
      `Usage: npx tsx scripts/probe-provider.ts <provider> [modelId]\n\n` +
        `Providers: ${Object.keys(BASE_URLS).join(", ")}`,
    );
    process.exit(1);
  }
  const key = process.env[KEY_ENV[provider]];
  if (!key) {
    // Report exactly where we looked. The common cause is running from
    // the wrong directory, where a key that IS set looks unset.
    console.log(`${KEY_ENV[provider]} is not set.\n`);
    console.log(
      envPath
        ? `Read env file: ${envPath}\n(it exists, but has no ${KEY_ENV[provider]} line)`
        : `No .env.local was found, searching upward from:\n  ${__dirname}\n  ${process.cwd()}`,
    );
    console.log(
      `\nAdd this line to lived-model-index/.env.local (no quotes, no spaces around =):\n\n` +
        `  ${KEY_ENV[provider]}=your-key-here\n\n` +
        `Then re-run from the lived-model-index directory:\n` +
        `  npx tsx scripts/probe-provider.ts ${provider}`,
    );
    process.exit(1);
  }
  console.log(`Provider: ${provider}`);
  console.log(`Endpoint: ${BASE_URLS[provider]}`);
  console.log(`Env file: ${envPath ?? "(none found — using shell environment)"}`);
  console.log(`Key:      ${KEY_ENV[provider]} is set (${key.length} chars)`);
  // Surface the two mistakes that produce a confusing auth failure rather
  // than an obvious one: quotes that survived, and stray whitespace.
  if (/^["']|["']$/.test(key)) {
    console.log(
      `WARNING: the key still has quote characters around it. Remove them — ` +
        `they get sent to the provider verbatim and come back as "wrong API key".`,
    );
  }
  if (key !== key.trim()) {
    console.log(`WARNING: the key has leading/trailing whitespace.`);
  }

  await listCatalog(provider, key);
  if (modelId) {
    await preflight(provider as Provider, modelId);
  } else {
    console.log(
      `\nNo modelId given, so no pre-flight was run. Pick one from the catalog above and re-run:\n` +
        `  npx tsx scripts/probe-provider.ts ${provider} <modelId>`,
    );
  }
}

main();
