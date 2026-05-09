import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Drizzle client backed by the Neon HTTP driver. Safe to use inside
 * Vercel serverless functions — no pooling state is held in the Node
 * process; each request establishes a short-lived HTTP call.
 *
 * For scripts (seed, migrations) running from a local Node process,
 * load .env.local first. For Next.js, environment variables are injected
 * by the framework automatically.
 */

neonConfig.fetchConnectionCache = true;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL not set. Locally, create .env.local from .env.example; " +
        "on Vercel, add it under Settings → Environment Variables.",
    );
  }
  return url;
}

/**
 * Whether an error returned by the Neon HTTP driver is transient and
 * worth retrying. Neon's free tier limits concurrent connection
 * attempts; under bursts of dashboard traffic combined with cron
 * activity, a single query can fail with a 500 carrying the message
 * "Failed to acquire permit to connect to the database" and a
 * structured `neon:retryable: true` hint. The driver expects the
 * caller to retry these — this predicate, plus the wrapper below,
 * implements that contract once for every query in the codebase.
 */
function isNeonRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/neon:retryable["\s:]+true/i.test(msg)) return true;
  if (/Too many database connection attempts/i.test(msg)) return true;
  if (/Failed to acquire permit/i.test(msg)) return true;
  // Generic 5xx from the Neon HTTP edge — retry once or twice in case
  // it's a transient platform hiccup.
  if (/Server error \(HTTP status 5\d\d\)/i.test(msg)) return true;
  return false;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

let _db: ReturnType<typeof drizzle> | null = null;

export function db() {
  if (_db) return _db;
  const baseSql = neon(getDatabaseUrl());
  // Proxy-wrap the neon sql function so every call through Drizzle
  // (which delegates to this function for each query) gets up to four
  // attempts with exponential backoff on retryable errors. Worst case
  // total backoff: 100 + 200 + 400 = 700 ms before the fourth attempt
  // is allowed to fail through. Non-retryable errors (schema
  // violations, bad SQL, auth) still throw immediately on attempt 1.
  const sqlWithRetry = new Proxy(baseSql, {
    apply: async (target, thisArg, args: unknown[]) => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await Reflect.apply(
            target as (...a: unknown[]) => Promise<unknown>,
            thisArg,
            args,
          );
        } catch (err) {
          lastErr = err;
          if (!isNeonRetryable(err) || attempt === 3) throw err;
          await sleep(100 * Math.pow(2, attempt));
        }
      }
      throw lastErr;
    },
  });
  _db = drizzle(sqlWithRetry, { schema });
  return _db;
}

export { schema };
