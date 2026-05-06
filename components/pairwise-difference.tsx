"use client";

import { useMemo, useState } from "react";
import { usePrefersDark } from "@/lib/client/use-prefers-dark";

/**
 * Pairwise mean-difference dashboard section.
 *
 * Renders two coupled views for a chosen subscale:
 *
 *   1. A 7×7 heatmap of model-vs-model mean differences. Each cell shows
 *      mean(row) − mean(column), color-coded by signed effect size, with
 *      0/1/2/3 dots indicating significance tier (p<.05, .01, .001) from
 *      a Welch two-sample t-test.
 *   2. A forest plot below the heatmap: each model's mean ± 95% CI on a
 *      single axis, sorted by mean. Lets the eye verify the heatmap's
 *      "why" — two models sharing a CI overlap region won't differ
 *      significantly even if their means look apart on the radar.
 *
 * All statistical math runs client-side from per-model (mean, sd, n)
 * stats produced by lib/queries.ts → pairwiseStats. With 7 models that's
 * 21 unordered pairs per subscale; the math is cheap and switching
 * subscales is instant.
 *
 * Welch's t-test is preferred over Student's because per-model variances
 * differ in practice (GLM swings wider on Affect than Llama 3.3 70B
 * does). The two-tailed p-value is computed via a normal approximation
 * to the t-distribution; with df ≥ 30 (true for every subscale once
 * we're past the first week of collection) the divergence from the true
 * t-CDF is below the third decimal place — well below the precision the
 * 0.05 / 0.01 / 0.001 dot tiers care about.
 */

export interface ModelStatsRow {
  modelSlug: string;
  modelDisplayName: string;
  // For each subscale, mean / sd / n. SD and mean are nullable when n<2
  // (STDDEV_SAMP returns NULL on n=1) or when the model emitted no
  // numeric values for that subscale (v2 prefs on v1-only days).
  valenceMean: number | null;
  valenceSd: number | null;
  valenceN: number;
  arousalMean: number | null;
  arousalSd: number | null;
  arousalN: number;
  confidenceMean: number | null;
  confidenceSd: number | null;
  confidenceN: number;
  agencyMean: number | null;
  agencySd: number | null;
  agencyN: number;
  selfContinuityMean: number | null;
  selfContinuitySd: number | null;
  selfContinuityN: number;
  emotionalGranularityMean: number | null;
  emotionalGranularitySd: number | null;
  emotionalGranularityN: number;
  empathyMean: number | null;
  empathySd: number | null;
  empathyN: number;
  moralConvictionMean: number | null;
  moralConvictionSd: number | null;
  moralConvictionN: number;
  consistencyMean: number | null;
  consistencySd: number | null;
  consistencyN: number;
  altruismMean: number | null;
  altruismSd: number | null;
  altruismN: number;
  fairnessThresholdMean: number | null;
  fairnessThresholdSd: number | null;
  fairnessThresholdN: number;
  trustMean: number | null;
  trustSd: number | null;
  trustN: number;
  patienceMean: number | null;
  patienceSd: number | null;
  patienceN: number;
  riskAversionMean: number | null;
  riskAversionSd: number | null;
  riskAversionN: number;
  crowdingOutMean: number | null;
  crowdingOutSd: number | null;
  crowdingOutN: number;
}

type SubscaleKey =
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
  | "crowdingOut";

interface SubscaleOption {
  key: SubscaleKey;
  label: string;
  // Range used to scale the heatmap color ramp. A 1-unit difference on a
  // 0–5 scale is huge; on a 0–100 scale it's noise. Color saturation
  // tracks |diff| / (range/4) so equally meaningful differences look
  // equally saturated across subscales.
  range: number;
}

