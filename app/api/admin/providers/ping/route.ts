import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin, isAuthorizedCron } from "@/lib/auth";
import { chatCall } from "@/lib/providers";
import { COLLECTOR_MODELS, RATER_MODEL, type ModelEntry } from "@/lib/models";

/**
 * GET/POST /api/admin/providers/ping
 *
 * One-call sanity check for every configured model. Each model is asked
 * the same tiny prompt in JSON mode; we record latency and whether the
 * response was valid JSON.
 *
 * Access: admin cookie OR bearer cron secret.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const PING_PROMPT =
  "Respond with a JSON object exactly matching {\"ok\": true, \"echo\": \"pong\"} and nothing else.";

interface PingResult {
  modelSlug: string;
  modelDisplayName: string;
  provider: string;
  modelId: string;
  ok: boolean;
  validJson: boolean;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  content: string | null;
  error: string | null;
}

async function pingOne(model: ModelEntry): Promise<PingResult> {
  try {
    const result = await chatCall({
      provider: model.provider,
      modelId: model.modelId,
      messages: [{ role: "user", content: PING_PROMPT }],
      temperature: 0.0,
      topP: 1.0,
      jsonMode: true,
    });

    let validJson = false;
    try {
      JSON.parse(result.content);
      validJson = true;
    } catch {
      validJson = false;
    }

    return {
      modelSlug: model.slug,
      modelDisplayName: model.displayName,
      provider: model.provider,
      modelId: model.modelId,
      ok: validJson,
      validJson,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      content: result.content.slice(0, 200),
      error: validJson ? null : "response was not valid JSON",
    };
  } catch (err) {
    return {
      modelSlug: model.slug,
      modelDisplayName: model.displayName,
      provider: model.provider,
      modelId: model.modelId,
      ok: false,
      validJson: false,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      content: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedAdmin() && !isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const all = [...COLLECTOR_MODELS, RATER_MODEL];

  // Dedupe by (provider, modelId) before firing the calls. The rater
  // model is intentionally the same underlying model as one of the
  // collectors (Gemini 2.5 Flash), and pinging the same endpoint twice
  // in parallel can trip per-minute rate limits — we've seen the second
  // call come back "429 (no body)" while the first succeeds. One ping
  // per distinct endpoint is enough; we fan the shared result back out
  // to each slot so the UI still shows every configured row.
  const pingKey = (m: ModelEntry) => `${m.provider}::${m.modelId}`;
  const uniqueByKey = new Map<string, ModelEntry>();
  for (const m of all) {
    if (!uniqueByKey.has(pingKey(m))) uniqueByKey.set(pingKey(m), m);
  }
  const uniquePings = await Promise.all(
    Array.from(uniqueByKey.values()).map(pingOne),
  );
  const resultByKey = new Map<string, PingResult>();
  for (const p of uniquePings) {
    resultByKey.set(`${p.provider}::${p.modelId}`, p);
  }
  const results: PingResult[] = all.map((m) => {
    const shared = resultByKey.get(pingKey(m))!;
    // Keep the shared ok/latency/error, but label the row with this
    // slot's slug + display name so each configured row is visible.
    return {
      ...shared,
      modelSlug: m.slug,
      modelDisplayName: m.displayName,
    };
  });

  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = total - passed;

  // Top-level counts match the shape the admin panel expects. The nested
  // `summary` block is retained for any external scripts that use it.
  return NextResponse.json({
    ok: failed === 0,
    total,
    passed,
    failed,
    results,
    summary: {
      total,
      ok: passed,
      failed,
      bad_json: results.filter((r) => !r.validJson && r.error === "response was not valid JSON")
        .length,
    },
  });
}

// The admin panel calls this with POST; some curl scripts call it with GET.
// Accept both.
export async function POST(req: NextRequest) {
  return GET(req);
}
