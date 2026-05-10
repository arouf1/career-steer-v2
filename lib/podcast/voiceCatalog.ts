// Catalog of Gemini 2.5 Pro / Flash TTS prebuilt voices. Single source of
// truth for voice gender, pitch, and style, the host declaration and the
// guest-voice picker (lib/podcast/voices.ts) both read from here.
//
// Where the genders and descriptions came from:
//   Google does not publish per-voice gender in its public docs or API; the
//   AI Studio dropdown shows it only in the UI. The community-maintained
//   index at https://gemini-tts.com/voices is the de-facto reference: each
//   voice card carries a ♀/♂ marker plus a primary descriptor and pitch
//   bucket. The `gender`, `pitch`, and `description` fields here mirror
//   those cards; `style` is our internal mapping into the four picker
//   buckets (warm / bright / measured / authoritative).
//
//   An earlier version of this catalog used a third-party source that had
//   Gemini Pro listen to samples and infer gender. That produced six wrong
//   tags (Algenib, Achernar, Achird, Autonoe, Gacrux, Pulcherrima) which
//   surfaced as audible gender mismatches in shipped podcasts. Catalog was
//   re-grounded on gemini-tts.com on 2026-05-04.
//
// What the picker actually uses:
//   `gender` filters the pool to match the LLM-decided guest gender;
//   `style` and `secondaryStyles` drive the weighted bias against the
//   persona's energy / formality. `pitch` is informational today, kept for
//   future per-pitch matching (e.g. youth-skewed roles preferring mid-high
//   voices).
//
// Re-tagging guidance:
//   If a shipped episode lands on a voice that feels miscast, cross-check
//   gemini-tts.com first (gender + descriptor), then retag here, the
//   picker re-derives buckets at module load. Don't add a voice that isn't
//   actually exposed by Gemini TTS; there is no fallback if the API
//   rejects the name.

export type VoiceGender = "female" | "male";

// Primary bucket, single most-defining quality of the voice.
export type VoiceStyle = "warm" | "bright" | "measured" | "authoritative";

// Pitch hint, informational today, used for catalog readability and
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
    gender: "female",
    pitch: "mid-high",
    style: "warm",
    secondaryStyles: ["bright"],
    description:
      "Soft and warm female voice with a higher pitch. Friendly and approachable, with a gentle, welcoming quality.",
    bestUses: [
      "Friendly corporate narration",
      "podcast intros",
      "explainer videos",
    ],
  },
  {
    id: "Achird",
    gender: "male",
    pitch: "mid-low",
    style: "warm",
    secondaryStyles: ["bright"],
    description:
      "Friendly and kind male voice with a lower-middle pitch. Approachable and easy-going, with a clear conversational delivery.",
    bestUses: [
      "Explainer videos",
      "friendly product demos",
      "informal corporate narration",
    ],
  },
  {
    id: "Algenib",
    gender: "male",
    pitch: "low",
    style: "authoritative",
    secondaryStyles: ["warm"],
    description:
      "Gravelly and textured male voice with a lower pitch. Carries a lived-in, experienced quality, gravitas with warmth and rasp.",
    bestUses: [
      "Documentary narration",
      "audiobook narration (memoir, character)",
      "podcast hosting with gravitas",
    ],
  },
  {
    id: "Algieba",
    gender: "male",
    pitch: "low",
    style: "warm",
    secondaryStyles: ["measured"],
    description:
      "Smooth and flowing male voice with a lower pitch. Steady, unhurried delivery, calm warmth without the rasp of Algenib.",
    bestUses: [
      "Audiobook narration",
      "long-form podcast hosting",
      "calm corporate storytelling",
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
    gender: "female",
    pitch: "mid",
    style: "bright",
    secondaryStyles: ["warm"],
    description:
      "Bright and cheerful female voice with a clear mid-range pitch. Energetic and engaging, with a positive, upbeat delivery.",
    bestUses: [
      "Upbeat commercials",
      "tutorials",
      "friendly customer-facing content",
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
    gender: "female",
    pitch: "mid",
    style: "measured",
    secondaryStyles: ["authoritative"],
    description:
      "Mature and steady female voice with a clear mid-range pitch. Composed and thoughtful, projecting experience and quiet authority.",
    bestUses: [
      "Documentary narration",
      "corporate training",
      "serious editorial content",
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
    gender: "male",
    pitch: "mid",
    style: "bright",
    secondaryStyles: ["authoritative"],
    description:
      "Forward and enterprising male voice with a clear mid-range pitch. Confident and direct, with an enthusiastic, decisive delivery.",
    bestUses: [
      "Promotional content",
      "presentations",
      "leadership-style narration",
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
// the host. Filtered once at module load, every pickGuestVoice call
// reads this snapshot.
export const GUEST_VOICE_POOL: readonly VoiceProfile[] = VOICE_CATALOG.filter(
  (v) => v.id !== HOST_VOICE_ID,
);
