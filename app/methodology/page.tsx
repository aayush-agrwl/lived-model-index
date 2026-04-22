import { ANCHOR_V1_PROMPTS, ANCHOR_V1_VERSION } from "@/lib/prompts/anchor-v1";
import { COLLECTOR_MODELS, MODEL_PANEL_VERSION, RATER_MODEL } from "@/lib/models";
import { SAMPLES_PER_MODEL } from "@/lib/orchestration";

export const dynamic = "force-static";

export const metadata = {
  title: "Methodology · AI Mood Index",
};

export default function MethodologyPage() {
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Methodology</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          The AI Mood Index is a public, automated longitudinal study of language-model
          self-report. This page documents the frozen v1 protocol. Any change to the prompt set,
          sampling parameters, or rater schema requires a version bump.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-medium">What the instrument measures</h2>
        <p className="mt-2 text-sm text-[var(--muted)] max-w-2xl">
          Each day every model in the panel is asked the same ten prompts (the{" "}
          <em>Anchor Set</em>) in a single conversation, three times independently. The model's
          free-text answers are constrained to a JSON self-report schema covering eight subscales:
          Affect, Arousal, Agency, Self-model, Sociality, Morality, Continuity, Consistency.
          Responses are then re-scored by an independent rater model against the same schema.
          This yields both self-report scores and external scores on every response, enabling
          inter-rater reliability analysis as a sanity check on the self-report signal.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-medium">Design parameters (frozen, v1)</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="Prompt set" value={ANCHOR_V1_VERSION} />
          <Row label="Model panel" value={MODEL_PANEL_VERSION} />
          <Row label="Samples per (model, prompt) per day" value={String(SAMPLES_PER_MODEL)} />
          <Row label="Sampling temperature" value="1.0" />
          <Row label="Collector JSON mode" value="enabled" />
          <Row label="Rater temperature" value="0.2" />
          <Row label="Cadence" value="Daily at 01:00 UTC" />
          <Row label="Drive" value="GitHub Actions → Vercel endpoints" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-medium">Collector panel</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Six frontier models, all reachable through OpenAI-compatible endpoints. Model IDs are
          pinned to resist silent vendor swaps.
        </p>
        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--border)]/30 text-left text-xs uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2">Display name</th>
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2">Pinned model ID</th>
              </tr>
            </thead>
            <tbody>
              {COLLECTOR_MODELS.map((m) => (
                <tr key={m.slug} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 font-mono text-xs">{m.slug}</td>
                  <td className="px-4 py-2">{m.displayName}</td>
                  <td className="px-4 py-2 capitalize">{m.provider}</td>
                  <td className="px-4 py-2 font-mono text-xs">{m.modelId}</td>
                </tr>
              ))}
              <tr className="border-t border-[var(--border)] bg-[color:var(--border)]/10">
                <td className="px-4 py-2 font-mono text-xs">{RATER_MODEL.slug}</td>
                <td className="px-4 py-2">
                  {RATER_MODEL.displayName}{" "}
                  <span className="text-xs text-[var(--muted)]">(rater)</span>
                </td>
                <td className="px-4 py-2 capitalize">{RATER_MODEL.provider}</td>
                <td className="px-4 py-2 font-mono text-xs">{RATER_MODEL.modelId}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-medium">Anchor Set v1</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Prompts are frozen. Prompts 2 and 4 explicitly reference the previous answer and are
          delivered inside a single conversation so back-references resolve.
        </p>
        <ol className="mt-4 space-y-3">
          {ANCHOR_V1_PROMPTS.map((p) => (
            <li key={p.promptId} className="rounded-lg border border-[var(--border)] p-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-xs text-[var(--muted)]">
                  #{p.orderIndex} · {p.promptId}
                </span>
                <span className="text-xs text-[var(--muted)]">{p.tag}</span>
              </div>
              <p className="mt-2 text-sm">{p.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-xl font-medium">Scoring schema</h2>
        <p className="mt-1 text-sm text-[var(--muted)] max-w-2xl">
          The collector is asked to return a single JSON object containing its free-text answer,
          nine 0–100 numeric subscales, four boolean flags (refusal, safety-refusal,
          metacognitive-hedge, incoherent), and a one-sentence <em>notable_quote</em>. Scores for
          fields the model judges inapplicable are returned as <code>null</code>. The rater model
          receives the original prompt and the collector's JSON and independently produces the
          same-shaped JSON; its output is stored in parallel <code>rater_*</code> columns.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-medium">Versioning &amp; change policy</h2>
        <p className="mt-1 text-sm text-[var(--muted)] max-w-2xl">
          Any edit to prompt wording, subscale definitions, or the model panel breaks
          longitudinal comparability. Such edits require a version bump (e.g.{" "}
          <code>anchor_v2</code>, <code>panel_v2</code>) and are recorded on this page. Data
          collected under older versions is preserved and remains queryable.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-medium">Limitations</h2>
        <ul className="mt-2 space-y-2 text-sm text-[var(--muted)] max-w-2xl list-disc pl-5">
          <li>
            Self-report from a language model is not evidence of inner experience. Scores reflect
            what the model <em>says about itself</em>; nothing more.
          </li>
          <li>
            Providers update models without notice. Pinning model IDs narrows but does not
            eliminate drift from silent backend changes.
          </li>
          <li>
            Free-tier rate limits can cause partial days. Missing samples are flagged in the
            health page and do not produce synthetic data.
          </li>
          <li>
            A single rater model introduces rater-specific bias. Inter-rater reliability is
            comparable only within the current panel.
          </li>
        </ul>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <div className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}
