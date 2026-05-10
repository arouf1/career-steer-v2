// Host declaration + guest-voice picker. Voice metadata (gender, pitch,
// style) lives in lib/podcast/voiceCatalog.ts so this file only owns the
// matching logic.

import {
  GUEST_VOICE_POOL,
  HOST_VOICE_ID,
  type VoiceProfile,
  type VoiceStyle,
} from "./voiceCatalog";

// Host stays the same across every guide so users learn Alice's voice.
// The voice id is reserved in voiceCatalog.ts and structurally excluded
// from GUEST_VOICE_POOL, so a future host swap is a one-line change to
// HOST_VOICE_ID over there, no risk of the guest pool accidentally
// containing the host.
export const HOST = {
  name: "Alice Clements",
  voice: HOST_VOICE_ID,
} as const;

export type Gender = "female" | "male";

// Energy bucket from PersonaTraits.speakingStyle.energy. Re-declared here
// rather than imported from lib/ai/prompts/podcastPersona.ts so this file
// stays free of any AI-prompt-layer dependency. The shape must mirror
// PersonaTraits.speakingStyle.energy.
export type PersonaEnergy = "measured" | "animated" | "reserved" | "expressive";

// Structural subset of PersonaTraits the picker actually reads. Any
// PersonaTraits value satisfies this, callers pass `personaTraits`
// directly and TypeScript narrows accordingly.
export type PersonaForVoiceMatch = {
  speakingStyle: { energy: PersonaEnergy };
  traitPrior: { formality: number; warmth: number };
};

// Map a persona to the styles the picker should bias toward, in priority
// order. preferred[0] is the dominant fit, preferred[1] is the secondary
// fit. Two slots is enough, beyond that the bias becomes uniform noise
// and we lose the point of having style buckets at all.
//
// Energy is the dominant signal because it's how the voice will actually
// land in delivery (a measured persona on a perky voice sounds wrong
// regardless of formality). Formality refines within energy: a measured
// persona who's also formally registered (lawyer, surgeon) leans into
// authoritative voices; a measured persona who's casual (craftsperson,
// caregiver) leans warm. Warmth pulls measured-and-not-formal personas
// further toward warm voices.
function preferredStyles(
  energy: PersonaEnergy,
  formality: number,
  warmth: number,
): readonly [VoiceStyle, VoiceStyle] {
  switch (energy) {
    case "animated":
    case "expressive":
      // High-energy voices first; secondary depends on whether the persona
      // is formal-energetic (presenter, lawyer pitching) vs friendly-
      // energetic (creator, salesperson).
      return formality > 3.7 ? ["bright", "authoritative"] : ["bright", "warm"];
    case "reserved":
      // Quiet personas. If they're also formal, lead with authoritative
      // (the gravitas voices); otherwise lead with measured (the calm
      // voices) and back into warm.
      return formality > 3.5 ? ["authoritative", "measured"] : ["measured", "warm"];
    case "measured":
      // Default-ish energy. Three sub-cases:
      //   strongly formal  → authoritative-led (corporate, finance,
      //                       compliance)
      //   strongly warm    → warm-led (mentors, caregivers, hospitality)
      //   neither          → measured-led with warm fallback (the broad
      //                       middle)
      if (formality > 3.7) return ["authoritative", "measured"];
      if (warmth > 3.7) return ["warm", "measured"];
      return ["measured", "warm"];
  }
}

// Sampling weights. Primary fit dominates without being deterministic -
// roughly 4x more likely than a random voice, so two consecutive guests
// in the same bucket still occasionally land on different styles.
const PRIMARY_WEIGHT = 4;
const SECONDARY_WEIGHT = 2;
const NON_MATCH_WEIGHT = 1;

function weightFor(
  voice: VoiceProfile,
  preferred: readonly [VoiceStyle, VoiceStyle],
): number {
  const [primary, secondary] = preferred;
  if (voice.style === primary) return PRIMARY_WEIGHT;
  if (voice.style === secondary) return SECONDARY_WEIGHT;
  // Voices are rarely one-note. A "warm" voice that *also* shades bright
  // is a reasonable second-best for a "bright" persona, so we give the
  // secondary tag the same weight as a primary-secondary fit.
  if (voice.secondaryStyles.includes(primary)) return SECONDARY_WEIGHT;
  return NON_MATCH_WEIGHT;
}

// Pick a guest voice from the gender-matched subset of GUEST_VOICE_POOL,
// biased by the persona's speaking style. Falls back to a uniform pick
// over the gender pool when no persona is supplied (Stage A failed, or
// pre-feature legacy rows).
//
// `gender` is what the script LLM decided the guest should be. The pool
// is gender-correct per voiceCatalog.ts, so the audible voice always
// matches the cast guest's stated gender, that was the bug this whole
// refactor is fixing.
export function pickGuestVoice(
  gender: Gender,
  persona?: PersonaForVoiceMatch,
): string {
  const pool = GUEST_VOICE_POOL.filter((v) => v.gender === gender);
  // The catalog is curated to always have voices in both gender pools;
  // an empty pool would mean the catalog was edited badly. Throw rather
  // than silently fall back to the host voice or the wrong gender.
  if (pool.length === 0) {
    throw new Error(
      `pickGuestVoice: no ${gender} voices in GUEST_VOICE_POOL (catalog edit broke the pool)`,
    );
  }

  if (!persona) {
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  const preferred = preferredStyles(
    persona.speakingStyle.energy,
    persona.traitPrior.formality,
    persona.traitPrior.warmth,
  );
  const weights = pool.map((v) => weightFor(v, preferred));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i].id;
  }
  // Numerical safety net, last weight could be picked if r is exactly 0
  // due to floating-point rounding.
  return pool[pool.length - 1].id;
}

// Re-export the catalog tuples for callers that want to introspect (e.g.
// admin tooling, future "preview voice" UIs). Most callers should not
// need these, pickGuestVoice + HOST cover the normal path.
export const FEMALE_VOICES = GUEST_VOICE_POOL.filter((v) => v.gender === "female");
export const MALE_VOICES = GUEST_VOICE_POOL.filter((v) => v.gender === "male");
