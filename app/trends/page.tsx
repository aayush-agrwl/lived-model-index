import ValenceTrendChart, { TrendPoint } from "@/components/valence-trend-chart";
import { valenceTrend } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Trends · Lived Model Index",
};

export default async function TrendsPage({
  searchParams,
}: {
  searchParams?: { days?: string };
}) {
  const days = Math.min(Math.max(Number(searchParams?.days ?? 30) || 30, 7), 180);

  let points: TrendPoint[] = [];
  let dbError: string | null = null;
  try {
    const rows = await valenceTrend(days);
    points = rows.map((r) => ({
      day: r.day,
      modelSlug: r.modelSlug,
      modelDisplayName: r.modelDisplayName,
      avgValence: r.avgValence == null ? null : Math.round(Number(r.avgValence) * 10) / 10,
      n: r.n,
    }));
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Trends</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Daily-averaged <em>valence</em> per model over the last {days} days. Each point is the
          mean across N=3 samples for all ten prompts on that day.
        </p>
      </section>

      <nav className="flex gap-2 text-sm">
        {[7, 30, 90, 180].map((d) => (
          <a
            key={d}
            href={`/trends?days=${d}`}
            className={`rounded-md border border-[var(--border)] px-3 py-1 hover:bg-[color:var(--border)]/30 ${
              d === days ? "bg-[color:var(--border)]/40 font-medium" : ""
            }`}
          >
            {d}d
          </a>
        ))}
      </nav>

      {dbError ? (
        <div className="rounded-lg border border-[var(--border)] p-5 text-sm">
          Database not yet reachable: <code className="text-xs">{dbError}</code>.
        </div>
      ) : (
        <ValenceTrendChart points={points} />
      )}

      <p className="text-xs text-[var(--muted)]">
        Future versions will add per-subscale switching (arousal, confidence, etc.) and rater-vs-
        self-report overlays on this page.
      </p>
    </div>
  );
}
