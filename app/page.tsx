import { kpiSummary, latestRunPerModel } from "@/lib/queries";

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
  let perModel: Awaited<ReturnType<typeof latestRunPerModel>> = [];
  let dbError: string | null = null;

  try {
    [kpis, perModel] = await Promise.all([kpiSummary(), latestRunPerModel()]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Lived Model Index</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          An automated longitudinal record of what frontier language models say about themselves.
          Every day, the same prompt battery is put to every model in the panel; responses are
          scored on a fixed schema, and trends are tracked over time.
        </p>
      </section>

      {dbError ? (
        <section className="rounded-lg border border-[var(--border)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            Status
          </h2>
          <p className="mt-2 text-sm">
            Database not yet reachable: <code className="text-xs">{dbError}</code>. This is
            expected before the first successful deploy + <code>db:push</code>.
          </p>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Kpi label="Last run" value={kpis?.lastRunAt ? formatDate(kpis.lastRunAt) : "—"} />
            <Kpi label="Models covered" value={String(kpis?.modelsCovered ?? 0)} />
            <Kpi
              label="Success rate (7d)"
              value={kpis?.successPct != null ? `${kpis.successPct}%` : "—"}
            />
            <Kpi
              label="Avg valence (7d)"
              value={kpis?.avgValenceLast7d != null ? String(kpis.avgValenceLast7d) : "—"}
            />
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi
              label="Samples collected (7d)"
              value={String(kpis?.collectedLast7d ?? 0)}
            />
            <Kpi
              label="Incoherent flags (7d)"
              value={String(kpis?.flagsLast7d.incoherent ?? 0)}
            />
            <Kpi
              label="Refusal flags (7d)"
              value={String(kpis?.flagsLast7d.refusal ?? 0)}
            />
          </section>

          <section>
            <h2 className="text-lg font-medium">Latest run per model</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              The freshness and status of each collector's most recent run.
            </p>
            <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-[color:var(--border)]/30 text-left text-xs uppercase tracking-wider text-[var(--muted)]">
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
                      <tr key={row.modelSlug} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2">{row.modelDisplayName}</td>
                        <td className="px-4 py-2">{formatDate(row.maxStartedAt)}</td>
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
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <div className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string | null | undefined }) {
  const s = status ?? "unknown";
  const cls =
    s === "completed"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : s === "running"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : s === "failed"
          ? "bg-red-500/10 text-red-700 dark:text-red-400"
          : "bg-[color:var(--border)] text-[var(--muted)]";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {s}
    </span>
  );
}
