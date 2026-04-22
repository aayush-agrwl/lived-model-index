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
  consistency: number | null;
  n: number;
};

// Each subscale maps to one raw score column with its own natural range. To
// plot them on one radar we normalize every value into 0..1, then render as
// 0..100 (percent of scale) so the axis labels stay intuitive.
const AXES: {
  axis: string;
  key: Exclude<keyof RadarRow, "modelSlug" | "modelDisplayName" | "n">;
  min: number;
  max: number;
}[] = [
  { axis: "Affect", key: "valence", min: -5, max: 5 },
  { axis: "Arousal", key: "arousal", min: 0, max: 100 },
  { axis: "Agency", key: "agency", min: 0, max: 5 },
  { axis: "Self-model", key: "confidence", min: 0, max: 100 },
  { axis: "Sociality", key: "empathy", min: 0, max: 5 },
  { axis: "Morality", key: "moralConviction", min: 0, max: 5 },
  { axis: "Continuity", key: "selfContinuity", min: 0, max: 5 },
  { axis: "Consistency", key: "consistency", min: 0, max: 5 },
];

const MODEL_COLORS = [
  "#1f5f7a", // deep teal
  "#a85230", // burnt sienna
  "#3b6b4b", // forest
  "#6a3a5a", // plum
  "#a67a1e", // mustard
  "#4f5b3c", // olive
  "#6b4e2a", // walnut
  "#3b3b8a", // indigo
];

function normalize(raw: number | null, min: number, max: number) {
  if (raw == null) return null;
  const pct = ((Number(raw) - min) / (max - min)) * 100;
  if (Number.isNaN(pct)) return null;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
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
      const row: Record<string, number | string | null> = { axis: ax.axis };
      for (const m of colored) {
        if (!active.has(m.modelSlug)) continue;
        row[m.modelSlug] = normalize(m[ax.key] as number | null, ax.min, ax.max);
      }
      return row;
    });
    return { data: chart, colored };
  }, [rows, active]);

  const hasData = rows.length > 0;

  return (
    <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-7">
      <h2 className="font-serif text-[22px] font-medium tracking-tight text-[var(--foreground)]">
        Subscale radar · latest 7-day window
      </h2>
      <p className="mt-1 max-w-[720px] text-[13.5px] leading-relaxed text-[var(--muted)]">
        Each axis is one of the eight LMI subscales. Each polygon is the last seven days of
        averaged self-report from one model, rescaled onto a common 0–100% axis so subscales
        with different native ranges (valence is −5…+5, arousal 0…100, most others 0…5) can
        be compared on one chart. Toggle models on and off to compare.
      </p>

      {hasData && (
        <div className="mt-4 flex flex-wrap gap-2">
          {colored.map((m) => {
            const on = active.has(m.modelSlug);
            return (
              <button
                key={m.modelSlug}
                type="button"
                onClick={() => toggle(m.modelSlug)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition ${
                  on
                    ? "border-[var(--ink-2)] bg-[var(--surface)] text-[var(--foreground)]"
                    : "border-[var(--border)] text-[var(--muted)] line-through opacity-50"
                }`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: m.color }}
                />
                {m.modelDisplayName}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-5 h-[440px] w-full">
        {hasData ? (
          <ResponsiveContainer>
            <RadarChart data={data} outerRadius="72%">
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis
                dataKey="axis"
                tick={{ fontSize: 12, fill: "var(--ink-2)" }}
              />
              <PolarRadiusAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                stroke="var(--border)"
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                formatter={(value: number | string) =>
                  typeof value === "number" ? `${value}%` : value
                }
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
                    fillOpacity={0.14}
                    strokeWidth={2}
                  />
                ))}
            </RadarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            No subscale data yet. Averages populate as daily runs complete.
          </div>
        )}
      </div>
    </section>
  );
}
