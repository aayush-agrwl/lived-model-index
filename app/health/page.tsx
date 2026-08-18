import {
  healthByPanelAndModel,
  latestRunPerModel,
  totalRunDays,
} from "@/lib/queries";
import { MODEL_PANEL_VERSION } from "@/lib/models";
import { todayStatus } from "@/lib/orchestration";

// Operational page: cache for 30 seconds. The collect/rate progress
// figures shown on this page can lag the live state by up to half a
// minute, which is well within the operator's tolerance for "is the
// pipeline actually running" — and the cache absorbs the connection
// churn that comes with anyone refreshing the page during an active
// tick window.
export const revalidate = 30;

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
  let rows: Awaited<ReturnType<typeof healthByPanelAndModel>> = [];
  let today: Awaited<ReturnType<typeof todayStatus>> | null = null;
  let perModel: Awaited<ReturnType<typeof latestRunPerModel>> = [];
  let runDays = 0;
  let dbError: string | null = null;

  try {
    [rows, today, perModel, runDays] = await Promise.all([
      healthByPanelAndModel(),
      todayStatus(),
      latestRunPerModel(),
      totalRunDays(),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  // Group the flat rows into one block per panel version, current first.
  // The query already orders by panel descending, so insertion order into
  // the Map preserves that — no second sort needed, and no assumption that
  // version strings sort the way we want beyond the desc the DB applied.
  const panelMap = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = panelMap.get(row.panelVersion);
    if (list) list.push(row);
    else panelMap.set(row.panelVersion, [row]);
  }
  const panels = Array.from(panelMap, ([panelVersion, panelRows]) => ({
    panelVersion,
    rows: panelRows,
  })).sort((a, b) => {
    // Current panel pinned to the top regardless of string ordering; the
    // operator is nearly always here to check what is running now.
    if (a.panelVersion === MODEL_PANEL_VERSION) return -1;
    if (b.panelVersion === MODEL_PANEL_VERSION) return 1;
    return b.panelVersion.localeCompare(a.panelVersion);
  });

  return (
    <div className="space-y-10">
      <section>
        <div className="kicker mb-2">Operational view</div>
        <h1 className="font-serif text-3xl tracking-tight">Pipeline health</h1>
        <p className="mt-3 max-w-2xl text-[var(--ink-2)]">
          Per-model rates are broken out by panel version and cover each panel's full
          lifetime. Panels are separate instruments — they run different model slots under
          different extraction rules — so pooling them would average two regimes into one
          misleading number. Today's progress shows how much of the day's work remains. The
          collect + rate pipeline runs unattended; this page exists so anyone can check
          whether it is, in fact, running.
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
              <Stat label="Days of data collected" value={String(runDays)} />
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

          {/*
            The current panel has no rows until its first run completes.
            Say so explicitly — an operator who has just deployed a new
            panel and finds no section for it cannot tell "not collected
            yet" from "the page is broken".
          */}
          {!panels.some((p) => p.panelVersion === MODEL_PANEL_VERSION) ? (
            <section>
              <header className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
                <h2 className="font-serif text-2xl tracking-tight">
                  {MODEL_PANEL_VERSION}{" "}
                  <span className="ml-1 rounded bg-amber-500/15 px-2 py-0.5 align-middle text-xs font-medium text-amber-800">
                    awaiting first run
                  </span>
                </h2>
                <span className="label-caps">Deployed, not yet collected</span>
              </header>
              <p className="mt-3 max-w-2xl text-sm text-[var(--ink-2)]">
                This panel is live in the code but has not produced a run yet. It appears here
                once the next daily bootstrap creates its runs; until then the tables below
                describe retired panels only.
              </p>
            </section>
          ) : null}

          {panels.map(({ panelVersion, rows: panelRows }) => {
            const isCurrent = panelVersion === MODEL_PANEL_VERSION;
            // Panels before v5 had no per-turn score contract, so
            // flag_partial_envelope is structurally false on every one of
            // their rows. Without saying so, an older panel appears to
            // have a perfect "Partial" score when in fact the failure it
            // measures was simply invisible then — the opposite of the
            // truth, since that is the era where the coherent-but-empty
            // rows went uncounted.
            const hasContract = panelVersion >= "panel_v5";
            const totals = panelRows.reduce(
              (a, r) => ({
                responses: a.responses + r.responses,
                dataRows: a.dataRows + r.dataRows,
                analysable: a.analysable + r.analysable,
              }),
              { responses: 0, dataRows: 0, analysable: 0 },
            );
            const span = panelRows.reduce<{ first: Date | null; last: Date | null }>(
              (a, r) => ({
                first:
                  !a.first || new Date(r.firstRun) < a.first ? new Date(r.firstRun) : a.first,
                last: !a.last || new Date(r.lastRun) > a.last ? new Date(r.lastRun) : a.last,
              }),
              { first: null, last: null },
            );
            /**
             * Days between a slot's last analysable row and the last time
             * the panel ran at all.
             *
             * Needed because these tables span a panel's whole lifetime,
             * where a slot that died halfway still shows thousands of data
             * rows. Counting rows alone, DeepSeek V3.1 reads as healthy on
             * 535 data rows — while having produced nothing since
             * 2026-05-24 against a panel that ran to 2026-08-18. Freshness
             * relative to the panel, not row count, is what distinguishes
             * a working slot from a dead one, and missing that distinction
             * for 86 days is the whole reason this page was rewritten.
             */
            const darkDays = (r: (typeof panelRows)[number]): number | null => {
              if (!span.last || !r.lastAnalysableAt) return null;
              const gapMs =
                new Date(span.last).getTime() - new Date(r.lastAnalysableAt).getTime();
              return Math.floor(gapMs / 86_400_000);
            };
            // Two days of slack absorbs a slot that merely missed the most
            // recent tick or lost a day to a provider's daily quota.
            const DARK_THRESHOLD_DAYS = 2;
            return (
              <section key={panelVersion}>
                <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--rule)] pb-2">
                  <h2 className="font-serif text-2xl tracking-tight">
                    {panelVersion}{" "}
                    {isCurrent ? (
                      <span className="ml-1 rounded bg-[#3b6b4b]/12 px-2 py-0.5 align-middle text-xs font-medium text-[#27533a]">
                        current
                      </span>
                    ) : (
                      <span className="ml-1 rounded bg-[color:var(--border)] px-2 py-0.5 align-middle text-xs font-medium text-[var(--muted)]">
                        retired
                      </span>
                    )}
                  </h2>
                  <span className="label-caps">
                    {panelRows.length} slots · {formatDate(span.first).slice(0, 10)} →{" "}
                    {formatDate(span.last).slice(0, 10)} · {totals.analysable}/{totals.responses}{" "}
                    analysable
                  </span>
                </header>
                {!hasContract ? (
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    This panel predates the per-turn score contract, so “Partial” is
                    structurally zero here — well-formed envelopes with null scores were
                    counted as successes rather than flagged. Its “Analysable” column is
                    therefore the honest number, and its historical “Parsed OK” was not.
                  </p>
                ) : null}
                <div className="mt-4 overflow-x-auto rounded-sm border border-[var(--rule)]">
                  <table className="w-full min-w-[52rem] text-sm">
                    <thead className="bg-[color:var(--border)]/40 text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                      <tr>
                        <th className="px-4 py-2">Model</th>
                        <th className="px-4 py-2">Runs</th>
                        <th className="px-4 py-2">Rows</th>
                        <th className="px-4 py-2">Data</th>
                        <th className="px-4 py-2">Analysable</th>
                        <th className="px-4 py-2">Partial</th>
                        <th className="px-4 py-2">Incoherent</th>
                        <th className="px-4 py-2">Avg latency</th>
                        <th className="px-4 py-2">Last data</th>
                        <th className="px-4 py-2">Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {panelRows.map((r) => (
                        <tr
                          key={`${panelVersion}-${r.modelSlug}`}
                          className="border-t border-[var(--rule)]"
                        >
                          <td className="px-4 py-2">{r.modelDisplayName}</td>
                          <td className="px-4 py-2">{r.runs}</td>
                          <td className="px-4 py-2">{r.responses}</td>
                          <td className="px-4 py-2">
                            {r.dataRows}{" "}
                            <span className="text-xs text-[var(--muted)]">
                              ({pct(r.dataRows, r.responses)})
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            {r.analysable}{" "}
                            <span className="text-xs text-[var(--muted)]">
                              ({pct(r.analysable, r.responses)})
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            {hasContract ? (
                              <>
                                {r.partialEnvelope}{" "}
                                <span className="text-xs text-[var(--muted)]">
                                  ({pct(r.partialEnvelope, r.responses)})
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-[var(--muted)]">n/a</span>
                            )}
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
                          <td className="px-4 py-2 text-xs text-[var(--muted)]">
                            {r.lastAnalysableAt
                              ? formatDate(r.lastAnalysableAt).slice(0, 10)
                              : "never"}
                          </td>
                          <td className="px-4 py-2">
                            {r.dataRows === 0 || r.lastAnalysableAt == null ? (
                              // Pre-v5 runs were all graded "completed", so
                              // a dead slot shows zero failed runs. Never
                              // let that read as healthy.
                              <span className="inline-block rounded bg-red-500/12 px-2 py-0.5 text-xs font-medium text-red-700">
                                no data
                              </span>
                            ) : (darkDays(r) ?? 0) > DARK_THRESHOLD_DAYS ? (
                              <span className="inline-block rounded bg-red-500/12 px-2 py-0.5 text-xs font-medium text-red-700">
                                dark {darkDays(r)}d
                              </span>
                            ) : r.failedRuns > 0 ? (
                              <span className="inline-block rounded bg-red-500/12 px-2 py-0.5 text-xs font-medium text-red-700">
                                {r.failedRuns} failed
                              </span>
                            ) : r.degradedRuns > 0 ? (
                              <span className="inline-block rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800">
                                {r.degradedRuns} degraded
                              </span>
                            ) : (
                              <span className="text-xs text-[var(--muted)]">ok</span>
                            )}
                            {r.lastFailureKind ? (
                              <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                                {r.lastFailureKind}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
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
          : // Panel v5: a run that produced some usable data but fell
            // below the analysable floor. Amber, not red — the slot is
            // alive but thin, which is a different action than "dead".
            s === "degraded"
            ? "bg-orange-500/15 text-orange-800"
            : "bg-[color:var(--border)] text-[var(--muted)]";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {s}
    </span>
  );
}
