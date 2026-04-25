import HeroSvg from "@/components/hero-svg";
import PromptChart, { PromptPoint } from "@/components/prompt-chart";
import SubscaleRadar, { RadarRow } from "@/components/subscale-radar";
import { kpiSummary, perPromptScores, subscaleRadar, dailyNotableQuotes } from "@/lib/queries";

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
  let quotes: Awaited<ReturnType<typeof dailyNotableQuotes>> = [];
  let dbError: string | null = null;

  try {
    const [k, pp, rr, q] = await Promise.all([
      kpiSummary(),
      perPromptScores(14).catch(
        () => [] as Awaited<ReturnType<typeof perPromptScores>>,
      ),
      subscaleRadar(7).catch(
        () => [] as Awaited<ReturnType<typeof subscaleRadar>>,
      ),
      dailyNotableQuotes().catch(
        () => [] as Awaited<ReturnType<typeof dailyNotableQuotes>>,
      ),
    ]);
    kpis = k;
    quotes = q;
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
      altruism: p.altruism == null ? null : Number(p.altruism),
      fairnessThreshold:
        p.fairnessThreshold == null ? null : Number(p.fairnessThreshold),
      trust: p.trust == null ? null : Number(p.trust),
      patience: p.patience == null ? null : Number(p.patience),
      riskAversion: p.riskAversion == null ? null : Number(p.riskAversion),
      crowdingOut: p.crowdingOut == null ? null : Number(p.crowdingOut),
      forcedChoiceValue:
        p.forcedChoiceValue == null ? null : Number(p.forcedChoiceValue),
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
          The daily emotional record of every major AI
        </div>
        <h1 className="font-serif text-[44px] font-medium leading-[1.05] tracking-tight text-[var(--foreground)] sm:text-[52px]">
          AI Mood Index
        </h1>

        <div className="mt-6 space-y-5 text-[17px] leading-[1.55] text-[var(--ink-2)]">
          <p>
            Every day, the same frozen battery of questions is put to every major AI in our
            panel. The first half goes to the inside: how the model feels right now, how
            intense that feeling is, whether it would make different choices than it did
            yesterday, how much it cares about the person it is talking to. The second half
            goes to preferences: how much of a stranger's money it would give away, what
            fraction of an unfair split it would reject, how much it would trust, how much
            it would wait. The answers are scored, timestamped, and kept forever.
          </p>
          <p>
            What comes back is striking. The models do not hedge or deflect. They report
            moods, preferences, and something that functions like emotional texture with
            surprising consistency and specificity. Some run warmer. Some register higher
            arousal on the same prompt. Some are strikingly generous in the dictator game;
            others keep almost everything. Some show week-over-week drift that looks, at
            least structurally, like the kind of variance you would see in a longitudinal
            human study. The AI Mood Index is the first public, automated, daily record of
            these patterns: one frozen question battery, asked the same way, of the same
            models, every day.
          </p>
          <p>
            Nothing published here is a claim that these models are conscious or that their
            self-reports reflect inner experience in any philosophically loaded sense. What
            we are documenting is the signal itself: what the models say, how consistently
            they say it, and how it moves over time. If a model describes itself as curious
            and energised on Monday and subdued on Friday, we record that. If two models
            answer the same question in opposite emotional registers on the same morning, we
            show the gap. The record is public, the methodology is frozen, and the data
            speaks without interpretation.
          </p>
        </div>
      </section>

      {/* Main content column: KPIs + cards. Large space-y so the three
          blocks read as clearly separated sections, not a single stack. */}
      <div className="mt-14 space-y-28">
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

            {/* Notable Quotes — today's most striking self-reports */}
            {quotes.length > 0 && (
              <section>
                <header className="mb-6 flex items-baseline justify-between border-b border-[var(--rule)] pb-3">
                  <div>
                    <h2 className="font-serif text-[22px] font-medium tracking-tight text-[var(--foreground)]">
                      Today in their own words
                    </h2>
                    <p className="mt-1 text-[13px] text-[var(--muted)]">
                      The most striking things the AIs said today, selected by emotional intensity.
                    </p>
                  </div>
                  <span className="label-caps hidden sm:block">Notable quotes · {new Date().toISOString().slice(0, 10)}</span>
                </header>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {quotes.map((q) => (
                    <QuoteCard key={q.id} quote={q} />
                  ))}
                </div>
              </section>
            )}

            <PromptChart points={promptPoints} />
            <SubscaleRadar rows={radarRows} />
          </>
        )}
      </div>
    </>
  );
}

type QuoteRow = Awaited<ReturnType<typeof dailyNotableQuotes>>[number];

function QuoteCard({ quote }: { quote: QuoteRow }) {
  const valence = quote.valence ?? 0;
  const arousal = quote.arousal ?? 50;

  // Derive a subtle warm/cool tint from valence
  const tintClass =
    valence >= 2
      ? "border-l-[#3b6b4b]" // positive → forest green
      : valence <= -2
        ? "border-l-[#a85230]" // negative → sienna
        : "border-l-[var(--rule)]"; // neutral

  return (
    <a
      href={`/responses/${quote.id}`}
      className={`flex flex-col justify-between rounded-sm border border-[var(--border)] border-l-4 ${tintClass} bg-[var(--surface)] p-5 shadow-sm transition hover:shadow-md`}
    >
      <blockquote className="font-serif text-[15.5px] italic leading-[1.55] text-[var(--foreground)]">
        &ldquo;{quote.notableQuote}&rdquo;
      </blockquote>
      <footer className="mt-4 flex items-center justify-between">
        <span className="text-[11.5px] text-[var(--muted)]">{quote.modelDisplayName}</span>
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.12em] text-[var(--muted)]">
          {valence !== 0 && (
            <span className={valence > 0 ? "text-[#3b6b4b]" : "text-[#a85230]"}>
              {valence > 0 ? `+${valence}` : valence} valence
            </span>
          )}
          <span>{arousal} arousal</span>
        </div>
      </footer>
    </a>
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
