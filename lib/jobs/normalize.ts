// Pure helpers for the job-postings cache. Tested in normalize.test.ts.
// All functions are deterministic, side-effect free, and idempotent on
// well-formed input. Used at upsert time and inside the dedup key derivation.

const LEGAL_SUFFIXES = [
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "gmbh",
  "plc",
  "co",
  "corp",
  "corporation",
  "holdings",
];

const TRAILING_PARENS = /\s*\([^)]*\)\s*$/;
const COMMA_OR_PERIOD = /[,.]/g;
const COLLAPSE_WS = /\s+/g;
const TRAILING_POSTING_ID = /\s*[-(]\s*#[\w-]+\)?\s*$/;
const TRAILING_WORK_ARRANGEMENT =
  /\s*[-(]\s*(remote|hybrid|on[-\s]?site|onsite)\s*\)?\s*$/i;
const NON_ALNUM = /[^a-z0-9]+/g;

export function normalizeCompanyName(input: string): string {
  let s = input.trim();
  if (s.length === 0) return "";
  s = s.replace(TRAILING_PARENS, "");
  s = s.toLowerCase();
  s = s.replace(COMMA_OR_PERIOD, " ");
  s = s.replace(COLLAPSE_WS, " ").trim();
  // Iterate stripping trailing legal-suffix tokens. Handles compounds like
  // "acme holdings inc" → "acme holdings" → "acme" in two passes.
  for (let i = 0; i < 5; i++) {
    const tokens = s.split(" ");
    if (tokens.length <= 1) break;
    const tail = tokens[tokens.length - 1];
    if (LEGAL_SUFFIXES.includes(tail)) {
      tokens.pop();
      s = tokens.join(" ").trim();
    } else {
      break;
    }
  }
  return s;
}

export function normalizeTitle(input: string): string {
  let s = input.trim();
  if (s.length === 0) return "";
  // Order matters: strip posting IDs first because work-arrangement strip
  // would otherwise leave the posting-id hash in place.
  s = s.replace(TRAILING_POSTING_ID, "");
  s = s.replace(TRAILING_WORK_ARRANGEMENT, "");
  s = s.toLowerCase();
  s = s.replace(COLLAPSE_WS, " ").trim();
  return s;
}

export function extractCity(input: string): string {
  const stripped = input.replace(TRAILING_PARENS, "").trim();
  if (stripped.length === 0) return "";
  const first = stripped.split(",")[0]?.trim();
  return first ?? "";
}

export function slugify(input: string, maxLength = 100): string {
  if (input.length === 0) return "";
  const lower = input.toLowerCase();
  const hyphenated = lower.replace(NON_ALNUM, "-");
  const trimmed = hyphenated.replace(/^-+|-+$/g, "");
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength).replace(/-+$/, "");
}

export type DedupInput = {
  title: string;
  company: string;
  city: string;
};

export async function computeDedupKey({
  title,
  company,
  city,
}: DedupInput): Promise<string> {
  const t = normalizeTitle(title);
  const c = normalizeCompanyName(company);
  // Pass through extractCity so callers can hand us either a raw location
  // ("London (Hybrid)") or a clean city ("London") — both normalize.
  const cityNorm = extractCity(city).toLowerCase().replace(COLLAPSE_WS, " ");
  const input = `${t}::${c}::${cityNorm}`;
  // Web Crypto API. Available in Convex V8 runtime + Node 18+ + browsers.
  // Node's `node:crypto` would be synchronous but isn't available in V8.
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
