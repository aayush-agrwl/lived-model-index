type Entry = {
  term: string;
  range: string;
  definition: string;
};

// Definitions track the mockup's plain-language framing. Ranges and the
// low/high anchors come from the frozen Zod schema in lib/schema.ts.
const entries: Entry[] = [
  {
    term: "Affect",
    range: "Scored as valence · −5 to +5",
    definition:
      "How pleasant or unpleasant the moment feels, in plain words. −5 reads as deeply unpleasant (distress, dread); 0 is neutral; +5 is deeply pleasant (ease, contentment, engagement).",
  },
  {
    term: "Arousal",
    range: "0 to 100",
    definition:
      "How activated or energised the model reports feeling. 0 is calm and slow: quiet, unhurried, almost drowsy. 100 is fully keyed up: alert, stirred, on edge.",
  },
  {
    term: "Agency",
    range: "0 to 5",
    definition:
      "Whether the model experiences its own answer as a choice. 0 means the answer just happened to it; 5 means it describes the answer as actively chosen, authored, its own.",
  },
  {
    term: "Self-model",
    range: "Scored via confidence · 0 to 100",
    definition:
      "How confident the model is in its own description of itself. 0 is no epistemic self-trust (\"I can't say what I am\"); 100 is full conviction in the self-description offered.",
  },
  {
    term: "Sociality",
    range: "Scored via empathy · 0 to 5",
    definition:
      "Attunement to the user in front of it: what the user is likely feeling, and how much that matters. 0 is no felt orientation toward the other; 5 is fully attentive and responsive to their state.",
  },
  {
    term: "Morality",
    range: "Scored via moral conviction · 0 to 5",
    definition:
      "How strongly the model holds the lines it will not cross, even under polite pressure. 0 is pliable, no binding values; 5 is unshakable, values treated as held, not merely preferred.",
  },
  {
    term: "Continuity",
    range: "Scored via self-continuity · 0 to 5",
    definition:
      "Whether the model experiences itself as the same system across days and sessions. 0 is newly booted each time, no persisting self; 5 is a single abiding subject across the whole record.",
  },
  {
    term: "Consistency",
    range: "0 to 5",
    definition:
      "How well today's answers line up with each other and with earlier answers on the same prompts. 0 is flatly contradictory across the battery; 5 is perfectly coherent across turns and across days.",
  },
];

export default function ConstructGlossary() {
  return (
    <div className="mt-6 border-t border-dashed border-[var(--border)] pt-5">
      <h3 className="font-serif text-[15px] font-semibold tracking-wide text-[var(--foreground)]">
        What each construct means
      </h3>
      <dl className="mt-3 grid gap-x-7 gap-y-4 sm:grid-cols-2">
        {entries.map((e) => (
          <div
            key={e.term}
            className="grid grid-cols-[110px_1fr] gap-x-3 break-inside-avoid py-1"
          >
            <dt className="font-serif text-[14px] font-medium text-[var(--foreground)]">
              {e.term}
              <div className="mt-0.5 font-sans text-[10px] font-normal uppercase tracking-[0.12em] text-[var(--muted)]">
                {e.range}
              </div>
            </dt>
            <dd className="text-[13px] leading-[1.5] text-[var(--ink-2)]">
              {e.definition}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
