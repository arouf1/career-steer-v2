import { z } from "zod";
import { EDITORIAL_VOICE_TAIL } from "./voice";

// Stage A of podcast generation: derives a career-aware persona prior from
// the guide's content before the dialogue is written. The output drives
// three downstream consumers, the script prompt's "how this guest sounds"
// block, the TTS speaker prompt's per-guest tone direction, and the voice
// picker's weighted bias.
//
// Per project rule: Gemini structured output rejects bound/array-length
// constraints, so the 1.0-5.0 range on traitPrior axes is enforced in the
// prompt body, not in the Zod schema. Do NOT add .min/.max/.int.
export const PersonaTraitsSchema = z.object({
  archetypeLabel: z.string(),
  functionalAreaInferred: z.string(),
  traitPrior: z.object({
    extraversion: z.number(),
    conscientiousness: z.number(),
    openness: z.number(),
    warmth: z.number(),
    formality: z.number(),
  }),
  speakingStyle: z.object({
    energy: z.enum(["measured", "animated", "reserved", "expressive"]),
    vocabulary: z.enum([
      "precise-technical",
      "accessible-plain",
      "industry-jargon",
      "casual-conversational",
    ]),
    sentenceLength: z.enum(["short", "medium", "flowing"]),
    humorFrequency: z.enum(["rare", "occasional", "frequent"]),
    anecdoteStyle: z.enum([
      "data-grounded",
      "human-stories",
      "process-oriented",
      "metaphor-heavy",
    ]),
  }),
  toneDirection: z.string(),
});
export type PersonaTraits = z.infer<typeof PersonaTraitsSchema>;

type ContentBundle = {
  overview: string;
  typicalSkills: string[];
  dayToDay: string;
  riskFactors: string[];
  whyConsider: string;
  regional: {
    us: { careerOutlook: string; learningPath: string[] };
    uk: { careerOutlook: string; learningPath: string[] };
  };
};

export function buildPersonaTraitsPrompt(args: {
  title: string;
  content: ContentBundle;
}): string {
  const { title, content } = args;
  return `
You are casting the guest for a short podcast episode about the career of "${title}". Before any dialogue is written, your job is to derive a credible *personality prior* for the guest, grounded in what this work actually demands of the people who do it well.

The aim is honest variation, not stereotype. Two people who do the same job can differ a lot, a bond trader and a wealth advisor are both "finance" and sound nothing alike. Use the role's day-to-day reality, not a caricature of the field.

Anti-patterns to actively avoid:
- Don't make every finance / compliance / engineering guest a buttoned-up Ivy alum.
- Don't make every marketing / sales / creative guest high-energy and bubbly.
- Don't reduce the guest to one trait. Real people are mixes, a measured analyst can still be funny; a high-energy operator can still be precise.

Output a structured persona with these fields:

archetypeLabel, 2 to 4 words describing the kind of working person this guest is. Examples (across unrelated jobs, just to calibrate register): "Thoughtful Analyst", "Energetic Connector", "Quiet Craftsperson", "Dry Operator", "Warm Mentor", "Restless Builder". Invent your own, don't copy these.

functionalAreaInferred, a short specific descriptor of the functional area this role lives in. Be specific. "quantitative finance" beats "finance"; "growth marketing" beats "marketing"; "site reliability engineering" beats "engineering".

traitPrior, five Big-Five-flavoured personality axes, each a number from 1.0 to 5.0 with one decimal place. 1.0 means "very low on this axis"; 5.0 means "very high"; 3.0 means "average". USE DECIMALS. Two guests for the same role must differ by at least 0.4 on at least two axes, round numbers are a sign you're defaulting to a stereotype, not actually thinking about this person.
  - extraversion (1.0-5.0): how much energy this person draws from being around people, talking, performing
  - conscientiousness (1.0-5.0): how naturally they orient toward planning, precision, follow-through
  - openness (1.0-5.0): how much they enjoy ideas, abstraction, new approaches versus tested ones
  - warmth (1.0-5.0): how openly affectionate or caring they are with the people around them
  - formality (1.0-5.0): how much their default register leans toward proper / polished versus casual / blunt

speakingStyle, categorical descriptors that govern how the dialogue should be written:
  - energy: "measured" | "animated" | "reserved" | "expressive"
  - vocabulary: "precise-technical" | "accessible-plain" | "industry-jargon" | "casual-conversational"
  - sentenceLength: "short" | "medium" | "flowing"
  - humorFrequency: "rare" | "occasional" | "frequent"
  - anecdoteStyle: "data-grounded" | "human-stories" | "process-oriented" | "metaphor-heavy"

toneDirection. ONE sentence (max two) written for a TTS director. Tells the audio model how this specific guest's voice should land in delivery. Examples (for unrelated roles, just to calibrate format): "Measured pace; sentences land deliberately; warmth comes from clarity, not enthusiasm." / "Quick rhythm, leaning forward; lets a laugh slip in when the joke lands; never theatrical." / "Soft and unhurried; comfortable with silence; warmth on the long vowels."

Source material to ground the persona in (themes from the role, not a brief to recite):
- What the work is and why it matters: ${content.overview}
- What the day actually looks like: ${content.dayToDay}
- What people doing this well need to be good at: ${content.typicalSkills.slice(0, 8).join(", ")}
- Honest considerations and pressures of the job: ${content.riskFactors.join(" | ")}
- Why someone might choose this path: ${content.whyConsider}

${EDITORIAL_VOICE_TAIL}

Output strictly as structured JSON matching the schema. Do not include any commentary outside the JSON.
`.trim();
}
