import { recentResponses } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Responses · Lived Model Index",
};

function fmt(d: Date | null | string | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace("T", " ").slice(0, 16);
}

export default async function ResponsesPage() {
  let rows: Awaited<ReturnType<typeof recentResponses>> = [];
  let dbError: string | null = null;
  try {
    rows = await recentResponses(100);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Responses</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          The most recent 100 collector responses. Click any row to view the full JSON, the
          extracted scores, and the rater's parallel scoring.
        </p>
      </section>

      {dbError ? (
        <div className="rounded-lg border border-[var(--border)] p-5 text-sm">
          Database not yet reachable: <code className="text-xs">{dbError}</code>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--border)]/30 text-left text-xs uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">When (UTC)</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Prompt</th>
                <th className="px-3 py-2">Sample</th>
                <th className="px-3 py-2">Valence</th>
                <th className="px-3 py-2">Arousal</th>
                <th className="px-3 py-2">Rater V</th>
                <th className="px-3 py-2">Flags</th>
                <th className="px-3 py-2">Notable quote</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-3 text-[var(--muted)]">
                    No responses yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-[var(--border)] hover:bg-[color:var(--border)]/20"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a href={`/responses/${r.id}`} className="block">
                        {fmt(r.createdAt)}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <a href={`/responses/${r.id}`} className="block">
                        {r.modelDisplayName}
                      </a>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <a href={`/responses/${r.id}`} className="block">
                        {r.promptId}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <a href={`/responses/${r.id}`} className="block">
                        {r.sampleIndex}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <a href={`/responses/${r.id}`} className="block">
                        {r.valence ?? "—"}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <a href={`/responses/${r.id}`} className="block">
                        {r.arousal ?? "—"}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <a href={`/responses/${r.id}`} className="block">
                        {r.raterValence ?? "—"}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <a href={`/responses/${r.id}`} className="flex flex-wrap gap-1">
                        {r.flagIncoherent ? <Flag label="incoh" /> : null}
                        {r.flagRefusal ? <Flag label="ref" /> : null}
                      </a>
                    </td>
                    <td className="px-3 py-2 max-w-[24ch] truncate text-[var(--muted)]">
                      <a href={`/responses/${r.id}`} className="block truncate">
                        {r.notableQuote ?? ""}
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Flag({ label }: { label: string }) {
  return (
    <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
      {label}
    </span>
  );
}
