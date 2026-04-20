"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Point coming from `valenceTrend(days)`. One row per (day, model).
 */
export interface TrendPoint {
  day: string;
  modelSlug: string;
  modelDisplayName: string;
  avgValence: number | null;
  n: number;
}

/** A stable, colourblind-friendly palette. */
const COLORS = [
  "#2563eb", // blue
  "#16a34a", // green
  "#dc2626", // red
  "#f59e0b", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#be185d", // pink
];

export default function ValenceTrendChart({ points }: { points: TrendPoint[] }) {
  // Pivot: rows are days; each model becomes a column.
  const days = Array.from(new Set(points.map((p) => p.day))).sort();
  const models = Array.from(
    new Map(points.map((p) => [p.modelSlug, p.modelDisplayName])).entries(),
  );

  const rows = days.map((day) => {
    const row: Record<string, string | number | null> = { day };
    for (const [slug] of models) {
      const match = points.find((p) => p.day === day && p.modelSlug === slug);
      row[slug] = match?.avgValence ?? null;
    }
    return row;
  });

  if (rows.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-[var(--border)] text-sm text-[var(--muted)]">
        No data yet. The chart will populate after the first day of collection completes.
      </div>
    );
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="day" stroke="var(--muted)" fontSize={12} />
          <YAxis domain={[0, 100]} stroke="var(--muted)" fontSize={12} />
          <Tooltip
            contentStyle={{
              background: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          {models.map(([slug, display], i) => (
            <Line
              key={slug}
              type="monotone"
              dataKey={slug}
              name={display}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
