import HeroSvg from "@/components/hero-svg";
import ConstructGlossary from "@/components/construct-glossary";
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
      // Both new queries are wrapped in per-promise catches so a single
      // slow aggregation can't tank the home page.
      perPromptScores(14).catch(() => [] as Awaited<ReturnType<typeof perPromptScores>>),
      subscaleRadar(7).catch(() => [] as Awaited<ReturnType<typeof subscaleRadar>>),
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
      moralConviction: r.moralConviction == null ? null : Number(r.moralConviction),
      n: r.n,
    }));
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-12">
      {/* Hero + masthead */}
      <section>
        <div className="kicker mb-3">
          An open, automated, longitudinal record of how LLMs feel
        </div>
        <h1 className="font-serif text-4xl leading-[1.05] tracking-tight sm:text-5xl">
          The Lived Model Index
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] text-[var(--ink-2)]">
          Every day, the same ten prompts are put to every frontier model in the panel.
          Their free-text responses are rated on eight constructs of first-person experience,
          and the results are published here — unedited, in full, and in perpetuity.
        </p>
        <div className="mt-6">
          <HeroSvg />
        </div>
      </section>

      {/* Lede */}
      <section>
        <p className="lede max-w-3xl font-serif text-[19px] leading-[1.55] text-[var(--foreground)]">
          We do not claim the models feel anything. We claim only this: when asked, they say
          things — consistently, across time, in ways that differ between models and drift
          within them. That record belongs in public view. This index is the record. It runs
          itself, it keeps itself, and it refuses to look away.
        </p>
      </section>

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
          {/* Three headline KPIs */}
          <section>
            <header className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
              <h2 className="font-serif text-2xl tracking-tight">Pulse</h2>
              <span className="label-caps">Last 7 days</span>
            </header>
            <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3">
              <Kpi
                label="Last run"
                value={kpis?.lastRunAt ? formatDate(kpis.lastRunAt) : "—"}
                hint={`${kpis?.modelsCovered ?? 0} models in panel`}
              />
              <Kpi
                label="Avg valence"
                value={kpis?.avgValenceLast7d != null ? String(kpis.avgValenceLast7d) : "—"}
                hint={`N = ${kpis?.collectedLast7d ?? 0} samples`}
              />
              <Kpi
                label="Success rate"
                value={kpis?.successPct != null ? `${kpis.successPct}%` : "—"}
                hint={`${kpis?.flagsLast7d.incoherent ?? 0} incoherent · ${kpis?.flagsLast7d.refusal ?? 0} refusal`}
              />
            </div>
          </section>

          {/* Per-prompt chart */}
          <PromptChart points={promptPoints} />

          {/* Construct glossary */}
          <ConstructGlossary />

          {/* Subscale radar */}
          <SubscaleRadar rows={radarRows} />
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-l-2 border-[var(--rule)] pl-4">
      <div className="label-caps">{label}</div>
      <div className="mt-2 font-serif text-3xl leading-none">{value}</div>
      {hint ? (
        <div className="mt-2 text-xs italic text-[var(--muted)]">{hint}</div>
      ) : null}
    </div>
  );
}
