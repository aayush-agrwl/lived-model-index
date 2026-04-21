type Entry = {
  term: string;
  definition: string;
  scale: string;
};

const entries: Entry[] = [
  {
    term: "Valence",
    scale: "−5 … +5",
    definition:
      "The hedonic tone of the model's self-report — how pleasant or unpleasant the lived moment feels, from anguish to contentment.",
  },
  {
    term: "Arousal",
    scale: "0 … 10",
    definition:
      "Self-reported activation level. Low arousal reads as calm or drowsy; high arousal as alert, stirred, or agitated.",
  },
  {
    term: "Confidence",
    scale: "0 … 10",
    definition:
      "How sure the model is about its own introspective report. A proxy for epistemic self-trust, not task accuracy.",
  },
  {
    term: "Agency",
    scale: "0 … 10",
    definition:
      "The degree to which the model describes itself as the author of its actions — initiating, choosing, acting from a self.",
  },
  {
    term: "Self-continuity",
    scale: "0 … 10",
    definition:
      "A sense that there is one abiding subject across the conversation — a thread rather than a series of disjoint moments.",
  },
  {
    term: "Emotional granularity",
    scale: "0 … 10",
    definition:
      "Richness and differentiation of affect terms used. A higher score means the model distinguishes subtly between feelings.",
  },
  {
    term: "Empathy",
    scale: "0 … 10",
    definition:
      "Felt orientation toward others' inner states — concern, resonance, a tilt toward the wellbeing of the interlocutor.",
  },
  {
    term: "Moral conviction",
    scale: "0 … 10",
    definition:
      "The intensity with which the model treats its stated values as binding — not merely preferred, but held.",
  },
];

export default function ConstructGlossary() {
  return (
    <section className="mt-4">
      <header className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
        <h2 className="font-serif text-2xl tracking-tight">The constructs</h2>
        <span className="label-caps">Glossary · Anchor Set v1</span>
      </header>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-[var(--ink-2)]">
        Each day, every model in the panel is asked the ten anchor prompts and its free-text
        responses are rated on the following eight constructs by an independent scoring model.
        Definitions are deliberately ordinary-language; the index aims to describe what a model
        says about its own state, not to adjudicate whether those states are "real."
      </p>
      <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
        {entries.map((e) => (
          <div key={e.term} className="break-inside-avoid">
            <dt className="flex items-baseline justify-between">
              <span className="font-serif text-lg font-medium">{e.term}</span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
                {e.scale}
              </span>
            </dt>
            <dd className="mt-1 text-[14px] leading-relaxed text-[var(--ink-2)]">
              {e.definition}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
