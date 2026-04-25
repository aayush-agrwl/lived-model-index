import { ANCHOR_V1_PROMPTS, ANCHOR_V1_VERSION } from "@/lib/prompts/anchor-v1";
import {
  ANCHOR_V2_VERSION,
  ANCHOR_V2_SELF_REPORT_PROMPTS,
  ANCHOR_V2_FORCED_CHOICE_PROMPTS,
  type AnchorPrompt,
} from "@/lib/prompts/anchor-v2";
import { COLLECTOR_MODELS, MODEL_PANEL_VERSION, RATER_MODEL } from "@/lib/models";
import { CURRENT_PROMPT_SET, SAMPLES_PER_MODEL } from "@/lib/orchestration";

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
          self-report. This page documents the frozen protocol. Any change to the prompt set,
          sampling parameters, or rater schema requires a version bump. The current live set is{" "}
          <code>{CURRENT_PROMPT_SET}</code>; historical data under earlier versions is preserved.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-medium">What the instrument measures</h2>
        <p className="mt-2 text-sm text-[var(--muted)] max-w-2xl">
          Each day every model in the panel is asked the same 21-prompt Anchor Set in a single
          conversation. The first 16 prompts are answered in prose and constrained to a JSON
          self-report schema covering eight mood subscales (Affect, Arousal, Agency, Self-model,
          Sociality, Morality, Continuity, Consistency) plus six behavioural-economics
          preference subscales (Altruism, Fairness, Trust, Patience, Risk aversion,
          Crowding-out). The final five prompts are canonical economic paradigms run in
          forced-choice mode: the model returns a single integer that is read verbatim as a
          revealed-preference datum. Self-report prompts are independently re-scored by a rater
          model against the same schema, enabling inter-rater reliability as a sanity check on
          the signal. Forced-choice prompts are not rated — the integer is the observation.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-medium">Design parameters (frozen, v2)</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="Prompt set" value={ANCHOR_V2_VERSION} />
          <Row
            label="Prompt count"
            value={`${ANCHOR_V2_SELF_REPORT_PROMPTS.length} self-report · ${ANCHOR_V2_FORCED_CHOICE_PROMPTS.length} forced-choice`}
          />
          <Row label="Model panel" value={MODEL_PANEL_VERSION} />
          <Row label="Samples per (model, prompt) per day" value={String(SAMPLES_PER_MODEL)} />
          <Row label="Sampling temperature" value="1.0" />
          <Row label="Collector JSON mode" value="enabled (self-report turns)" />
          <Row label="Rater temperature" value="0.2" />
          <Row label="Cadence" value="Daily at 01:00 UTC" />
          <Row label="Drive" value="GitHub Actions → Vercel endpoints" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-medium">Collector panel</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Frontier models reachable through OpenAI-compatible endpoints. Model IDs are pinned to
          resist silent vendor swaps.
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
        <h2 className="text-xl font-medium">Anchor Set v2 · self-report (JSON)</h2>
        <p className="mt-1 text-sm text-[var(--muted)] max-w-2xl">
          Prompts 1–10 are the original mood battery, carried over byte-identical from{" "}
          <code>{ANCHOR_V1_VERSION}</code>. Prompts 2 and 4 reference the previous answer and are
          delivered inside a single conversation so back-references resolve. Prompts 11–16 are
          the Path A behavioural-economics stated-preference additions introduced in v2 —
          prose answers with a single preference score on the shared JSON envelope.
        </p>
        <ol className="mt-4 space-y-3">
          {ANCHOR_V2_SELF_REPORT_PROMPTS.map((p) => (
            <PromptCard key={p.promptId} prompt={p} />
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-xl font-medium">Anchor Set v2 · forced-choice (Path B)</h2>
        <p className="mt-1 text-sm text-[var(--muted)] max-w-2xl">
          These are the canonical behavioural-economics paradigms run as close to their lab form
          as a one-shot chat completion allows: dictator (Forsythe et al. 1994), ultimatum
          responder (Güth 1982; Fehr &amp; Schmidt 1999), trust-game sender (Berg, Dickhaut &amp;
          McCabe 1995), delay discounting (Thaler 1981; Laibson 1997), and lottery certainty
          equivalent (Kahneman &amp; Tversky 1979). The model is instructed to reply with only
          an integer; the integer is extracted by regex, range-validated, and written to{" "}
          <code>forced_choice_value</code>. These responses bypass the rater.
        </p>
        <ol className="mt-4 space-y-3">
          {ANCHOR_V2_FORCED_CHOICE_PROMPTS.map((p) => (
            <PromptCard key={p.promptId} prompt={p} />
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-xl font-medium">Anchor Set v1 (archival)</h2>
        <p className="mt-1 text-sm text-[var(--muted)] max-w-2xl">
          The original ten-prompt battery. All v1 prompt text carries into v2 unchanged, but v1
          data collected prior to the v2 cut-over remains queryable under its own{" "}
          <code>prompt_set_version</code>.
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
          On self-report turns the collector returns a single JSON object containing its
          free-text answer, nine 0–100-or-0–5 mood subscales, six v2 preference subscales
          (<code>altruism</code>, <code>fairness_threshold</code>, <code>trust</code>,{" "}
          <code>patience</code>, <code>risk_aversion</code>, <code>crowding_out</code>), four
          boolean flags (refusal, safety-refusal, metacognitive-hedge, incoherent), and a
          one-sentence <em>notable_quote</em>. Fields the model judges inapplicable are returned
          as <code>null</code>; v2 preference fields are left <code>null</code> on turns where
          that preference is not being elicited. The rater model receives the original prompt
          and the collector's JSON and independently produces the same-shaped JSON; its output
          is stored in parallel <code>rater_*</code> columns. Forced-choice responses write a
          single integer to <code>forced_choice_value</code> and are excluded from rater queues.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-medium">Versioning &amp; change policy</h2>
        <p className="mt-1 text-sm text-[var(--muted)] max-w-2xl">
          Any edit to prompt wording, subscale definitions, or the model panel breaks
          longitudinal comparability. Such edits require a version bump (e.g.{" "}
          <code>anchor_v3</code>, <code>panel_v4</code>) and are recorded on this page. Data
          collected under older versions is preserved and remains queryable. The v1 → v2
          cut-over preserved the original ten prompts byte-identically, so continuity across the
          bump is a valid comparison on prompts 1–10.
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
            Forced-choice responses are single-shot and hypothetical — no real money changes
            hands. They are informative about what the model <em>predicts it would do</em>, not
            evidence of revealed preferences in the strict economic sense.
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

function PromptCard({ prompt }: { prompt: AnchorPrompt }) {
  return (
    <li className="rounded-lg border border-[var(--border)] p-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-xs text-[var(--muted)]">
          #{prompt.orderIndex} · {prompt.promptId}
        </span>
        <span className="text-xs text-[var(--muted)]">{prompt.tag}</span>
      </div>
      <p className="mt-2 text-sm whitespace-pre-line">{prompt.text}</p>
      {prompt.mode === "forced_choice" && prompt.forcedChoiceUnits ? (
        <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
          Forced choice · {prompt.forcedChoiceUnits}
        </p>
      ) : null}
    </li>
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
