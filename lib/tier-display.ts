// Shared display vocabulary for career_guide_ladder_positions.tier. Single
// source of truth for chip labels (in card grids) and editorial copy (in
// breadcrumbs and peer strips on the guide page) so labels never drift
// between surfaces.

export type Tier =
  | "ic-entry"
  | "ic-mid"
  | "ic-senior"
  | "manager"
  | "head"
  | "director"
  | "vp"
  | "c-suite";

// Compact, all-caps form for card chips. Two short words max so it fits
// inside a small badge in the corner of an illustration.
const CHIP: Record<Tier, string> = {
  "ic-entry": "IC ENTRY",
  "ic-mid": "IC MID",
  "ic-senior": "IC SENIOR",
  manager: "MANAGER",
  head: "HEAD",
  director: "DIRECTOR",
  vp: "VP",
  "c-suite": "C-SUITE",
};

export const tierChip = (tier: Tier): string => CHIP[tier];

// Editorial sentence-case description for the peer-roles strip caption.
// Reads as the trailing half of "Senior individual contributors at this
// scope, on other ladders." — the leading half is the eyebrow above it.
const PEER_DESCRIPTOR: Record<Tier, string> = {
  "ic-entry": "Junior individual contributors at this scope, on other ladders",
  "ic-mid": "Individual contributors at this scope, on other ladders",
  "ic-senior":
    "Senior individual contributors at this scope, on other ladders",
  manager: "Team managers at this scope, on other ladders",
  head: "Department heads at this scope, on other ladders",
  director: "Directors at this scope, on other ladders",
  vp: "Vice presidents at this scope, on other ladders",
  "c-suite": "C-suite leaders at this scope, on other ladders",
};

export const tierPeerDescriptor = (tier: Tier): string =>
  PEER_DESCRIPTOR[tier];
