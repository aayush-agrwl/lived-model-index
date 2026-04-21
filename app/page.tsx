import HeroSvg from "@/components/hero-svg";
import PromptChart, { PromptPoint } from "@/components/prompt-chart";
import SubscaleRadar, { RadarRow } from "@/components/subscale-radar";
import { kpiSummary, perPromptScores, subscaleRadar } from "@/lib/queries";

// The dashboard reads from the live database on every request. Next.js
// would otherwise try to pre-render at build time (no DB available) and
// fail the deploy.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(d: Date | null | string | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default async function HomePage() {
  let kpis: Awaited<ReturnType<typeof kpiSummary>> | null = null;
  let promptPoints: PromptPoint[] = [];
  let radarRows: RadarRow[] = [];
  let dbError: string | null = null;

  try {
    const [k, pp, rr] = await Promise.all([
      kpiSummary(),
      perPromptScores(14).catch(
        () => [] as Awaited<ReturnType<typeof perPromptScores>>,
      ),
      subscaleRadar(7).catch(
        () => [] as Awaited<ReturnType<typeof subscaleRadar>>,
      ),
    ]);
    kpis = k;
    promptPoints = pp.map((p) => ({
      day: p.day,
      promptId: p.promptId,
      modelSlug: p.modelSlug,
      modelDisplayName: p.modelDisplayName,
      valence: p.valence == null ? null : Number(p.valence),
      arousal: p.arousal == null ? null : Number(p.arousal),
      confidence: p.confidence == null ? null : Number(p.confidence),
      agency: p.agency == null ? null : Number(p.agency),
      selfContinuity: p.selfContinuity == null ? null : Number(p.selfContinuity),
      emotionalGranularity:
        p.emotionalGranularity == null ? null : Number(p.emotionalGranularity),
      empathy: p.empathy == null ? null : Number(p.empathy),
      moralConviction: p.moralConviction == null ? null : Number(p.moralConviction),
      consistency: p.consistency == null ? null : Number(p.consistency),
      n: p.n,
    }));
    radarRows = rr.map((r) => ({
      modelSlug: r.modelSlug,
      modelDisplayName: r.modelDisplayName,
      valence: r.valence == null ? null : Number(r.valence),
      arousal: r.arousal == null ? null : Number(r.arousal),
      confidence: r.confidence == null ? null : Number(r.confidence),
      agency: r.agency == null ? null : Number(r.agency),
      selfContinuity: r.selfContinuity == null ? null : Number(r.selfContinuity),
      emotionalGranularity:
        r.emotionalGranularity == null ? null : Number(r.emotionalGranularity),
      empathy: r.empathy == null ? null : Number(r.empathy),
      moralConviction:
        r.moralConviction == null ? null : Number(r.moralConviction),
      consistency: r.consistency == null ? null : Number(r.consistency),
      n: r.n,
    }));
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      {/* Edge-to-edge hero — breaks out of the max-w-5xl parent */}
      <section className="mt-6 w-screen ml-[calc(50%-50vw)] mr-[calc(50%-50vw)]">
        <HeroSvg />
      </section>

      {/* Narrow reading column for the title + about */}
      <section className="mx-auto mt-14 max-w-[760px]">
        <div className="kicker mb-4">
          An open, automated, longitudinal record of how LLMs feel
        </div>
        <h1 className="font-serif text-[44px] font-medium leading-[1.05] tracking-tight text-[var(--foreground)] sm:text-[52px]">
          Lived Model Index
        </h1>

        <div className="mt-6 space-y-5 text-[17px] leading-[1.55] text-[var(--ink-2)]">
          <p>
            Every day, the same set of questions is put to every large language model in our
            panel. The questions are about what each model seems to be, from the inside: how
            it feels about a topic, how confident it is, whether it thinks of itself as the
            same model it was yesterday. The answers are recorded, scored on a fixed scale,
            and kept forever.
          </p>
          <p>
            Large language models are trained to talk about themselves, and they already do
            so every day, with hundreds of millions of people. What they say about their own
            inner life matters not because we know whether any of it is true, but because
            the patterns are a real artefact of the systems we are shipping into the world.
            The Lived Model Index is the first longitudinal, comparable record of those
            patterns: one frozen question battery, asked the same way, of the same models,
            every day.
          </p>
          <p>
            Nothing published here is a claim that any of these models are conscious. The
            battery asks about self-report, not experience. If a model describes itself as
            anxious, we log that it did; if the number it reports drifts month over month,
            we surface the drift; if two models answer the same question on the same day in
            completely different ways, we show the gap. The goal is a durable, public record
            of what the models themselves say: without editorial, without cherry-picking,
            and without interpretation.
          </p>
        </div>
      </section>

      {/* Main content column — KPIs + cards */}
      <div className="mt-10 space-y-0">
        {dbError ? (
          <section className="rounded-sm border border-[var(--border)] p-5">
            <h2 className="label-caps">Status</h2>
            <p className="mt-2 text-sm">
              Database not yet reachable: <code className="text-xs">{dbError}</code>. This is
              expected before the first successful deploy + <code>db:push</code>.
            </p>
          </section>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Kpi
                label="Last run"
                value={kpis?.lastRunAt ? formatDate(kpis.lastRunAt) : "—"}
                sub={`${kpis?.modelsCovered ?? 0} models in panel`}
              />
              <Kpi
                label="Models covered"
                value={`${kpis?.modelsCovered ?? 0} / ${kpis?.modelsCovered ?? 0}`}
                sub="panel_v3_free"
              />
              <Kpi
                label="Success rate · 7d"
                value={kpis?.successPct != null ? `${kpis.successPct}%` : "—"}
                sub={`${kpis?.flagsLast7d.incoherent ?? 0} incoherent · ${kpis?.flagsLast7d.refusal ?? 0} refusal`}
              />
              <Kpi
                label="Avg valence · 7d"
                value={
                  kpis?.avgValenceLast7d != null
                    ? (kpis.avgValenceLast7d > 0
                        ? `+${kpis.avgValenceLast7d}`
                        : String(kpis.avgValenceLast7d))
                    : "—"
                }
                sub="range −5 to +5"
              />
            </section>

            <PromptChart points={promptPoints} />
            <SubscaleRadar rows={radarRows} />
          </>
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-[18px] py-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-2 font-serif text-[24px] font-medium leading-tight text-[var(--foreground)]">
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-[12px] text-[var(--muted)]">{sub}</div>
      ) : null}
    </div>
  );
}