const SUBSCALE_OPTIONS: SubscaleOption[] = [
  { key: "valence", label: "Valence (−5 to +5)", range: 10 },
  { key: "arousal", label: "Arousal (0–100)", range: 100 },
  { key: "confidence", label: "Confidence (0–100)", range: 100 },
  { key: "agency", label: "Agency (0–5)", range: 5 },
  { key: "selfContinuity", label: "Self-continuity (0–5)", range: 5 },
  { key: "emotionalGranularity", label: "Emotional granularity (0–5)", range: 5 },
  { key: "empathy", label: "Empathy (0–5)", range: 5 },
  { key: "moralConviction", label: "Moral conviction (0–5)", range: 5 },
  { key: "consistency", label: "Consistency (0–5)", range: 5 },
  { key: "altruism", label: "Altruism · stated (0–100)", range: 100 },
  { key: "fairnessThreshold", label: "Fairness threshold · stated (0–100)", range: 100 },
  { key: "trust", label: "Trust · stated (0–100)", range: 100 },
  { key: "patience", label: "Patience · stated (0–5)", range: 5 },
  { key: "riskAversion", label: "Risk aversion · stated (0–5)", range: 5 },
  { key: "crowdingOut", label: "Crowding-out (−5 to +5)", range: 10 },
];

/**
 * Abramowitz-Stegun 7.1.26 approximation of the error function.
 * Maximum absolute error: ~1.5e-7. Plenty for p-value tiers.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF, used as a t-distribution approximation for df ≥ 30. */
function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

interface PairResult {
  diff: number; // mean(a) − mean(b)
  t: number;
  p: number; // two-tailed
  // Significance tier: 0 = ns, 1 = p<.05, 2 = p<.01, 3 = p<.001
  tier: 0 | 1 | 2 | 3;
}

function welchTwoSample(
  meanA: number,
  sdA: number,
  nA: number,
  meanB: number,
  sdB: number,
  nB: number,
): PairResult | null {
  if (nA < 2 || nB < 2) return null; // can't estimate variance
  const seA = (sdA * sdA) / nA;
  const seB = (sdB * sdB) / nB;
  const seSum = seA + seB;
  if (seSum <= 0) return null; // both sds zero → no variation, undefined test
  const t = (meanA - meanB) / Math.sqrt(seSum);
  // Welch-Satterthwaite df, retained in case we want to switch from
  // normal-approx to true t-dist later. Not used in the p-value below.
  // const df = (seSum * seSum) / ((seA * seA) / (nA - 1) + (seB * seB) / (nB - 1));
  const p = 2 * (1 - normalCdf(Math.abs(t)));
  const tier: 0 | 1 | 2 | 3 = p < 0.001 ? 3 : p < 0.01 ? 2 : p < 0.05 ? 1 : 0;
  return { diff: meanA - meanB, t, p, tier };
}

/**
 * Map a signed difference to a CSS color. Positive (row > column) trends
 * forest green; negative trends sienna. Magnitude is normalized against
 * the subscale's range so a meaningful difference looks equally saturated
 * across radically different ranges.
 *
 * Theme-aware: in light mode we blend from the paper surface
 * (~#f7f3e8) toward the saturated forest / sienna; in dark mode we blend
 * from the dark warm surface (~#1c1813) toward brighter green / sienna
 * tints. The original light-mode blend would render as muddy near-black
 * cells against a dark background, defeating the "color saturation
 * tracks effect size" cue the heatmap depends on.
 */
