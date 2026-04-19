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

let _db: ReturnType<typeof drizzle> | null = null;

export function db() {
  if (_db) return _db;
  const sql = neon(getDatabaseUrl());
  _db = drizzle(sql, { schema });
  return _db;
}

export { schema };
