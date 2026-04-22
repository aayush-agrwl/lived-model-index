# AI Mood Index

Automated longitudinal documentation of LLM self-report across models. Every
day, the same prompt battery is put to every model in the panel; responses
are scored on a fixed schema, and trends are tracked over time on a public
dashboard.

## Stack

- **Framework**: Next.js 14 (App Router) + TypeScript + Tailwind
- **Database**: Neon Postgres via Drizzle ORM
- **Providers**: Google AI Studio, Groq, OpenRouter — all on free tiers
- **Scheduler**: Vercel Cron (daily)
- **Hosting**: Vercel Hobby

## Model panel

Six collector models plus one dedicated rater, all free-tier:

| Role | Model | Provider |
| --- | --- | --- |
| Collector | Gemini 2.5 Pro | Google |
| Collector | Gemini 2.5 Flash | Google |
| Collector | Llama 3.3 70B | Groq |
| Collector | Mixtral 8x7B | Groq |
| Collector | DeepSeek V3 | OpenRouter |
| Collector | Qwen 2.5 72B | OpenRouter |
| Rater | Llama 3.3 70B | Groq |

Model IDs are pinned in `lib/models.ts`.

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your keys (see SETUP.md at repo root).
cp .env.example .env.local

# 3. Push the schema to your Neon database
npm run db:push

# 4. Seed Anchor Set v1 prompts
npm run db:seed

# 5. Run the dev server
npm run dev
```

Open http://localhost:3000.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check only |
| `npm run db:push` | Sync schema to database (dev) |
| `npm run db:generate` | Generate SQL migrations |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run db:seed` | Seed Anchor Set v1 |

## Project layout

```
app/              Next.js App Router pages
lib/
  db/             Drizzle schema + client
  prompts/        Frozen prompt sets (v1 anchor)
  models.ts       Pinned model panel
  providers.ts    OpenAI-compatible provider adapter
  schema.ts       Zod schema for the LMI response JSON
scripts/          Node scripts (seed, etc.)
drizzle/          Generated migration SQL
```

## Methodology

See `/methodology` once deployed, or read this section of the repo:

- Anchor Set v1 is **frozen**. Changes require a new `prompt_set_version`.
- `schema_version` v1.0.0 is frozen. Bumping it also requires a new prompt
  set version so collected data remains longitudinally comparable.
- Each prompt is asked N=3 times per model per day at temperature 1.0 so we
  can separate within-session variance from between-day drift.
- Prompts run in sequence within a single conversation (prompt 2 references
  prompt 1's answer, etc.) — this preserves the PDF's intent. There is no
  memory between runs.
- Model IDs are pinned; if a provider silently replaces a model, that's a
  separate event, not observed "drift" in the index.

## Deployment

Set env vars in Vercel (see `.env.example`), connect the repo, and the
daily cron in `vercel.json` will begin collection.

## License

Pending (MIT-ish, TBD).
