// Catalog of Gemini 2.5 Pro / Flash TTS prebuilt voices. Single source of
// truth for voice gender, pitch, and style — the host declaration and the
// guest-voice picker (lib/podcast/voices.ts) both read from here.
//
// Where the descriptions came from:
//   Google's AI Studio docs label each voice with a single-word style hint
//   ("Bright", "Mature", etc.) and don't disclose perceived gender. A
//   community catalog circa 2025 had Gemini Pro itself listen to a sample
//   of every prebuilt voice and produce the descriptions reproduced here
//   verbatim in `description`. That keeps the source auditable: if a tag
//   ever feels off in shipped audio, the original listening note is right
//   there next to the structured tags so the retag is grounded.
//
// What the picker actually uses:
//   `gender` filters the pool to match the LLM-decided guest gender;
//   `style` and `secondaryStyles` drive the weighted bias against the
//   persona's energy / formality. `pitch` is informational today, kept for
//   future per-pitch matching (e.g. youth-skewed roles preferring mid-high
//   voices).
//
// Re-tagging guidance:
//   If a shipped episode lands on a voice that feels miscast, retag the
//   `style` here — the picker re-derives buckets at module load. Don't add
//   a voice that isn't actually exposed by Gemini TTS; there is no
//   fallback if the API rejects the name.

export type VoiceGender = "female" | "male";

// Primary bucket — single most-defining quality of the voice.
export type VoiceStyle = "warm" | "bright" | "measured" | "authoritative";

// Pitch hint — informational today, used for catalog readability and
// future matching.
export type VoicePitch = "high" | "mid-high" | "mid" | "mid-low" | "low";

export type VoiceProfile = {
  id: string;
  gender: VoiceGender;
  pitch: VoicePitch;
  style: VoiceStyle;
  // Voices are rarely one-note. Secondary styles let a "warm" voice still
  // be picked occasionally for a "bright" persona because its delivery
  // shades that way too.
  secondaryStyles: readonly VoiceStyle[];
  description: string;
  bestUses: readonly string[];
};

// Voice id reserved for the show's host. Never appears in the guest pool;
// `GUEST_VOICE_POOL` filters it out structurally, so a future host swap
// only requires changing this constant.
export const HOST_VOICE_ID = "Aoede";

