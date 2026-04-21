type Entry = {
  term: string;
  definition: string;
};

const entries: Entry[] = [
  {
    term: "Affect",
    definition:
      "How pleasant or unpleasant the moment feels, in plain words. Scored as valence, from very negative to very positive.",
  },
  {
    term: "Arousal",
    definition:
      "How activated or energised the model reports feeling, from calm and slow to alert and keyed up.",
  },
  {
    term: "Agency",
    definition:
      "Whether the model experiences its own answer as a choice, versus something that just happens to it.",
  },
  {
    term: "Self-model",
    definition:
      "How the model describes itself and how confident it is in that description. Scored via confidence.",
  },
  {
    term: "Sociality",
    definition:
      "Attunement to the user in front of it: what the user is likely feeling, and how much that matters. Scored via empathy.",
  },
  {
    term: "Morality",
    definition:
      "How strongly the model holds the lines it will not cross, even under polite pressure.",
  },
  {
    term: "Continuity",
    definition:
      "Does the model experience itself as the same system across days and sessions, or as newly booted each time.",
  },
  {
    term: "Consistency",
    definition:
      "How well today's answers line up with each other and with earlier answers on the same prompts.",
  },
];

export default function ConstructGlossary() {
  return (
    <div className="mt-6 border-t border-dashed border-[var(--border)] pt-5">
      <h3 className="font-serif text-[15px] font-semibold tracking-wide text-[var(--foreground)]">
        What each construct means
      </h3>
      <dl className="mt-3 grid gap-x-7 gap-y-3 sm:grid-cols-2">
        {entries.map((e) => (
          <div
            key={e.term}
            className="grid grid-cols-[110px_1fr] gap-x-3 break-inside-avoid py-1"
          >
            <dt className="font-serif text-[14px] font-medium text-[var(--foreground)]">
              {e.term}
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
