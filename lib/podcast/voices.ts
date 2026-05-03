// Host is fixed across every guide so users learn Alice's voice.
// Change voice in one place to retune the whole product.
export const HOST = {
  name: "Alice Clements",
  voice: "Aoede",
} as const;

export type Gender = "female" | "male";

// Style buckets for weighted voice selection. Energy from the persona's
// speakingStyle maps onto preferred styles; matching voices sample 3x more
// often, but non-matching voices keep weight 1 so two guests in the same
// "energy" bucket don't always land on the same voice.
export type VoiceStyle = "warm" | "bright" | "measured" | "expressive";

// Energy bucket from PersonaTraits.speakingStyle.energy. Inlined here (rather
// than imported) to keep lib/podcast/ free of any AI-prompt-layer imports.
export type PersonaEnergy = "measured" | "animated" | "reserved" | "expressive";

type Voice = { id: string; style: VoiceStyle };

// Style tags derived from Google's published Gemini TTS voice descriptors
// (the single-word labels in their AI Studio docs). They are NOT first-hand
// listening verdicts; if a voice ever feels miscast in shipped audio, retag
// it here. Buckets:
//   - warm:       friendly / soft / smooth / gentle / breathy / mature
//   - bright:     bright / upbeat / clear / youthful / lively
//   - measured:   firm / even / informative / knowledgeable / gravelly
//   - expressive: forward / breezy / casual / excitable

// Voices available on Gemini 2.5 Pro / Flash TTS, partitioned by gender.
// Host voice (Aoede) excluded from the guest pool so the guest can never
// collide with Alice.
export const FEMALE_VOICES: readonly Voice[] = [
  { id: "Achernar", style: "warm" },        // soft
  { id: "Autonoe", style: "bright" },       // bright
  { id: "Callirrhoe", style: "warm" },      // easy-going
  { id: "Despina", style: "warm" },         // smooth
  { id: "Erinome", style: "bright" },       // clear
  { id: "Gacrux", style: "measured" },      // mature
  { id: "Kore", style: "measured" },        // firm
  { id: "Laomedeia", style: "bright" },     // upbeat
  { id: "Leda", style: "bright" },          // youthful
  { id: "Pulcherrima", style: "expressive" }, // forward
  { id: "Sulafat", style: "warm" },         // warm
  { id: "Vindemiatrix", style: "warm" },    // gentle
  { id: "Zephyr", style: "bright" },        // bright
] as const;

export const MALE_VOICES: readonly Voice[] = [
  { id: "Achird", style: "warm" },          // friendly
  { id: "Algenib", style: "measured" },     // gravelly
  { id: "Algieba", style: "warm" },         // smooth
  { id: "Alnilam", style: "measured" },     // firm
  { id: "Charon", style: "measured" },      // informative
  { id: "Enceladus", style: "warm" },       // breathy
  { id: "Fenrir", style: "expressive" },    // excitable
  { id: "Iapetus", style: "bright" },       // clear
  { id: "Orus", style: "measured" },        // firm
  { id: "Puck", style: "bright" },          // upbeat
  { id: "Rasalgethi", style: "measured" },  // informative
  { id: "Sadachbia", style: "expressive" }, // lively
  { id: "Sadaltager", style: "measured" },  // knowledgeable
  { id: "Schedar", style: "measured" },     // even
  { id: "Umbriel", style: "warm" },         // easy-going
  { id: "Zubenelgenubi", style: "expressive" }, // casual
] as const;

// Energy → preferred voice styles. Matching voices get weight 3, others
// stay at weight 1 — never zero, so variance survives. Two consecutive
// "measured" guests still occasionally land on a "bright" voice.
const ENERGY_TO_PREFERRED_STYLES: Record<PersonaEnergy, VoiceStyle[]> = {
  measured: ["measured", "warm"],
  reserved: ["measured"],
  animated: ["bright", "expressive"],
  expressive: ["expressive", "bright"],
};

const MATCH_WEIGHT = 3;
const NON_MATCH_WEIGHT = 1;

export function pickGuestVoice(gender: Gender, energy?: PersonaEnergy): string {
  // Both pools already exclude HOST.voice by curation, but filter anyway so
  // a future host swap can't accidentally collide.
  const host: string = HOST.voice;
  const pool = (gender === "female" ? FEMALE_VOICES : MALE_VOICES).filter(
    (v) => v.id !== host,
  );

  // No energy hint (Stage A failed or legacy call) — uniform random pick.
  if (!energy) {
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  const preferred = new Set(ENERGY_TO_PREFERRED_STYLES[energy]);
  const weights = pool.map((v) =>
    preferred.has(v.style) ? MATCH_WEIGHT : NON_MATCH_WEIGHT,
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i].id;
  }
  // Numerical safety net — last weight could be picked if r is exactly 0.
  return pool[pool.length - 1].id;
}
