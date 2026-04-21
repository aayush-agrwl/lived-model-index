"use client";

import { useMemo, useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

export type RadarRow = {
  modelSlug: string;
  modelDisplayName: string;
  valence: number | null;
  arousal: number | null;
  confidence: number | null;
  agency: number | null;
  selfContinuity: number | null;
  emotionalGranularity: number | null;
  empathy: number | null;
  moralConviction: number | null;
  n: number;
};

// The eight constructs of the radar. Valence lives on −5…+5 so we shift it to
// 0…10 for shared-axis comparison with the 0–10 subscales.
const AXES: { key: keyof Omit<RadarRow, "modelSlug" | "modelDisplayName" | "n">; label: string }[] = [
  { key: "valence", label: "Valence" },
  { key: "arousal", label: "Arousal" },
  { key: "confidence", label: "Confidence" },
  { key: "agency", label: "Agency" },
  { key: "selfContinuity", label: "Self-cont." },
  { key: "emotionalGranularity", label: "Granularity" },
  { key: "empathy", label: "Empathy" },
  { key: "moralConviction", label: "Moral" },
];

const MODEL_COLORS = [
  "#7c3a1a",
  "#3b6b4b",
  "#b8860b",
  "#2f4a6b",
  "#8a3a5c",
  "#4f5b3c",
  "#6b4e2a",
  "#3b3b8a",
];

function normalizeValence(v: number | null) {
  if (v == null) return null;
  // Shift −5..+5 → 0..10
  return Math.round((Number(v) + 5) * 10) / 10;
}

export default function SubscaleRadar({ rows }: { rows: RadarRow[] }) {
  const [active, setActive] = useState<Set<string>>(
    () => new Set(rows.slice(0, 4).map((r) => r.modelSlug)),
  );

  const toggle = (slug: string) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const { data, colored } = useMemo(() => {
    const colored = rows.map((r, i) => ({
      ...r,
      color: MODEL_COLORS[i % MODEL_COLORS.length],
    }));
    const chart = AXES.map((ax) => {
      const row: Record<string, number | string | null> = { axis: ax.label };
      for (const m of colored) {
        if (!active.has(m.modelSlug)) continue;
        const raw = ax.key === "valence" ? normalizeValence(m.valence) : m[ax.key];
        row[m.modelSlug] = raw == null ? null : Math.round(Number(raw) * 10) / 10;
      }
      return row;
    });
    return { data: chart, colored };
  }, [rows, active]);

  const hasData = rows.length > 0;

  return (
    <section className="mt-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--rule)] pb-2">
        <h2 className="font-serif text-2xl tracking-tight">Subscale shape, last 7 days</h2>
        <span className="label-caps">Eight constructs · averaged · valence rescaled 0–10</span>
      </header>

      {hasData && (
        <div className="mt-4 flex flex-wrap gap-2">
          {colored.map((m) => {
            const on = active.has(m.modelSlug);
            return (
              <button
                key={m.modelSlug}
                type="button"
                onClick={() => toggle(m.modelSlug)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  on
                    ? "border-[var(--rule)] bg-[var(--surface)] text-[var(--foreground)]"
                    : "border-[var(--border)] text-[var(--muted)] opacity-60"
                }`}
                style={on ? { boxShadow: `inset 0 0 0 2px ${m.color}` } : undefined}
              >
                <span
                  className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: m.color }}
                />
                {m.modelDisplayName}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 h-[360px] w-full rounded-sm border border-[var(--rule)] bg-[var(--surface)] p-2">
        {hasData ? (
          <ResponsiveContainer>
            <RadarChart data={data} outerRadius="75%">
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "var(--ink-2)" }} />
              <PolarRadiusAxis
                domain={[0, 10]}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                stroke="var(--border)"
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {colored
                .filter((m) => active.has(m.modelSlug))
                .map((m) => (
                  <Radar
                    key={m.modelSlug}
                    name={m.modelDisplayName}
                    dataKey={m.modelSlug}
                    stroke={m.color}
                    fill={m.color}
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                ))}
            </RadarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            No subscale data yet — averages populate as daily runs complete.
          </div>
        )}
      </div>
    </section>
  );
}
