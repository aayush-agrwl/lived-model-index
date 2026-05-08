import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/lib/auth";

/**
 * GET/POST /api/admin/twitter/debug
 *
 * Reports presence, raw vs trimmed lengths, and a masked preview of
 * each of the four OAuth1.0a env vars. Lets the operator compare what
 * the deployed function actually sees against what they pasted into
 * the X developer console — without exposing any full secret to the
 * client (or to logs).
 *
 * Mask format: first four chars + "…" + last four chars. With X tokens
 * being 25-50 characters long, this is enough to distinguish keys
 * that have been swapped between env-var slots, while leaking
 * negligible information.
 *
 * Access: admin cookie only.
 */

export const runtime = "nodejs";

interface KeyDebug {
  name: string;
  present: boolean;
  rawLength: number | null;
  trimmedLength: number | null;
  hasLeadingWhitespace: boolean;
  hasTrailingWhitespace: boolean;
  hasNewline: boolean;
  hasSurroundingQuotes: boolean;
  preview: string | null;
}

function describe(name: string, value: string | undefined): KeyDebug {
  if (value === undefined) {
    return {
      name,
      present: false,
      rawLength: null,
      trimmedLength: null,
      hasLeadingWhitespace: false,
      hasTrailingWhitespace: false,
      hasNewline: false,
      hasSurroundingQuotes: false,
      preview: null,
    };
  }
  const trimmed = value.trim();
  const preview =
    trimmed.length >= 8
      ? `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
      : "(too short to preview)";
  return {
    name,
    present: true,
    rawLength: value.length,
    trimmedLength: trimmed.length,
    hasLeadingWhitespace: value.length > 0 && /^\s/.test(value),
    hasTrailingWhitespace: value.length > 0 && /\s$/.test(value),
    hasNewline: /\r|\n/.test(value),
    hasSurroundingQuotes:
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")),
    preview,
  };
}

export async function POST() {
  if (!isAuthorizedAdmin()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const keys: KeyDebug[] = [
    describe("TWITTER_API_KEY", process.env.TWITTER_API_KEY),
    describe("TWITTER_API_SECRET", process.env.TWITTER_API_SECRET),
    describe("TWITTER_ACCESS_TOKEN", process.env.TWITTER_ACCESS_TOKEN),
    describe("TWITTER_ACCESS_SECRET", process.env.TWITTER_ACCESS_SECRET),
  ];
  // Expected lengths for the four X OAuth1.0a credentials, taken from
  // X's published format conventions. These are guidelines for the
  // operator's eye, not validation rules — X has been known to
  // adjust formats — but a value way outside the band is almost
  // certainly the wrong key in the wrong slot.
  const expectations = {
    TWITTER_API_KEY: "~25 chars",
    TWITTER_API_SECRET: "~50 chars",
    TWITTER_ACCESS_TOKEN: "<digits>-<long string>, total ~50 chars",
    TWITTER_ACCESS_SECRET: "~45 chars",
  };
  return NextResponse.json({ ok: true, expectations, keys });
}

export async function GET(_req: NextRequest) {
  return POST();
}
