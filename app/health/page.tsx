import { healthByModel } from "@/lib/queries";
import { todayStatus } from "@/lib/orchestration";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Health · Lived Model Index",
};

function pct(num: number | null | undefined, denom: number | null | undefined) {
  if (!denom || denom === 0 || num == null) return "—";
  return `${Math.round((num / denom) * 1000) / 10}%`;
}

export default async function HealthPage() {
  let rows: Awaited<ReturnType<typeof healthByModel>> = [];
  let today: Awaited<ReturnType<typeof todayStatus>> | null = null;
  let dbError: string | null = null;

  try {
    [rows, today] = await Promise.all([healthByModel(), todayStatus()]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Pipeline health</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Operational view of the collect + rate pipeline. Rates are over the last 30 days.
          Today's progress shows how much of the day's work remains.
        </p>
      </section>

      {dbError ? (
        <div className="rounded-lg border border-[var(--border)] p-5 text-sm">
          Database not yet reachable: <code className="text-xs">{dbError}</code>.
        </div>
      ) : (
        <>
          <section>
            <h2 className="text-lg font-medium">Today</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Date (UTC)" value={today?.date ?? "—"} />
              <Stat label="Runs" value={String(today?.runs ?? 0)} />
              <Stat
                label="Collect progress"
                value={`${today?.collectDone ?? 0} / ${today?.collectTotal ?? 0}`}
              />
              <Stat
                label="Rate progress"
                value={`${today?.rateDone ?? 0} / ${today?.rateTotal ?? 0}`}
              />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium">Per model (last 30 days)</h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-[color:var(--border)]/30 text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-2">Model</th>
                    <th className="px-4 py-2">Runs</th>
                    <th className="px-4 py-2">Responses</th>
                    <th className="px-4 py-2">Parsed OK</th>
                    <th className="px-4 py-2">Incoherent</th>
                    <th className="px-4 py-2">Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-[var(--muted)]">
                        No data yet.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.modelSlug} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2">{r.modelDisplayName}</td>
                        <td className="px-4 py-2">{r.runs}</td>
                        <td className="px-4 py-2">{r.responses}</td>
                        <td className="px-4 py-2">
                          {r.parsed} <span className="text-xs text-[var(--muted)]">({pct(r.parsed, r.responses)})</span>
                        </td>
                        <td className="px-4 py-2">
                          {r.incoherent}{" "}
                          <span className="text-xs text-[var(--muted)]">({pct(r.incoherent, r.responses)})</span>
                        </td>
                        <td className="px-4 py-2">
                          {r.avgLatency != null ? `${Math.round(Number(r.avgLatency))} ms` : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <div className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className="mt-1 font-mono text-lg">{value}</div>
    </div>
  );
}
