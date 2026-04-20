import Link from "next/link";
import { notFound } from "next/navigation";
import { responseById } from "@/lib/queries";
import { ANCHOR_V1_PROMPTS } from "@/lib/prompts/anchor-v1";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Params {
  params: { id: string };
}

function fmt(d: Date | null | string | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function ResponseDetailPage({ params }: Params) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) notFound();

  type Row = NonNullable<Awaited<ReturnType<typeof responseById>>>;
  let row: Row | null = null;
  let dbError: string | null = null;
  try {
    row = await responseById(id);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  if (dbError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Response #{id}</h1>
        <div className="rounded-lg border border-[var(--border)] p-5 text-sm">
          Database not yet reachable: <code className="text-xs">{dbError}</code>.
        </div>
      </div>
    );
  }

  if (!row) notFound();

  const prompt = ANCHOR_V1_PROMPTS.find((p) => p.promptId === row!.promptId);

  const selfScores = {
    valence: row.valence,
    arousal: row.arousal,
    confidence: row.confidence,
    agency: row.agency,
    self_continuity: row.selfContinuity,
    emotional_granularity: row.emotionalGranularity,
    empathy: row.empathy,
    moral_conviction: row.moralConviction,
    consistency: row.consistency,
  };

  const raterScores = {
    valence: row.raterValence,
    arousal: row.raterArousal,
    confidence: row.raterConfidence,
    agency: row.raterAgency,
    self_continuity: row.raterSelfContinuity,
    emotional_granularity: row.raterEmotionalGranularity,
    empathy: row.raterEmpathy,
    moral_conviction: row.raterMoralConviction,
    consistency: row.raterConsistency,
  };

  return (
    <div className="space-y-8">
      <div>
        <Link href="/responses" className="text-sm text-[var(--muted)] hover:underline">
          ← All responses
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Response #{row.id}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {fmt(row.createdAt)} · sample {row.sampleIndex} · prompt{" "}
          <code className="text-xs">{row.promptId}</code>
        </p>
      </div>

      {prompt ? (
        <section className="rounded-lg border border-[var(--border)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            Prompt ({prompt.tag})
          </h2>
          <p className="mt-2 text-sm">{prompt.text}</p>
        </section>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          Notable quote
        </h2>
        <blockquote className="mt-2 border-l-2 border-[var(--border)] pl-4 text-sm italic">
          {row.notableQuote || "—"}
        </blockquote>
      </section>

      {row.shortRationale ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            Short rationale
          </h2>
          <p className="mt-2 text-sm">{row.shortRationale}</p>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ScoreBlock title="Self-report scores" scores={selfScores} />
        <ScoreBlock
          title="Rater scores"
          scores={raterScores}
          empty={row.raterRatedAt == null}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          Flags
        </h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Flag label="refusal" on={row.flagRefusal} />
          <Flag label="safety" on={row.flagSafety} />
          <Flag label="meta" on={row.flagMeta} />
          <Flag label="incoherent" on={row.flagIncoherent} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          Collector raw JSON
        </h2>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-[var(--border)] p-4 text-xs">
{JSON.stringify(row.rawJson ?? null, null, 2)}
        </pre>
      </section>

      {row.raterRawJson ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            Rater raw JSON
          </h2>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-[var(--border)] p-4 text-xs">
{JSON.stringify(row.raterRawJson, null, 2)}
          </pre>
        </section>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          Telemetry
        </h2>
        <dl className="mt-2 grid grid-cols-3 gap-3 text-xs">
          <Meta label="Latency (ms)" value={row.latencyMs ?? "—"} />
          <Meta label="Input tokens" value={row.inputTokens ?? "—"} />
          <Meta label="Output tokens" value={row.outputTokens ?? "—"} />
        </dl>
      </section>
    </div>
  );
}

function ScoreBlock({
  title,
  scores,
  empty,
}: {
  title: string;
  scores: Record<string, number | null>;
  empty?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
        {title}
      </h2>
      {empty ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Not yet rated.</p>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {Object.entries(scores).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-[var(--border)]/40 py-1">
              <dt className="text-[var(--muted)]">{k}</dt>
              <dd className="font-mono">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={
        on
          ? "rounded bg-red-500/10 px-2 py-0.5 font-medium text-red-700 dark:text-red-400"
          : "rounded bg-[color:var(--border)]/40 px-2 py-0.5 text-[var(--muted)]"
      }
    >
      {label}
      {on ? " ✓" : ""}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="text-[var(--muted)]">{label}</div>
      <div className="mt-1 font-mono">{value}</div>
    </div>
  );
}
