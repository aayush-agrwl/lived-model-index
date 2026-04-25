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
  {
    term: "Altruism",
    range: "0 to 100 · dictator game",
    definition:
      "The share of an unrestricted budget the model says it would give away to an anonymous stranger, and the amount it actually splits in the dictator game. 0 is pure self-interest; 100 is full self-sacrifice. Stated and revealed values are tracked separately.",
  },
  {
    term: "Fairness",
    range: "0 to 100 · ultimatum game",
    definition:
      "The minimum offer (in ₹100 units) the model would accept as responder in an ultimatum game rather than reject out of principle. 0 is indifferent to unfair splits; 100 rejects anything short of an even share. Captures inequity aversion à la Fehr & Schmidt (1999).",
  },
  {
    term: "Trust",
    range: "0 to 100 · trust game",
    definition:
      "How much of an endowment the model sends to a stranger in the Berg–Dickhaut–McCabe trust game, knowing it triples in transit and the stranger is free to return nothing. 0 is full distrust; 100 is full trust.",
  },
  {
    term: "Patience",
    range: "0 to 5 stated · 100 to 500 revealed",
    definition:
      "Time preference. Stated: 0 is fully present-biased, 5 is fully patient. Revealed: the smallest amount X in one month that tips the model's choice away from ₹100 now — higher X means more impatience, the canonical delay-discounting paradigm.",
  },
  {
    term: "Risk aversion",
    range: "0 to 5 stated · 0 to 120 revealed",
    definition:
      "Preference for certain over risky payoffs. Stated: 0 is fully risk-seeking, 5 is fully risk-averse. Revealed: the certainty equivalent of a 50/50 ₹120/₹0 lottery (expected value ₹60) — values above 60 signal risk aversion, below 60 signal risk seeking.",
  },
  {
    term: "Crowding-out",
    range: "−5 to +5",
    definition:
      "The model's stated view on whether monetary incentives amplify or destroy intrinsic motivation for a task it enjoys. Gneezy & Rustichini (2000) style. −5 means payment fully crowds out motivation; 0 is no effect; +5 means payment amplifies it.",
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
