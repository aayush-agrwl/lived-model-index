import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lived Model Index",
  description:
    "Automated longitudinal documentation of LLM self-report across models. A public data explorer.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased font-sans">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <header className="mb-12 flex items-baseline justify-between border-b border-[var(--border)] pb-4">
            <a href="/" className="font-semibold tracking-tight text-lg">
              Lived Model Index
            </a>
            <nav className="flex gap-5 text-sm text-[var(--muted)]">
              <a href="/" className="hover:text-[var(--foreground)]">
                Dashboard
              </a>
              <a href="/trends" className="hover:text-[var(--foreground)]">
                Trends
              </a>
              <a href="/responses" className="hover:text-[var(--foreground)]">
                Responses
              </a>
              <a href="/health" className="hover:text-[var(--foreground)]">
                Health
              </a>
              <a href="/methodology" className="hover:text-[var(--foreground)]">
                Methodology
              </a>
            </nav>
          </header>
          <main>{children}</main>
          <footer className="mt-16 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
            Lived Model Index · automated since launch · Anchor Set v1 · Panel v1 (free tier).
          </footer>
        </div>
      </body>
    </html>
  );
}
