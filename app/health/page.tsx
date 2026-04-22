import { healthByModel, latestRunPerModel } from "@/lib/queries";
import { todayStatus } from "@/lib/orchestration";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Health · AI Mood Index",
};

function pct(num: number | null | undefined, denom: number | null | undefined) {
  if (!denom || denom === 0 || num == null) return "—";
  return `${Math.round((num / denom) * 1000) / 10}%`;
}

function formatDate(d: Date | null | string | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default async function HealthPage() {
  let rows: Awaited<ReturnType<typeof healthByModel>> = [];
  let today: Awaited<ReturnType<typeof todayStatus>> | null = null;
  let perModel: Awaited<ReturnType<typeof latestRunPerModel>> = [];
  let dbError: string | null = null;

  try {
    [rows, today, perModel] = await Promise.all([
      healthByModel(),
      todayStatus(),
      latestRunPerModel(),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-10">
      <section>
        <div className="kicker mb-2">Operational view</div>
        <h1 className="font-serif text-3xl tracking-tight">Pipeline health</h1>
        <p className="mt-3 max-w-2xl text-[var(--ink-2)]">
          Rates are over the last 30 days. Today's progress shows how much of the day's work
          remains. The collect + rate pipeline runs unattended — this page exists so anyone can
          check whether it is, in fact, running.
        </p>
      </section>

      {dbError ? (
        <div className="rounded-sm border border-[var(--border)] p-5 text-sm">
          Database not yet reachable: <code className="text-xs">{dbError}</code>.
        </div>
      ) : (
        <>
          <section>
            <header className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
              <h2 className="font-serif text-2xl tracking-tight">Today</h2>
              <span className="label-caps">UTC</span>
            </header>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Date" value={today?.date ?? "—"} />
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
            <header className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
              <h2 className="font-serif text-2xl tracking-tight">Latest run per model</h2>
              <span className="label-caps">Freshness &amp; status</span>
            </header>
            <div className="mt-4 overflow-hidden rounded-sm border border-[var(--rule)]">
              <table className="w-full text-sm">
                <thead className="bg-[color:var(--border)]/40 text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-2">Model</th>
                    <th className="px-4 py-2">Latest run</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {perModel.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-[var(--muted)]">
                        No runs yet.
                      </td>
                    </tr>
                  ) : (
                    perModel.map((row) => (
                      <tr key={row.modelSlug} className="border-t border-[var(--rule)]">
                        <td className="px-4 py-2">{row.modelDisplayName}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {formatDate(row.maxStartedAt)}
                        </td>
                        <td className="px-4 py-2">
                          <StatusPill status={row.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <header className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
              <h2 className="font-serif text-2xl tracking-tight">Per model, last 30 days</h2>
              <span className="label-caps">Throughput &amp; quality</span>
            </header>
            <div className="mt-4 overflow-hidden rounded-sm border border-[var(--rule)]">
              <table className="w-full text-sm">
                <thead className="bg-[color:var(--border)]/40 text-left text-xs uppercase tracking-wider text-[var(--muted)]">
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
                      <tr key={r.modelSlug} className="border-t border-[var(--rule)]">
                        <td className="px-4 py-2">{r.modelDisplayName}</td>
                        <td className="px-4 py-2">{r.runs}</td>
                        <td className="px-4 py-2">{r.responses}</td>
                        <td className="px-4 py-2">
                          {r.parsed}{" "}
                          <span className="text-xs text-[var(--muted)]">
                            ({pct(r.parsed, r.responses)})
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          {r.incoherent}{" "}
                          <span className="text-xs text-[var(--muted)]">
                            ({pct(r.incoherent, r.responses)})
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          {r.avgLatency != null
                            ? `${Math.round(Number(r.avgLatency))} ms`
                            : "—"}
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
    <div className="border-l-2 border-[var(--rule)] pl-3">
      <div className="label-caps">{label}</div>
      <div className="mt-1 font-mono text-lg">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string | null | undefined }) {
  const s = status ?? "unknown";
  const cls =
    s === "completed"
      ? "bg-[#3b6b4b]/12 text-[#27533a]"
      : s === "running"
        ? "bg-amber-500/15 text-amber-800"
        : s === "failed"
          ? "bg-red-500/12 text-red-700"
          : "bg-[color:var(--border)] text-[var(--muted)]";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {s}
    </span>
  );
}