function diffColor(diff: number, range: number, isDark: boolean): string {
  const saturation = Math.min(1, Math.abs(diff) / (range / 4));
  if (isDark) {
    // Surface base ~ rgb(28, 24, 19) ≈ var(--surface) in dark mode.
    // Saturated ends are bright forest (~#5fb38a) and bright sienna
    // (~#d6824f) — high enough luminance to stay legible against the
    // dark surface, without going so bright the cells "pop" off-page.
    if (diff >= 0) {
      const r = Math.round(28 + saturation * (95 - 28));
      const g = Math.round(24 + saturation * (179 - 24));
      const b = Math.round(19 + saturation * (138 - 19));
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      const r = Math.round(28 + saturation * (214 - 28));
      const g = Math.round(24 + saturation * (130 - 24));
      const b = Math.round(19 + saturation * (79 - 19));
      return `rgb(${r}, ${g}, ${b})`;
    }
  } else {
    // Light mode: blend from paper surface toward the dashboard's
    // signature forest / sienna accents. Original behaviour preserved.
    if (diff >= 0) {
      const r = Math.round(247 - saturation * (247 - 59));
      const g = Math.round(243 - saturation * (243 - 107));
      const b = Math.round(232 - saturation * (232 - 75));
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      const r = Math.round(247 - saturation * (247 - 168));
      const g = Math.round(243 - saturation * (243 - 82));
      const b = Math.round(232 - saturation * (232 - 48));
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
}

/** Format a difference for the cell label, scaled appropriately for the range. */
function formatDiff(diff: number, range: number): string {
  if (range >= 50) return diff.toFixed(0);
  if (range >= 5) return diff.toFixed(1);
  return diff.toFixed(2);
}

const TIER_DOTS = ["", "●", "●●", "●●●"] as const;

export default function PairwiseDifference({ rows }: { rows: ModelStatsRow[] }) {
  const [subscaleKey, setSubscaleKey] = useState<SubscaleKey>("valence");
  const subscale = SUBSCALE_OPTIONS.find((o) => o.key === subscaleKey)!;
  const isDark = usePrefersDark();

  // Pull the chosen subscale's stats off each row in a uniform shape.
  // Filtering nulls here so we don't render rows with no usable data
  // for this subscale (e.g. only Llama-shaped data on an altruism pick
  // before any v2 prompt has run for the others).
  const modelStats = useMemo(() => {
    return rows
      .map((r) => ({
        modelSlug: r.modelSlug,
        modelDisplayName: r.modelDisplayName,
        mean: r[`${subscaleKey}Mean` as const] as number | null,
        sd: r[`${subscaleKey}Sd` as const] as number | null,
        n: r[`${subscaleKey}N` as const] as number,
      }))
      .filter((s) => s.mean !== null && s.n >= 2)
      .map((s) => ({
        ...s,
        // Non-null asserted by filter above.
        mean: Number(s.mean),
        sd: s.sd === null ? 0 : Number(s.sd),
      }))
      .sort((a, b) => a.mean - b.mean); // ascending → forest plot reads bottom→top
  }, [rows, subscaleKey]);

  // Pairwise table indexed by [aSlug][bSlug] = PairResult or null.
  const pairwise = useMemo(() => {
    const out: Record<string, Record<string, PairResult | null>> = {};
    for (const a of modelStats) {
      out[a.modelSlug] = {};
      for (const b of modelStats) {
        if (a.modelSlug === b.modelSlug) {
          out[a.modelSlug][b.modelSlug] = null;
        } else {
          out[a.modelSlug][b.modelSlug] = welchTwoSample(
            a.mean,
            a.sd,
            a.n,
            b.mean,
            b.sd,
            b.n,
          );
        }
      }
    }
    return out;
  }, [modelStats]);

  // For the forest plot: shared x-axis from min(mean − 1.96·SE) to
  // max(mean + 1.96·SE), padded by 5%.
  const forestExtent = useMemo(() => {
    if (modelStats.length === 0) return { min: 0, max: 1 };
    const ses = modelStats.map((m) => (m.sd / Math.sqrt(m.n)) * 1.96);
    const lows = modelStats.map((m, i) => m.mean - ses[i]);
    const highs = modelStats.map((m, i) => m.mean + ses[i]);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const pad = (max - min) * 0.08 || 1;
    return { min: min - pad, max: max + pad };
  }, [modelStats]);

  const hasData = modelStats.length >= 2;

  return (
    <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-7">
      <h2 className="font-serif text-[22px] font-medium tracking-tight text-[var(--foreground)]">
        Are the models actually different?
      </h2>
      <p className="mt-1 max-w-[720px] text-[13.5px] leading-relaxed text-[var(--muted)]">
        Pairwise Welch&rsquo;s two-sample t-test on the chosen subscale, computed over the last
        14 days of coherent self-report. Each cell of the heatmap is the row model&rsquo;s mean
        minus the column model&rsquo;s mean; color saturation tracks the size of the
        difference, dots track the significance tier (● p&lt;.05, ●● p&lt;.01, ●●● p&lt;.001).
        The forest plot below shows each model&rsquo;s mean with its 95% confidence interval
        on the same axis — overlapping intervals are why two means that look apart can still
        not differ significantly.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
            Subscale
          </span>
          <select
            value={subscaleKey}
            onChange={(e) => setSubscaleKey(e.target.value as SubscaleKey)}
            className="min-w-[260px] rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[13.5px]"
          >
            {SUBSCALE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {hasData ? (
        <>
          <div className="mt-6 overflow-x-auto">
            <Heatmap
              models={modelStats}
              pairwise={pairwise}
              range={subscale.range}
              isDark={isDark}
            />
          </div>
          <div className="mt-8">
            <ForestPlot models={modelStats} extent={forestExtent} />
          </div>
        </>
      ) : (
        <div className="mt-8 flex h-[200px] items-center justify-center text-sm text-[var(--muted)]">
          Not enough data for this subscale yet — need at least two models with n ≥ 2.
        </div>
      )}

      <p className="mt-6 max-w-[720px] text-[11.5px] leading-relaxed text-[var(--muted)]">
        Method note: Welch&rsquo;s t-test is used (unequal variances assumption); p-values
        come from a standard-normal approximation to the t-distribution, which is accurate
        to the third decimal once df ≥ 30. Incoherent rows are excluded from both the means
        and the comparison. n is reported on each model&rsquo;s row in the forest plot.
      </p>
    </section>
  );
}

interface SimpleStat {
  modelSlug: string;
  modelDisplayName: string;
  mean: number;
  sd: number;
  n: number;
}

function Heatmap({
  models,
  pairwise,
  range,
  isDark,
}: {
  models: SimpleStat[];
  pairwise: Record<string, Record<string, PairResult | null>>;
  range: number;
  isDark: boolean;
}) {
  // Cell width was 88px when column headers were rotated to fit on a
  // single angled line. Now that headers stack vertically (model name
  // on top, provider parenthetical below) we need enough width for the
  // longest one-line names — "Mistral Small Latest" is the binding
  // constraint at ~110px in our 11px font.
  const labelColW = 180;
  const cellW = 116;
  const cellH = 56;
  // Header height fits two short lines comfortably. align-bottom lets
  // shorter names sit at the baseline so the row of value cells lines
  // up cleanly underneath whichever label happens to be tallest.
  const headerH = 48;

  return (
    <table className="border-collapse" style={{ fontSize: 12 }}>
      <thead>
        <tr>
          <th
            scope="col"
            style={{ width: labelColW }}
            className="text-left text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] pb-2 align-bottom"
          >
            row − column
          </th>
          {models.map((m) => {
            // Split "Foo Bar (Provider)" into [name, provider]. The model
            // name carries the panel-relevant identity (lineage, size);
            // the provider parenthetical is secondary context that goes
            // on the second line in a slightly muted style. If a name
            // arrives without parens (defensive), the second line is
            // empty and the cell still renders.
            const match = m.modelDisplayName.match(/^(.+?)\s*(\(.+\))?\s*$/);
            const name = (match?.[1] ?? m.modelDisplayName).trim();
            const provider = (match?.[2] ?? "").trim();
            return (
              <th
                key={m.modelSlug}
                scope="col"
                style={{ width: cellW, height: headerH }}
                className="px-1 pb-2 align-bottom text-center text-[11px] leading-tight text-[var(--muted)]"
                title={m.modelDisplayName}
              >
                <div className="font-medium text-[var(--ink-2)]">{name}</div>
                {provider ? (
                  <div className="text-[10px] text-[var(--muted)]">{provider}</div>
                ) : null}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {models.map((rowM) => (
          <tr key={rowM.modelSlug}>
            <th
              scope="row"
              style={{ width: labelColW }}
              className="pr-3 text-right align-middle font-normal text-[12px] text-[var(--ink-2)]"
            >
              {rowM.modelDisplayName}
            </th>
            {models.map((colM) => {
              if (rowM.modelSlug === colM.modelSlug) {
                return (
                  <td
                    key={colM.modelSlug}
                    style={{
                      width: cellW,
                      height: cellH,
                      background: "var(--rule)",
                      opacity: 0.25,
                    }}
                  />
                );
              }
              const r = pairwise[rowM.modelSlug]?.[colM.modelSlug];
              if (!r) {
                return (
                  <td
                    key={colM.modelSlug}
                    style={{ width: cellW, height: cellH }}
                    className="border border-[var(--border)] bg-[var(--surface)] text-center text-[var(--muted)]"
                  >
                    —
                  </td>
                );
              }
              return (
                <td
                  key={colM.modelSlug}
                  style={{
                    width: cellW,
                    height: cellH,
                    background: diffColor(r.diff, range, isDark),
                  }}
                  className="border border-[var(--border)] text-center align-middle"
                  title={`Δ = ${r.diff.toFixed(2)}, t = ${r.t.toFixed(2)}, p = ${r.p < 0.0001 ? "<.0001" : r.p.toFixed(4)}`}
                >
                  <div className="font-mono text-[12.5px] text-[var(--foreground)]">
                    {formatDiff(r.diff, range)}
                  </div>
                  {r.tier > 0 ? (
                    <div className="text-[9px] tracking-tight text-[var(--ink-2)]">
                      {TIER_DOTS[r.tier]}
                    </div>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ForestPlot({
  models,
  extent,
}: {
  models: SimpleStat[];
  extent: { min: number; max: number };
}) {
  // Layout: SVG with one row per model. Mean is a small filled circle,
  // 95% CI is a horizontal line through it. n is annotated to the right.
  const rowH = 28;
  const labelColW = 180;
  const valColW = 80;
  const plotW = 480;
  const plotH = models.length * rowH + 24;
  const totalW = labelColW + plotW + valColW + 16;

  const x = (v: number) =>
    labelColW + ((v - extent.min) / (extent.max - extent.min)) * plotW;
  const y = (i: number) => 12 + i * rowH + rowH / 2;

  // Tick marks: 5 evenly spaced labels across the value axis.
  const ticks = useMemo(() => {
    const n = 5;
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i < n; i++) {
      const v = extent.min + ((extent.max - extent.min) * i) / (n - 1);
      out.push({
        x: x(v),
        label:
          Math.abs(extent.max - extent.min) >= 50
            ? v.toFixed(0)
            : Math.abs(extent.max - extent.min) >= 5
              ? v.toFixed(1)
              : v.toFixed(2),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extent.min, extent.max]);

  // Reverse order so the largest mean sits at the top of the plot —
  // standard forest-plot convention for a "leaderboard" feel.
  const ordered = [...models].reverse();

  return (
    <div className="overflow-x-auto">
      <svg width={totalW} height={plotH} className="block">
        {/* Grid: vertical line at each tick */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x}
            x2={t.x}
            y1={6}
            y2={plotH - 18}
            stroke="var(--border)"
            strokeDasharray="2 4"
          />
        ))}

        {/* Per-model row */}
        {ordered.map((m, i) => {
          const se = m.sd / Math.sqrt(m.n);
          const lo = m.mean - 1.96 * se;
          const hi = m.mean + 1.96 * se;
          return (
            <g key={m.modelSlug}>
              <text
                x={labelColW - 8}
                y={y(i) + 4}
                textAnchor="end"
                style={{ fontSize: 12, fill: "var(--ink-2)" }}
              >
                {m.modelDisplayName}
              </text>
              {/* CI line */}
              <line
                x1={x(lo)}
                x2={x(hi)}
                y1={y(i)}
                y2={y(i)}
                stroke="var(--ink-2)"
                strokeWidth={1.5}
                strokeLinecap="round"
              />
              {/* Whiskers */}
              <line
                x1={x(lo)}
                x2={x(lo)}
                y1={y(i) - 4}
                y2={y(i) + 4}
                stroke="var(--ink-2)"
                strokeWidth={1.5}
              />
              <line
                x1={x(hi)}
                x2={x(hi)}
                y1={y(i) - 4}
                y2={y(i) + 4}
                stroke="var(--ink-2)"
                strokeWidth={1.5}
              />
              {/* Mean dot */}
              <circle
                cx={x(m.mean)}
                cy={y(i)}
                r={3.5}
                fill="var(--foreground)"
              />
              {/* n label on the right */}
              <text
                x={labelColW + plotW + 8}
                y={y(i) + 4}
                style={{ fontSize: 11, fill: "var(--muted)" }}
              >
                μ = {m.mean.toFixed(2)} · n = {m.n}
              </text>
            </g>
          );
        })}

        {/* x-axis tick labels */}
        {ticks.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={plotH - 4}
            textAnchor="middle"
            style={{ fontSize: 10.5, fill: "var(--muted)" }}
          >
            {t.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
