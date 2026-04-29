import { z } from "zod";

// Per project memory: Gemini structured output rejects bound/array-length
// constraints — keep this schema simple and enforce ranges in the prompt.
export const PodcastScriptSchema = z.object({
  guestGender: z.enum(["female", "male"]),
  guestName: z.string(),
  guestRole: z.string(),
  dialogue: z.array(
    z.object({
      speaker: z.enum(["host", "guest"]),
      text: z.string(),
    }),
  ),
});
export type PodcastScript = z.infer<typeof PodcastScriptSchema>;

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

const DIALOGUE_TARGET_WORDS = 700; // ~5 minutes at 150 wpm
const HOST_NAME = "Alice Clements";

export function buildPodcastScriptPrompt(args: {
  title: string;
  content: ContentBundle;
}): string {
  const { title, content } = args;
  return `
You are writing the script for a short conversational podcast episode about the career of "${title}". The episode is part of the Career Steer podcast — a friendly, no-fluff series that helps people understand what different careers are actually like.

The host is ${HOST_NAME}. She is warm, curious, conversational, and not afraid to ask the obvious question. She subtly mentions Career Steer (the app users are reading the guide on) once or twice — never salesy, just as the natural setting of the show.

The guest is a working ${title} you are about to invent. They have done the job for years and speak from experience, not from a textbook.

Hard rules:
- The guest is NOT aware of any "guide" or article. Neither host nor guest references "the guide", "this article", "this page", or anything like that. They are simply two people having a conversation. Themes from the source material show up naturally as topics they care about.
- Aim for roughly ${DIALOGUE_TARGET_WORDS} words of total spoken dialogue. Distribute fairly between host and guest, with the guest carrying slightly more (it's their expertise being explored).
- Use short, natural turns. Most turns should be one to four sentences. Avoid monologues.
- No stage directions, no "[laughs]" tags, no parentheticals. Just the spoken words.
- No em dashes or en dashes. Use commas, full stops, or new sentences.
- Do not list the typical skills or related roles in a recital. Bring those topics up the way real people do, by telling small stories or making side observations.
- The host opens with a brief welcome and quickly hands over to the guest. The guest closes the episode with a sentence of advice for someone considering this path. The host wraps with a one-line sign-off that mentions Career Steer.

Casting:
- Decide whether the guest is more plausibly a man or a woman, weighted by the realistic gender mix of people who actually do this job today. Lean into the demographic majority unless the role is genuinely balanced.
- Invent a credible full first-and-last name for the guest. Avoid stereotypical or alliterative names. Avoid names that match the topic (no "Brick" for a bricklayer). Pick something a real person could plausibly be called.
- Invent a one-line guest description: their current title, place, and rough years of experience. Example shape: "Senior bricklayer in Sheffield, eighteen years in the trade." Keep it specific.

Themes to weave in (pick the ones that fit the conversation, do not force all of them):
- Overview of the work and why it matters: ${content.overview}
- What the day actually looks like: ${content.dayToDay}
- Why someone might choose this path: ${content.whyConsider}
- Skills that matter most (use as inspiration, do not enumerate): ${content.typicalSkills.slice(0, 8).join(", ")}
- Honest considerations and risks: ${content.riskFactors.join(" | ")}
- Where the field is going (US perspective): ${content.regional.us.careerOutlook}
- Where the field is going (UK perspective): ${content.regional.uk.careerOutlook}
- How people typically get into it: ${[...content.regional.us.learningPath, ...content.regional.uk.learningPath].slice(0, 6).join(" | ")}

Output strictly as structured JSON matching the schema:
- guestGender: "female" or "male"
- guestName: full name as a string
- guestRole: one-line guest description (used as a TTS style hint)
- dialogue: ordered array of turns. Each turn has speaker ("host" or "guest") and text (the spoken words only).
`.trim();
}

// Style preamble passed as part of the TTS prompt to steer delivery.
// Stays under 1000 bytes — the dialogue itself takes the rest of the budget.
export function buildSpeakerPrompt(args: {
  guestName: string;
  guestRole: string;
}): string {
  return `You are voicing a friendly, candid podcast conversation between ${HOST_NAME}, the warm and curious host of the Career Steer podcast, and her guest, ${args.guestName} (${args.guestRole}). Keep the pace natural and conversational. Slight smile in the voice. Brief pauses between turns. ${HOST_NAME} sounds welcoming and engaged. ${args.guestName} sounds grounded, experienced, and matter-of-fact, with the easy authority of someone who has done the job for years.`;
}
