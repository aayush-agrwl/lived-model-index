import { readFileSync } from "node:fs";
import path from "node:path";

// Read the SVG at module load time (server-only). Embedding it inline keeps
// the hero paint synchronous — no async <img> flash before the scene loads.
let supportHeroSvg = "";
try {
  supportHeroSvg = readFileSync(
    path.join(process.cwd(), "public", "support-hero.svg"),
    "utf8"
  );
} catch {
  supportHeroSvg = "";
}

export default function SupportHeroSvg() {
  return (
    <figure
      className="pixel-art relative w-full overflow-hidden rounded-sm border border-[var(--rule)] bg-[#120a2a]"
      aria-label="Pixel art: five figures gathered around a campfire under a starlit sky. A backer with coins, a patron feeding the fire, the tall cloaked Index holding a glowing staff, a friend warming hands, and a builder with a hammer. An owl watches from a tree. Caption: Five strangers, one steady fire."
    >
      {supportHeroSvg ? (
        <div
          className="block w-full [&>svg]:block [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: supportHeroSvg }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/support-hero.svg"
          alt=""
          className="block h-auto max-h-[62vh] w-full"
        />
      )}
    </figure>
  );
}
