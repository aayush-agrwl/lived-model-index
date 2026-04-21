import { readFileSync } from "node:fs";
import path from "node:path";

// Read the SVG at module load time (server-only). Embedding it inline keeps
// the hero paint synchronous — no async <img> flash before the scene loads.
let heroSvg = "";
try {
  heroSvg = readFileSync(path.join(process.cwd(), "public", "hero.svg"), "utf8");
} catch {
  // Fallback to an <img> reference if the file isn't reachable at build time
  // (e.g. some edge sandbox variants). The public/ file will still be served.
  heroSvg = "";
}

export default function HeroSvg() {
  return (
    <div
      className="pixel-art relative w-full overflow-hidden rounded-sm border border-[var(--rule)] bg-[#120a2a]"
      style={{ aspectRatio: "1600 / 560" }}
      aria-label="A synthwave pixel-art landscape with a banded sun setting behind stepped mountains, a purple starfield, and two small figures silhouetted on a ridge in the foreground."
      role="img"
    >
      {heroSvg ? (
        <div
          className="absolute inset-0 h-full w-full"
          dangerouslySetInnerHTML={{ __html: heroSvg }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/hero.svg"
          alt=""
          className="absolute inset-0 h-full w-full"
        />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[var(--background)] to-transparent h-16" />
    </div>
  );
}
