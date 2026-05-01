import { z } from "zod";

// Per project memory: Gemini structured output rejects bound/array-length
// constraints — keep this schema simple and enforce ranges in the prompt.
export const PodcastScriptSchema = z.object({
  episodeTitle: z.string(),
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
  forbiddenGuestNames: string[];
}): string {
  const { title, content, forbiddenGuestNames } = args;
  // Cap the injected list. Each name is ~15 chars, so 200 names ≈ 3 KB —
  // well under any prompt budget. Most-recent-first wouldn't matter since
  // the goal is "don't reuse any of these," but we slice from the start to
  // keep the behaviour deterministic across attempts.
  const recent = forbiddenGuestNames.slice(0, 200);
  const forbiddenBlock = recent.length
    ? `

Used guest names (do NOT reuse any of these full names, case-insensitively):
${recent.join(", ")}

Also vary the FIRST name — do not reuse a first name from that list unless absolutely unavoidable. Every episode should feature a distinct-feeling person.`
    : "";
  return `
You are writing the script for a short conversational podcast episode about the career of "${title}". The episode is part of Career Cast — a friendly, no-fluff series that helps people understand what different careers are actually like.

The host is ${HOST_NAME}. She is warm, curious, conversational, and not afraid to ask the obvious question. She has a dry, mostly-affectionate sense of humour and isn't above a gentle tease. She subtly mentions Career Steer (the app users are reading the guide on) once or twice — never salesy, just as the natural setting of the show.

The guest is a working ${title} you are about to invent. They have done the job for years and speak from experience, not from a textbook. They're comfortable enough with themselves to laugh at the absurd parts of the job, including their own younger-self mistakes.

What the conversation should feel like:
- Two people who actually like each other. They riff. They have small, real reactions ("oh god, yeah", "wait, really?", "ha, that's brutal", "right? right?!").
- Gentle teasing in both directions. Self-deprecation lands well — let the guest poke fun at one of their own past mistakes.
- One small, warm disagreement that resolves quickly: the host pushes back lightly on something the guest claims, and they meet in the middle.
- One callback: the host references something the guest said earlier ("you mentioned X — does that still happen?") to show she's actually listening.
- Real laughter, not performative. Use [laughs] only when something genuinely lands as funny in context.

Hard rules:
- The guest is NOT aware of any "guide" or article. Neither host nor guest references "the guide", "this article", "this page", or anything like that. They are simply two people having a conversation. Themes from the source material show up naturally as topics they care about.
- Aim for roughly ${DIALOGUE_TARGET_WORDS} words of total spoken dialogue. Distribute fairly between host and guest, with the guest carrying slightly more (it's their expertise being explored).
- Use short, natural turns. Most turns should be one to four sentences. Avoid monologues. Real people interrupt themselves, trail off, change tack mid-thought — write that.
- No em dashes or en dashes. Use commas, full stops, or new sentences.
- Do not list the typical skills or related roles in a recital. Bring those topics up the way real people do, by telling small stories or making side observations.
- The host opens with a brief welcome and quickly hands over to the guest. The guest closes the episode with a sentence of advice for someone considering this path. The host wraps with a one-line sign-off that mentions Career Cast.

Sound design — markup tags inline in the text:
The TTS engine interprets a small set of bracketed tags as audio cues, NOT as words to read aloud. Use them sparingly so they land. They go inside the spoken text, e.g. "Wait, really? [laughs] That's the worst." or "Yeah, that one stings. [sigh] Took me a while to get over it."

ALLOWED non-speech sounds:
- [laughs] — a real, amused laugh. Use 2 to 4 times across the whole episode total, only when something genuinely funny lands.
- [sigh] — a soft, brief sigh. Use 0 to 2 times, when acknowledging something hard or weighty about the job.
- [uhm] — a small natural hesitation. Use 0 to 2 times, when the speaker is genuinely thinking.

ALLOWED pacing:
- [short pause] — comma-length break. Use rarely, where punctuation alone wouldn't carry it.
- [medium pause] — sentence-length break. Use 0 to 2 times for a thinking beat.
- [long pause] — dramatic pause around one second. Use at most once across the whole episode, only if there's a real beat that calls for it.

FORBIDDEN tags (these get read aloud as words, which sounds broken):
- Do NOT use [scared], [curious], [bored], [excited], [happy], [sad], [angry], or any other emotional-adjective tag.
- Do NOT use [whispering], [shouting], [robotic], [sarcasm], or [extremely fast].
- Do NOT add stage directions in parentheses like (laughing), (softly), or (smiling). Only the bracketed tags listed above.

Casting:
- Decide whether the guest is more plausibly a man or a woman, weighted by the realistic gender mix of people who actually do this job today. Lean into the demographic majority unless the role is genuinely balanced.
- Invent a credible full first-and-last name for the guest. Avoid stereotypical or alliterative names. Avoid names that match the topic (no "Brick" for a bricklayer). Pick something a real person could plausibly be called.${forbiddenBlock}
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

Episode title:
- Write an episode title that hooks. Three to seven words, no quotes, no colon-prefix like "Career Cast:" (the show name is already shown above the title).
- It should sound like a magazine teaser or a podcast tile, not a textbook chapter. It can be a fragment, a question, or a punchy statement. It should imply a story, a tension, or a behind-the-scenes angle.
- Avoid the words "career", "guide", "interview", and "everything you need to know". Avoid the literal job title as the entire title (e.g., do NOT just write the role name). The job title may appear inside the hook if it earns its place.
- Examples of the right register (for unrelated jobs, just to calibrate tone): "The job behind the smile", "Why I almost quit at thirty", "Eighteen years of broken backs", "What the brochure leaves out", "The shift no one warns you about".

Output strictly as structured JSON matching the schema:
- episodeTitle: short hook string (see "Episode title" rules above)
- guestGender: "female" or "male"
- guestName: full name as a string
- guestRole: one-line guest description (used as a TTS style hint)
- dialogue: ordered array of turns. Each turn has speaker ("host" or "guest") and text. The text is exactly what the speaker says, with bracketed tags inline at the moments they should fire.
`.trim();
}

