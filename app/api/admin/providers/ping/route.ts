import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin, isAuthorizedCron } from "@/lib/auth";
import { chatCall } from "@/lib/providers";
import { COLLECTOR_MODELS, RATER_MODEL, type ModelEntry } from "@/lib/models";

/**
 * GET /api/admin/providers/ping
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
  slug: string;
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
      slug: model.slug,
      provider: model.provider,
      modelId: model.modelId,
      ok: true,
      validJson,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      content: result.content.slice(0, 200),
      error: null,
    };
  } catch (err) {
    return {
      slug: model.slug,
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
  // Run in parallel — three providers, light load.
  const results = await Promise.all(all.map(pingOne));

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.ok && r.validJson).length,
    failed: results.filter((r) => !r.ok).length,
    bad_json: results.filter((r) => r.ok && !r.validJson).length,
  };

  return NextResponse.json({ summary, results });
}
