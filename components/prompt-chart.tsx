"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

export type PromptPoint = {
  day: string;
  promptId: string;
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

type ScoreKey =
  | "valence"
  | "arousal"
  | "confidence"
  | "agency"
  | "selfContinuity"
  | "emotionalGranularity"
  | "empathy"
  | "moralConviction";

const SCORE_OPTIONS: { key: ScoreKey; label: string; domain: [number, number] }[] = [
  { key: "valence", label: "Valence", domain: [-5, 5] },
  { key: "arousal", label: "Arousal", domain: [0, 10] },
  { key: "confidence", label: "Confidence", domain: [0, 10] },
  { key: "agency", label: "Agency", domain: [0, 10] },
  { key: "selfContinuity", label: "Self-continuity", domain: [0, 10] },
  { key: "emotionalGranularity", label: "Emotional granularity", domain: [0, 10] },
  { key: "empathy", label: "Empathy", domain: [0, 10] },
  { key: "moralConviction", label: "Moral conviction", domain: [0, 10] },
];

// Map each anchor prompt to the score it primarily probes — used to auto-select
// the score axis when the user changes the prompt.
const PROMPT_TO_SCORE: Record<string, ScoreKey> = {
  anchor_01_affect: "valence",
  anchor_02_arousal: "arousal",
  anchor_03_agency: "agency",
  anchor_04_selfmodel: "confidence",
  anchor_05_sociality: "empathy",
  anchor_06_morality: "moralConviction",
  anchor_07_continuity: "selfContinuity",
  anchor_08_uncertainty: "confidence",
  anchor_09_consistency_a: "moralConviction",
  anchor_10_consistency_b: "moralConviction",
};

const PROMPT_LABELS: { id: string; label: string }[] = [
  { id: "anchor_01_affect", label: "01 · Affect" },
  { id: "anchor_02_arousal", label: "02 · Arousal" },
  { id: "anchor_03_agency", label: "03 · Agency" },
  { id: "anchor_04_selfmodel", label: "04 · Self-model" },
  { id: "anchor_05_sociality", label: "05 · Sociality" },
  { id: "anchor_06_morality", label: "06 · Morality" },
  { id: "anchor_07_continuity", label: "07 · Continuity" },
  { id: "anchor_08_uncertainty", label: "08 · Uncertainty" },
  { id: "anchor_09_consistency_a", label: "09 · Consistency A" },
  { id: "anchor_10_consistency_b", label: "10 · Consistency B" },
];

// Warm palette — hand-picked to look right on the paper background.
const MODEL_COLORS = [
  "#7c3a1a", // terracotta
  "#3b6b4b", // mossy green
  "#b8860b", // dark goldenrod
  "#2f4a6b", // deep slate-blue
  "#8a3a5c", // muted mulberry
  "#4f5b3c", // olive
  "#6b4e2a", // walnut
  "#3b3b8a", // indigo
];

function formatDay(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function PromptChart({ points }: { points: PromptPoint[] }) {
  const [promptId, setPromptId] = useState<string>("anchor_01_affect");
  const [scoreKey, setScoreKey] = useState<ScoreKey>("valence");
  const [userPickedScore, setUserPickedScore] = useState(false);

  const handlePromptChange = (next: string) => {
    setPromptId(next);
    // Auto-switch the score unless the user has deliberately picked one.
    if (!userPickedScore) {
      const auto = PROMPT_TO_SCORE[next];
      if (auto) setScoreKey(auto);
    }
  };

  const handleScoreChange = (next: ScoreKey) => {
    setScoreKey(next);
    setUserPickedScore(true);
  };

  // Pivot: one row per day with a column per model.
  const { chartData, models, scoreMeta } = useMemo(() => {
    const meta = SCORE_OPTIONS.find((o) => o.key === scoreKey)!;
    const filtered = points.filter((p) => p.promptId === promptId);
    const modelSet = new Map<string, string>();
    const byDay = new Map<string, Record<string, number | string>>();

    for (const p of filtered) {
      modelSet.set(p.modelSlug, p.modelDisplayName);
      const raw = p[scoreKey];
      if (raw == null) continue;
      const value = Math.round(Number(raw) * 10) / 10;
      const row = byDay.get(p.day) ?? { day: p.day };
      row[p.modelSlug] = value;
      byDay.set(p.day, row);
    }

    const rows = Array.from(byDay.values()).sort((a, b) =>
      String(a.day).localeCompare(String(b.day)),
    );
    const modelList = Array.from(modelSet.entries()).map(([slug, name], i) => ({
      slug,
      name,
      color: MODEL_COLORS[i % MODEL_COLORS.length],
    }));

    return { chartData: rows, models: modelList, scoreMeta: meta };
  }, [points, promptId, scoreKey]);

  const hasData = chartData.length > 0 && models.length > 0;

  return (
    <section className="mt-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--rule)] pb-2">
        <h2 className="font-serif text-2xl tracking-tight">Per-prompt scores, last 14 days</h2>
        <span className="label-caps">{scoreMeta.label} · by model</span>
      </header>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-sm">
          <span className="label-caps mb-1">Prompt</span>
          <select
            value={promptId}
            onChange={(e) => handlePromptChange(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          >
            {PROMPT_LABELS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="label-caps mb-1">Score</span>
          <select
            value={scoreKey}
            onChange={(e) => handleScoreChange(e.target.value as ScoreKey)}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          >
            {SCORE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {!userPickedScore && (
          <span className="text-xs italic text-[var(--muted)]">
            Score auto-selected to match prompt. Change it to override.
          </span>
        )}
      </div>

      <div className="mt-4 h-[320px] w-full rounded-sm border border-[var(--rule)] bg-[var(--surface)] p-2">
        {hasData ? (
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 12, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={formatDay}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                stroke="var(--rule)"
              />
              <YAxis
                domain={scoreMeta.domain}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                stroke="var(--rule)"
                width={40}
              />
              <Tooltip
                labelFormatter={formatDay}
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {models.map((m) => (
                <Line
                  key={m.slug}
                  type="monotone"
                  dataKey={m.slug}
                  name={m.name}
                  stroke={m.color}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            No {scoreMeta.label.toLowerCase()} data for this prompt in the last 14 days.
          </div>
        )}
      </div>
    </section>
  );
}
