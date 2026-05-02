// Whole-word expansions for canonicalization prefilter. Order matters:
// longer keys come first so "PMM" is not shadowed by "PM". Each pattern is
// case-insensitive and word-bounded with optional trailing dot ("Sr.", "Jr.").
const EXPANSIONS: Array<readonly [RegExp, string]> = [
  // Seniority / qualifiers
  [/\bsr\b\.?/gi, "senior"],
  [/\bjr\b\.?/gi, "junior"],
  [/\bassoc\b\.?/gi, "associate"],
  [/\basst\b\.?/gi, "assistant"],
  // Leadership (longer first)
  [/\bsvp\b\.?/gi, "senior vice president"],
  [/\bevp\b\.?/gi, "executive vice president"],
  [/\bvp\b\.?/gi, "vice president"],
  [/\bcto\b\.?/gi, "chief technology officer"],
  [/\bceo\b\.?/gi, "chief executive officer"],
  [/\bcfo\b\.?/gi, "chief financial officer"],
  [/\bcoo\b\.?/gi, "chief operating officer"],
  [/\bcmo\b\.?/gi, "chief marketing officer"],
  [/\bcpo\b\.?/gi, "chief product officer"],
  // IC roles (longer first to avoid shadowing)
  [/\bpmm\b\.?/gi, "product marketing manager"],
  [/\btpm\b\.?/gi, "technical program manager"],
  [/\bswe\b\.?/gi, "software engineer"],
  [/\bsde\b\.?/gi, "software development engineer"],
  [/\bpm\b\.?/gi, "product manager"],
  [/\bem\b\.?/gi, "engineering manager"],
  [/\bux\b\.?/gi, "user experience"],
  [/\bui\b\.?/gi, "user interface"],
  [/\bqa\b\.?/gi, "quality assurance"],
  [/\bml\b\.?/gi, "machine learning"],
  [/\bai\b\.?/gi, "artificial intelligence"],
];

// Strip trailing seniority levels: "III"/"II"/"I" or "IV"/"V" or "1"-"9".
// Anchored at end of string only, after lowercasing.
const TRAILING_LEVEL = /\s+(?:i{1,3}|iv|v|[1-9])$/i;

export const expandTitleAbbreviations = (input: string): string => {
  let s = input.trim();
  if (!s) return "";

  for (const [pattern, replacement] of EXPANSIONS) {
    s = s.replace(pattern, replacement);
  }

  s = s
    .replace(/[.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  s = s.replace(TRAILING_LEVEL, "").trim();

  return s;
};