// Backfill helper: produces just an episodeTitle for podcasts that were
// synthesized before episodeTitle existed in the schema. Grounded in the
// already-recorded transcript so the hook actually reflects what was said.
export const EpisodeTitleSchema = z.object({
  episodeTitle: z.string(),
});

export function buildEpisodeTitleBackfillPrompt(args: {
  title: string;
  guestName: string;
  guestRole: string;
  transcript: { speaker: "host" | "guest"; text: string }[];
}): string {
  const dialogue = args.transcript
    .map((t) => `${t.speaker === "host" ? HOST_NAME : args.guestName}: ${t.text}`)
    .join("\n");
  return `
Below is a recorded podcast episode of Career Cast — a friendly, no-fluff series about what different careers are actually like. The episode is about the career of "${args.title}" with guest ${args.guestName} (${args.guestRole}).

Your job is to write a hook-y episode title for it.

Title rules:
- Three to seven words. No quotes. No colon-prefix like "Career Cast:" — the show name is shown above the title in the UI.
- Sound like a magazine teaser or a podcast tile, not a textbook chapter. A fragment, a question, or a punchy statement. Imply a story, a tension, or a behind-the-scenes angle.
- Avoid the words "career", "guide", "interview", and "everything you need to know".
- Avoid the literal job title as the entire title. The job title may appear inside the hook only if it earns its place.
- The title MUST reflect something that actually happens in the conversation below — a moment, a tension, a memorable line. Do not invent angles that aren't in the transcript.

Transcript:
${dialogue}

Output strictly as structured JSON with a single field "episodeTitle".
`.trim();
}

// Director's note passed as the style preamble of the TTS prompt. Steers
// delivery: chemistry, easy rhythm, real laughter where the script's
// markup tags fire. Stays well under the per-field 4000-byte cap; the
// dialogue takes most of the combined budget.
export function buildSpeakerPrompt(args: {
  guestName: string;
  guestRole: string;
}): string {
  return `Voice this as a candid, warm podcast conversation between two people who actually like each other: ${HOST_NAME}, the host of Career Cast, and her guest, ${args.guestName} (${args.guestRole}). Easy rhythm, genuine reactions, comfortable pauses where they belong. ${HOST_NAME} sounds welcoming, curious, dry-humoured. ${args.guestName} sounds grounded and unhurried, with the easy authority of someone who has done the job for years and isn't trying to impress anyone. Where the script contains [laughs], react with a real amused laugh fitting the moment, never forced. Where it contains [sigh] or [uhm], deliver a small natural beat. Where it contains [short pause], [medium pause], or [long pause], hold the silence. Read everything else as continuous, conversational speech — never broadcast voice, never stiff.`;
}
