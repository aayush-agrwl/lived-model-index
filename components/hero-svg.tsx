import { readFileSync } from "node:fs";
import path from "node:path";

// Read the SVG at module load time (server-only). Embedding it inline keeps
// the hero paint synchronous — no async <img> flash before the scene loads.
let heroSvg = "";
try {
  heroSvg = readFileSync(path.join(process.cwd(), "public", "hero.svg"), "utf8");
} catch {
  heroSvg = "";
}

export default function HeroSvg() {
  return (
    <figure
      className="pixel-art relative w-full overflow-hidden border-y border-[var(--rule)] bg-[#120a2a]"
      aria-label="A synthwave-styled forest clearing at dusk with five figures around a fire, under a banded setting sun and a starfield."
    >
      {heroSvg ? (
        <div
          className="block h-auto max-h-[62vh] w-full [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-[62vh] [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: heroSvg }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/hero.svg"
          alt=""
          className="block h-auto max-h-[62vh] w-full"
        />
      )}
    </figure>
  );
}
