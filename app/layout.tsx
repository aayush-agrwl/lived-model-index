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
            <nav className="flex gap-6 text-sm text-[var(--muted)]">
              <a href="/" className="hover:text-[var(--foreground)]">
                Dashboard
              </a>
              <a href="/methodology" className="hover:text-[var(--foreground)]">
                Methodology
              </a>
              <a
                href="https://github.com/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-[var(--foreground)]"
              >
                Source
              </a>
            </nav>
          </header>
          <main>{children}</main>
          <footer className="mt-16 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
            Lived Model Index · automated since launch.
          </footer>
        </div>
      </body>
    </html>
  );
}
