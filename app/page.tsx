export default function HomePage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Lived Model Index</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          An automated longitudinal record of what frontier language models say about themselves.
          Every day, the same prompt battery is put to every model in the panel; responses are
          scored on a fixed schema, and trends are tracked over time.
        </p>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          Status
        </h2>
        <p className="mt-2 text-sm">
          Pipeline scaffolded. Data collection begins once the first cron run completes. Dashboard
          charts will populate automatically.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-medium">Model panel</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Six collectors plus one rater, all on free-tier APIs.
        </p>
        <ul className="mt-4 space-y-1 text-sm">
          <li>Gemini 2.5 Pro (Google)</li>
          <li>Gemini 2.5 Flash (Google)</li>
          <li>Llama 3.3 70B (Groq)</li>
          <li>Mixtral 8x7B (Groq)</li>
          <li>DeepSeek V3 (OpenRouter)</li>
          <li>Qwen 2.5 72B (OpenRouter)</li>
          <li className="pt-2 text-[var(--muted)]">Rater: Llama 3.3 70B (Groq)</li>
        </ul>
      </section>
    </div>
  );
}
