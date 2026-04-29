// Host is fixed across every guide so users learn Alice's voice.
// Change voice in one place to retune the whole product.
export const HOST = {
  name: "Alice Clements",
  voice: "Aoede",
} as const;

export type Gender = "female" | "male";

// Voices available on gemini-3.1-flash-tts-preview, partitioned by gender,
// host voice excluded so the guest can never collide with Alice.
export const FEMALE_VOICES = [
  "Achernar",
  "Autonoe",
  "Callirrhoe",
  "Despina",
  "Erinome",
  "Gacrux",
  "Kore",
  "Laomedeia",
  "Leda",
  "Pulcherrima",
  "Sulafat",
  "Vindemiatrix",
  "Zephyr",
] as const;

export const MALE_VOICES = [
  "Achird",
  "Algenib",
  "Algieba",
  "Alnilam",
  "Charon",
  "Enceladus",
  "Fenrir",
  "Iapetus",
  "Orus",
  "Puck",
  "Rasalgethi",
  "Sadachbia",
  "Sadaltager",
  "Schedar",
  "Umbriel",
  "Zubenelgenubi",
] as const;

export function pickGuestVoice(gender: Gender): string {
  // Both pools already exclude HOST.voice by curation, but filter anyway so
  // a future host swap can't accidentally collide.
  const host: string = HOST.voice;
  const pool = (gender === "female" ? FEMALE_VOICES : MALE_VOICES).filter(
    (v) => v !== host,
  );
  return pool[Math.floor(Math.random() * pool.length)];
}
