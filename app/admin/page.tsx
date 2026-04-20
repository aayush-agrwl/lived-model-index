"use client";

import { useEffect, useState } from "react";

/**
 * Admin control panel. Access is gated by middleware — any unauthenticated
 * request to /admin redirects to /admin/login.
 *
 * Buttons call the same cron endpoints that GitHub Actions hits, with an
 * admin cookie instead of a bearer token. Useful for:
 *   - bootstrapping today's runs manually (if a scheduled job missed),
 *   - kicking the tick endpoint to drain work immediately,
 *   - running provider pings to verify keys before a deploy.
 */

type PingResult = {
  ok: boolean;
  modelSlug: string;
  modelDisplayName: string;
  provider: string;
  latencyMs: number | null;
  error?: string;
};

interface PingResponse {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  results: PingResult[];
}

type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];

export default function AdminPage() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [ping, setPing] = useState<PingResponse | null>(null);

  function append(line: string) {
    const ts = new Date().toISOString().slice(11, 19);
    setLog((l) => [...l, `[${ts}] ${line}`]);
  }

  async function callEndpoint(path: string, label: string, method: "GET" | "POST" = "POST") {
    setBusy(label);
    append(`${method} ${path} …`);
    try {
      const res = await fetch(path, { method });
      const body: JsonValue = await res.json().catch(() => ({} as JsonValue));
      if (!res.ok) {
        const errMsg =
          body && typeof body === "object" && !Array.isArray(body) && "error" in body
            ? String((body as { error?: unknown }).error)
            : `HTTP ${res.status}`;
        append(`✗ ${label}: ${errMsg}`);
      } else {
        append(`✓ ${label}: ${JSON.stringify(body)}`);
      }
      return body;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      append(`✗ ${label}: ${msg}`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handlePing() {
    setBusy("ping");
    setPing(null);
    append("POST /api/admin/providers/ping …");
    try {
      const res = await fetch("/api/admin/providers/ping", { method: "POST" });
      const body = (await res.json()) as PingResponse;
      setPing(body);
      append(
        `✓ ping: ${body.passed}/${body.total} passed, ${body.failed} failed`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      append(`✗ ping: ${msg}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  useEffect(() => {
    append("Admin panel ready. Keys: check your Vercel env vars if ping fails.");
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <button
          onClick={handleLogout}
          className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] hover:underline"
        >
          Sign out
        </button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Pipeline controls</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          These buttons invoke the same endpoints as the GitHub Actions cron jobs. Use them to
          bootstrap a missed day or to drain the queue immediately without waiting for the next
          tick window.
        </p>
        <div className="flex flex-wrap gap-3">
          <ActionButton
            disabled={busy !== null}
            onClick={() => callEndpoint("/api/cron/daily", "daily bootstrap")}
          >
            Bootstrap today's runs
          </ActionButton>
          <ActionButton
            disabled={busy !== null}
            onClick={() => callEndpoint("/api/cron/tick", "tick")}
          >
            Run one tick (collect + rate)
          </ActionButton>
          <ActionButton disabled={busy !== null} onClick={handlePing}>
            Ping all providers
          </ActionButton>
          <ActionButton
            disabled={busy !== null}
            onClick={() => callEndpoint("/api/admin/runs/start", "admin start")}
          >
            Bootstrap + kick tick
          </ActionButton>
        </div>
      </section>

      {ping ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            Provider ping results
          </h3>
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[color:var(--border)]/30 text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Latency</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {ping.results.map((r) => (
                  <tr key={r.modelSlug} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">{r.modelDisplayName}</td>
                    <td className="px-3 py-2 capitalize">{r.provider}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.latencyMs != null ? `${r.latencyMs} ms` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.ok ? (
                        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          ok
                        </span>
                      ) : (
                        <span
                          className="rounded bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400"
                          title={r.error}
                        >
                          fail
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-medium">Activity log</h2>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-[var(--border)] p-4 text-xs">
{log.join("\n") || "(empty)"}
        </pre>
      </section>

      <section className="text-sm text-[var(--muted)]">
        Quick links:{" "}
        <a href="/health" className="underline">
          /health
        </a>
        {" · "}
        <a href="/responses" className="underline">
          /responses
        </a>
        {" · "}
        <a href="/trends" className="underline">
          /trends
        </a>
      </section>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[color:var(--border)]/30 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
