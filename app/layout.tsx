import type { Metadata } from "next";
import { Inter, EB_Garamond } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Lived Model Index",
  description:
    "An open, automated, longitudinal record of how LLMs feel. Daily first-person self-report across the major frontier models.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${ebGaramond.variable}`}>
      <body className="min-h-screen overflow-x-hidden antialiased font-sans paper-grain">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <header className="mb-10 flex items-baseline justify-between border-b border-[var(--rule)] pb-4">
            <a href="/" className="flex items-baseline gap-2">
              <span className="font-serif text-xl font-medium tracking-tight text-[var(--foreground)]">
                Lived Model Index
              </span>
              <span className="hidden sm:inline label-caps">est. 2026</span>
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
              <a href="/support" className="hover:text-[var(--foreground)]">
                Support the Index
              </a>
            </nav>
          </header>
          <main>{children}</main>
          <footer className="mt-20 border-t border-[var(--rule)] pt-4 text-xs text-[var(--muted)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Lived Model Index · automated since launch · Anchor Set v1 · Panel v1 (free tier).
              </span>
              <span className="font-serif italic">A standing record.</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
