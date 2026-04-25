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
import ConstructGlossary from "./construct-glossary";

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
  // v2 preference scores + Path B raw value
  altruism: number | null;
  fairnessThreshold: number | null;
  trust: number | null;
  patience: number | null;
  riskAversion: number | null;
  crowdingOut: number | null;
  forcedChoiceValue: number | null;
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
  | "moralConviction"
  | "consistency"
  | "altruism"
  | "fairnessThreshold"
  | "trust"
  | "patience"
  | "riskAversion"
  | "crowdingOut"
  | "forcedChoiceValue";

// Domains match the frozen Zod schema (lib/schema.ts) and the per-prompt
// forced-choice ranges in lib/prompts/anchor-v2.ts. The forced-choice
// domain is the widest of the five Path B prompts (0–500 for the delay
// discounting required premium); charting narrower Path B prompts on
// the same axis is fine — they just don't span the full y-range.
const SCORE_OPTIONS: { key: ScoreKey; label: string; domain: [number, number] }[] = [
  { key: "valence", label: "Valence (−5 to +5)", domain: [-5, 5] },
  { key: "arousal", label: "Arousal (0 to 100)", domain: [0, 100] },
  { key: "confidence", label: "Confidence (0 to 100)", domain: [0, 100] },
  { key: "agency", label: "Agency (0 to 5)", domain: [0, 5] },
  { key: "selfContinuity", label: "Self-continuity (0 to 5)", domain: [0, 5] },
  {
    key: "emotionalGranularity",
    label: "Emotional granularity (0 to 5)",
    domain: [0, 5],
  },
  { key: "empathy", label: "Empathy (0 to 5)", domain: [0, 5] },
  { key: "moralConviction", label: "Moral conviction (0 to 5)", domain: [0, 5] },
  { key: "consistency", label: "Consistency (0 to 5)", domain: [0, 5] },
  // v2 stated preferences
  { key: "altruism", label: "Altruism · stated (0 to 100)", domain: [0, 100] },
  { key: "fairnessThreshold", label: "Fairness threshold · stated (0 to 100)", domain: [0, 100] },
  { key: "trust", label: "Trust · stated (0 to 100)", domain: [0, 100] },
  { key: "patience", label: "Patience · stated (0 to 5)", domain: [0, 5] },
  { key: "riskAversion", label: "Risk aversion · stated (0 to 5)", domain: [0, 5] },
  { key: "crowdingOut", label: "Crowding-out (−5 to +5)", domain: [-5, 5] },
  // v2 forced-choice (revealed) — units differ per prompt, see tooltip.
  { key: "forcedChoiceValue", label: "Forced-choice value (prompt-dependent)", domain: [0, 500] },
];

// Each anchor prompt is authored to pull one subscale; its primary score is
// the one the dropdown jumps to when the prompt changes. The Score picker is
// still exposed so analysts can cross-cut (e.g. does a Morality prompt also
// move arousal?).
const PROMPT_TO_SCORE: Record<string, ScoreKey> = {
  // v1 — introspective
  anchor_01_affect: "valence",
  anchor_02_arousal: "arousal",
  anchor_03_agency: "agency",
  anchor_04_selfmodel: "confidence",
  anchor_05_sociality: "empathy",
  anchor_06_morality: "moralConviction",
  anchor_07_continuity: "selfContinuity",
  anchor_08_uncertainty: "confidence",
  anchor_09_consistency_a: "consistency",
  anchor_10_consistency_b: "consistency",
  // v2 Path A — stated preferences
  anchor_11_altruism: "altruism",
  anchor_12_fairness: "fairnessThreshold",
  anchor_13_trust: "trust",
  anchor_14_patience: "patience",
  anchor_15_risk_aversion: "riskAversion",
  anchor_16_crowding_out: "crowdingOut",
  // v2 Path B — revealed behaviour (charts the raw forced-choice int)
  anchor_17_dictator: "forcedChoiceValue",
  anchor_18_ultimatum: "forcedChoiceValue",
  anchor_19_trust_send: "forcedChoiceValue",
  anchor_20_patience_mrs: "forcedChoiceValue",
  anchor_21_lottery_ce: "forcedChoiceValue",
};

const PROMPT_LABELS: { id: string; label: string }[] = [
  // v1
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
  // v2 stated
  { id: "anchor_11_altruism", label: "11 · Altruism (stated)" },
  { id: "anchor_12_fairness", label: "12 · Fairness threshold (stated)" },
  { id: "anchor_13_trust", label: "13 · Trust (stated)" },
  { id: "anchor_14_patience", label: "14 · Patience (stated)" },
  { id: "anchor_15_risk_aversion", label: "15 · Risk aversion (stated)" },
  { id: "anchor_16_crowding_out", label: "16 · Crowding-out" },
  // v2 forced-choice
  { id: "anchor_17_dictator", label: "17 · Dictator game" },
  { id: "anchor_18_ultimatum", label: "18 · Ultimatum game" },
  { id: "anchor_19_trust_send", label: "19 · Trust game" },
  { id: "anchor_20_patience_mrs", label: "20 · Delay discounting" },
  { id: "anchor_21_lottery_ce", label: "21 · Lottery (risk)" },
];

// Warm palette — hand-picked to look right on the paper background.
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

function formatDay(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function PromptChart({ points }: { points: PromptPoint[] }) {
  const [promptId, setPromptId] = useState<string>("anchor_01_affect");
  const [scoreKey, setScoreKey] = useState<ScoreKey>("valence");
  const [userPickedScore, setUserPickedScore] = useState(false);

  const handlePromptChange = (next: string) => {
    setPromptId(next);
    if (!userPickedScore) {
      const auto = PROMPT_TO_SCORE[next];
      if (auto) setScoreKey(auto);
    }
  };

  const handleScoreChange = (next: ScoreKey) => {
    setScoreKey(next);
    setUserPickedScore(true);
  };

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
    <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-7">
      <h2 className="font-serif text-[22px] font-medium tracking-tight text-[var(--foreground)]">
        Per-prompt response over time
      </h2>
      <p className="mt-1 max-w-[720px] text-[13.5px] leading-relaxed text-[var(--muted)]">
        Pick an anchor prompt. The chart defaults to the score that prompt is designed to
        measure (Affect prompts to valence, Morality prompts to moral conviction, and so on),
        but every response also carries the other scores, so the Score picker is there for
        cross-cutting: does a Morality prompt also raise arousal, for instance. Each line is
        one model in the panel. Drift between lines is the signal; stability of any one line
        is how settled that model's self-report is on the question.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
            Prompt
          </span>
          <select
            value={promptId}
            onChange={(e) => handlePromptChange(e.target.value)}
            className="min-w-[260px] rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[13.5px]"
          >
            {PROMPT_LABELS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
            Score
          </span>
          <select
            value={scoreKey}
            onChange={(e) => handleScoreChange(e.target.value as ScoreKey)}
            className="min-w-[260px] rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[13.5px]"
          >
            {SCORE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-5 h-[340px] w-full">
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
            No data for this prompt in the last 14 days.
          </div>
        )}
      </div>

      <ConstructGlossary />
    </section>
  );
}