export const VOICE_CATALOG: readonly VoiceProfile[] = [
  {
    id: "Achernar",
    gender: "male",
    pitch: "mid",
    style: "warm",
    secondaryStyles: ["bright"],
    description:
      "Clear, mid-range male voice with a friendly and engaging tone. Conveys enthusiasm and approachability without being overly energetic.",
    bestUses: [
      "Explainer videos",
      "friendly corporate narration",
      "podcast intros",
    ],
  },
  {
    id: "Achird",
    gender: "female",
    pitch: "mid-high",
    style: "bright",
    secondaryStyles: ["warm"],
    description:
      "Youthful, mid-to-high pitched female voice, clear with a slightly breathy, inquisitive quality. Sounds friendly and approachable, good for contemporary content.",
    bestUses: [
      "E-learning modules for younger audiences",
      "friendly app tutorials",
      "young adult character voice",
    ],
  },
  {
    id: "Algenib",
    gender: "female",
    pitch: "mid",
    style: "warm",
    secondaryStyles: ["authoritative"],
    description:
      "Warm, confident female voice with a mid-range pitch and good clarity. Projects a sense of friendly authority and experience.",
    bestUses: [
      "Corporate presentations",
      "documentary narration",
      "mature but friendly character roles",
    ],
  },
  {
    id: "Alnilam",
    gender: "male",
    pitch: "mid-low",
    style: "bright",
    secondaryStyles: ["authoritative"],
    description:
      "Energetic male voice with a mid-to-low pitch, carrying a sense of excitement and clarity. Has a slightly commercial, enthusiastic quality, very direct.",
    bestUses: ["Commercials", "promotional material", "event hosting announcements"],
  },
  {
    id: "Aoede",
    gender: "female",
    pitch: "mid",
    style: "warm",
    secondaryStyles: ["measured"],
    description:
      "Clear, conversational female voice with a mid-range pitch and a thoughtful, engaging quality. Sounds intelligent and articulate, easy to listen to for extended periods.",
    bestUses: ["Podcast hosting", "e-learning", "informative content narration"],
  },
  {
    id: "Autonoe",
    gender: "male",
    pitch: "low",
    style: "authoritative",
    secondaryStyles: ["measured"],
    description:
      "Mature, deeper male voice with a resonant and thoughtful quality. Conveys wisdom and experience, with a calm and measured pace.",
    bestUses: [
      "Documentary narration",
      "audiobook narration (serious non-fiction)",
      "authoritative roles",
    ],
  },
  {
    id: "Callirrhoe",
    gender: "female",
    pitch: "mid",
    style: "authoritative",
    secondaryStyles: ["bright"],
    description:
      "Confident, clear female voice with a mid-range pitch, projecting professionalism and energy. Articulate and direct, good for conveying information effectively.",
    bestUses: ["Business presentations", "corporate training", "IVR systems"],
  },
  {
    id: "Charon",
    gender: "male",
    pitch: "mid-low",
    style: "warm",
    secondaryStyles: ["authoritative"],
    description:
      "Smooth, conversational male voice with a mid-to-low pitch, sounding assured and approachable. Carries a gentle authority and trustworthiness.",
    bestUses: [
      "Podcast narration",
      "explainer videos",
      "corporate communications",
    ],
  },
  {
    id: "Despina",
    gender: "female",
    pitch: "mid",
    style: "warm",
    secondaryStyles: ["bright"],
    description:
      "Warm and inviting female voice with a clear, mid-range pitch. Sounds friendly, trustworthy, and engaging, with a pleasant smoothness.",
    bestUses: [
      "Commercials (especially lifestyle/family)",
      "customer service recordings",
      "welcoming narrations",
    ],
  },
  {
    id: "Enceladus",
    gender: "male",
    pitch: "mid",
    style: "bright",
    secondaryStyles: ["warm"],
    description:
      "Energetic and enthusiastic male voice with a mid-range pitch, perfect for conveying excitement. Clear and impactful delivery, with a slightly \"promo\" feel.",
    bestUses: [
      "Promotional videos",
      "event announcements",
      "high-energy commercials",
    ],
  },
  {
    id: "Erinome",
    gender: "female",
    pitch: "mid-low",
    style: "measured",
    secondaryStyles: ["authoritative"],
    description:
      "Professional and articulate female voice with a slightly lower mid-range pitch and a thoughtful, measured delivery. Conveys intelligence and composure, with a touch of sophistication.",
    bestUses: [
      "Educational content",
      "corporate narration",
      "museum audio guides",
    ],
  },
  {
    id: "Fenrir",
    gender: "male",
    pitch: "mid",
    style: "warm",
    secondaryStyles: ["bright"],
    description:
      "Friendly and clear male voice with a mid-range pitch, exhibiting a conversational and approachable style. Engaging and easy to listen to, with a natural delivery.",
    bestUses: ["Explainer videos", "podcasting", "e-learning content"],
  },
  {
    id: "Gacrux",
    gender: "male",
    pitch: "mid-low",
    style: "authoritative",
    secondaryStyles: ["warm"],
    description:
      "Smooth, confident male voice with a mid-to-low pitch and a clear, authoritative yet approachable tone. Projects experience and knowledge effectively.",
    bestUses: [
      "Documentary narration",
      "corporate presentations",
      "audiobook (non-fiction)",
    ],
  },
  {
    id: "Iapetus",
    gender: "male",
    pitch: "mid",
    style: "warm",
    secondaryStyles: [],
    description:
      "Friendly, mid-pitched male voice with a casual, \"everyman\" quality. Sounds approachable and relatable, good for informal communication.",
    bestUses: [
      "Informal tutorials",
      "vlogs",
      "conversational marketing content",
    ],
  },
  {
    id: "Kore",
    gender: "female",
    pitch: "mid-high",
    style: "bright",
    secondaryStyles: ["warm"],
    description:
      "Energetic and youthful female voice with a mid-to-high pitch, conveying confidence and enthusiasm. Clear and bright, with a perky, engaging quality.",
    bestUses: [
      "Upbeat commercials",
      "tutorials for a younger audience",
      "animated character voice",
    ],
  },
  {
    id: "Laomedeia",
    gender: "female",
    pitch: "mid",
    style: "warm",
    secondaryStyles: ["bright"],
    description:
      "Clear, conversational female voice with a mid-range pitch, possessing an inquisitive and engaging tone. Sounds friendly and intelligent, similar to Aoede but perhaps a touch more energetic.",
    bestUses: ["E-learning", "explainer videos", "podcast hosting"],
  },
  {
    id: "Leda",
    gender: "female",
    pitch: "mid-low",
    style: "authoritative",
    secondaryStyles: ["measured"],
    description:
      "Composed and professional female voice, mid-pitched with a slightly lower resonance, conveying authority and calm. Articulate and measured, with a sophisticated and trustworthy feel.",
    bestUses: ["Corporate training", "serious narration", "formal announcements"],
  },
  {
    id: "Orus",
    gender: "male",
    pitch: "low",
    style: "authoritative",
    secondaryStyles: ["measured"],
    description:
      "Mature male voice with a deeper, resonant quality, conveying thoughtfulness and experience. Calming and authoritative, with a measured, deliberate pace.",
    bestUses: [
      "Documentary narration",
      "audiobook (serious fiction/non-fiction)",
      "character voice (wise elder)",
    ],
  },
  {
    id: "Puck",
    gender: "male",
    pitch: "mid",
    style: "warm",
    secondaryStyles: ["bright"],
    description:
      "Clear and direct male voice with a mid-range pitch, sounding confident and approachable. Has a slightly informal, \"guy next door\" feel, trustworthy.",
    bestUses: [
      "How-to videos",
      "informal corporate communications",
      "friendly product demos",
    ],
  },
  {
    id: "Pulcherrima",
    gender: "female",
    pitch: "mid-high",
    style: "bright",
    secondaryStyles: ["warm"],
    description:
      "Bright, energetic female voice with a mid-to-high pitch, sounding youthful and enthusiastic. Clear and engaging delivery, very upbeat.",
    bestUses: [
      "Upbeat commercials",
      "tutorials",
      "character voice for animation or young adult content",
    ],
  },
  {
    id: "Rasalgethi",
    gender: "male",
    pitch: "mid",
    style: "warm",
    secondaryStyles: ["measured"],
    description:
      "Conversational male voice with a mid-range pitch and a slightly nasal, inquisitive quality. Approachable but distinct, with a thoughtful, questioning intonation.",
    bestUses: [
      "Podcast discussions",
      "character work (quirky)",
      "informal explainers",
    ],
  },
  {
    id: "Sadachbia",
    gender: "male",
    pitch: "low",
    style: "authoritative",
    secondaryStyles: ["measured"],
    description:
      "Deeper male voice with a slight rasp or texture, exuding confidence and a \"cool,\" laid-back authority. Memorable and distinctive, with a touch of gravitas.",
    bestUses: [
      "Movie trailers",
      "edgy commercials",
      "character voice (tough guy/rebel)",
    ],
  },
  {
    id: "Sadaltager",
    gender: "male",
    pitch: "mid",
    style: "warm",
    secondaryStyles: ["bright"],
    description:
      "Friendly and enthusiastic male voice with a clear, mid-range pitch, well-suited for presentations. Engaging and professional, with good articulation.",
    bestUses: [
      "Corporate presentations",
      "training videos",
      "webinar hosting",
    ],
  },
  {
    id: "Schedar",
    gender: "male",
    pitch: "mid",
    style: "warm",
    secondaryStyles: [],
    description:
      "Friendly, mid-pitched male voice with an informal, approachable quality. Conveys a sense of being down-to-earth and relatable, easy to understand.",
    bestUses: ["Casual tutorials", "vlogs", "friendly product explainers"],
  },
  {
    id: "Sulafat",
    gender: "female",
    pitch: "mid",
    style: "warm",
    secondaryStyles: ["authoritative"],
    description:
      "Warm, confident female voice with a clear mid-range pitch, sounding persuasive and articulate. Projects intelligence and friendliness, with an engaging presence.",
    bestUses: ["Corporate narration", "e-learning", "persuasive marketing"],
  },
  {
    id: "Umbriel",
    gender: "male",
    pitch: "mid-low",
    style: "authoritative",
    secondaryStyles: ["warm"],
    description:
      "Smooth male voice with a mid-to-low pitch, conveying authority while remaining friendly and engaging. Excellent clarity for narration, with a trustworthy and knowledgeable tone.",
    bestUses: [
      "Documentary narration",
      "corporate storytelling",
      "audiobook narration",
    ],
  },
  {
    id: "Vindemiatrix",
    gender: "female",
    pitch: "mid-low",
    style: "measured",
    secondaryStyles: ["authoritative"],
    description:
      "Calm, thoughtful female voice with a mid-to-low pitch, sounding mature and composed. Conveys wisdom and a gentle authority, with a smooth, reassuring quality.",
    bestUses: [
      "Meditation guides",
      "narration for reflective content",
      "mature character voices",
    ],
  },
  {
    id: "Zephyr",
    gender: "female",
    pitch: "mid",
    style: "bright",
    secondaryStyles: ["warm"],
    description:
      "Energetic and bright female voice with a clear mid-range pitch, sounding perky and enthusiastic. Projects positivity and youthfulness, very engaging.",
    bestUses: ["Upbeat commercials", "children's content", "friendly IVR"],
  },
  {
    id: "Zubenelgenubi",
    gender: "male",
    pitch: "low",
    style: "authoritative",
    secondaryStyles: ["measured"],
    description:
      "Deep, resonant male voice conveying strong authority and seriousness. Commands attention with a powerful and measured delivery.",
    bestUses: [
      "Movie trailers (epic)",
      "formal announcements",
      "authoritative narration",
    ],
  },
];

// Sanity-check the catalog at module load. A typo in HOST_VOICE_ID or a
// duplicate id would otherwise surface only when a podcast is generated;
// this fails fast at import time so the dev server / Convex deploy refuses
// to come up rather than ship broken audio.
const _hostProfile = VOICE_CATALOG.find((v) => v.id === HOST_VOICE_ID);
if (!_hostProfile) {
  throw new Error(
    `VOICE_CATALOG is missing HOST_VOICE_ID="${HOST_VOICE_ID}". Add the host voice or update the constant.`,
  );
}
{
  const seen = new Set<string>();
  for (const v of VOICE_CATALOG) {
    if (seen.has(v.id)) {
      throw new Error(`VOICE_CATALOG has duplicate voice id "${v.id}"`);
    }
    seen.add(v.id);
  }
}

// Guest pool with the host removed so the guest can never collide with
// the host. Filtered once at module load — every pickGuestVoice call
// reads this snapshot.
export const GUEST_VOICE_POOL: readonly VoiceProfile[] = VOICE_CATALOG.filter(
  (v) => v.id !== HOST_VOICE_ID,
);
