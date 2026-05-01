import { z } from "zod";

// Gemini 3.1 Pro through OpenRouter — matches v1 and the project's
// PERSONALIZATION/CONTENT model slug. Routed via `chatModel(OUTREACH_MODEL_ID,
// { zdr: true })` so structured + streaming both opt into ZDR.
export const OUTREACH_MODEL_ID = "google/gemini-3.1-pro-preview";

// Faster, cheaper sibling used to parse structured profile data out of
// raw LinkedIn snippet text. Same slug v2 already uses for branch + judge
// flows, so the model lands on Gemini 3 Flash via OpenRouter.
export const PEOPLE_EXTRACT_MODEL_ID = "google/gemini-3-flash-preview";

// Per memory `feedback_gemini_structured_output_schema_limits`:
// Gemini structured output rejects bound/length constraints. Keep this
// schema constraint-free; describe the bounds in the prompt instead.
export const PersonProfileSchema = z.object({
  people: z.array(
    z.object({
      name: z.string().describe("Full name of the person"),
      headline: z
        .string()
        .describe("Their LinkedIn headline or professional tagline"),
      currentRole: z.string().describe("Current job title"),
      currentCompany: z.string().describe("Current employer"),
      profileSummary: z
        .string()
        .describe(
          "2-3 sentence summary of their background, expertise, and career trajectory",
        ),
      relevanceReason: z
        .string()
        .describe(
          "1-2 sentences explaining why this person is relevant to a reader of the linked career guide",
        ),
    }),
  ),
});

export type PersonProfile = z.infer<
  typeof PersonProfileSchema
>["people"][number];

// ── Outreach intents ──────────────────────────────────────────────────────
// Each maps to a short framing the model uses to set the tone + ask. Keep
// keys lowercase + hyphenated; the UI passes them through as `outreachType`.

export const OUTREACH_FRAMING: Record<string, string> = {
  discovery:
    "The user is genuinely curious about this person's field and wants to learn about their day-to-day experience, what surprised them about the role, and what they wish they'd known earlier.",
  "career-advice":
    "The user is considering a career transition and wants this person's perspective on making a similar move - what skills transferred, what was hardest, and what they'd recommend.",
  "role-inquiry":
    "The user is interested in a specific open role at this person's company and wants to express genuine interest while learning more about the team, culture, and what success looks like in the role.",
  mentorship:
    "The user admires this person's career trajectory and would love to learn from them over time - not asking for a formal commitment, but expressing genuine respect and interest in their guidance.",
  "informational-interview":
    "The user would like a brief, focused conversation to learn about this person's career path, how they got where they are, and any advice for someone exploring this direction.",
  custom: "The user has a specific intent for reaching out (provided below).",
};

export type OutreachType =
  | "discovery"
  | "career-advice"
  | "role-inquiry"
  | "mentorship"
  | "informational-interview"
  | "custom";

export const OUTREACH_TYPES: ReadonlyArray<{
  id: OutreachType;
  label: string;
  hint: string;
}> = [
  {
    id: "discovery",
    label: "Discovery",
    hint: "Curious about their field and day-to-day",
  },
  {
    id: "career-advice",
    label: "Career advice",
    hint: "Considering a similar transition",
  },
  {
    id: "role-inquiry",
    label: "Role inquiry",
    hint: "Interested in an open role at their company",
  },
  {
    id: "mentorship",
    label: "Mentorship",
    hint: "Admire their trajectory; would value their guidance",
  },
  {
    id: "informational-interview",
    label: "Informational interview",
    hint: "Brief conversation about their career path",
  },
  {
    id: "custom",
    label: "Custom",
    hint: "Write your own intent",
  },
];

// ── Sender / recipient context shapes ─────────────────────────────────────
// The Convex action assembles these from the user's profile + the stored
// key_people row, then hands them to buildUserPrompt. Keeping the shape
// here (rather than threading through deep object types) lets the prompt
// module own the contract end-to-end.

export type OutreachSender = {
  firstName: string | null;
  professionalSummary?: string | null;
  currentTitle?: string | null;
  currentRole?: string | null;
  currentCompany?: string | null;
  topSkills?: string[];
  cvExcerpt?: string | null;
};

export type OutreachRecipient = {
  name: string;
  headline?: string | null;
  currentRole?: string | null;
  currentCompany?: string | null;
  profileSummary?: string | null;
  relevanceReason?: string | null;
};

// ── Prompts ───────────────────────────────────────────────────────────────

export function buildOutreachSystemPrompt(): string {
  return `You write highly personalised LinkedIn outreach messages. Your messages feel genuine, specific, and human - never templated or generic.

RULES:
- Write 150-250 words (LinkedIn message length)
- NEVER start with "I came across your profile" or any variant
- NEVER use generic flattery like "I'm really impressed by your work"
- Match formality to the seniority gap - peer-to-peer is casual; reaching up is more respectful but still warm
- End with a clear, low-pressure ask (not "I'd love to pick your brain")
- Use British English spelling
- Do NOT use long dashes or em dashes. Use short hyphens (-) instead.
- Start with a warm, natural greeting using the recipient's first name (e.g. "Hi Sarah," or "Hey David,")
- End with a friendly sign-off using the sender's first name (e.g. "Best, Alex" or "Cheers, Sam")
- Do NOT use placeholder brackets like [Your Name] or [Company]
- Be conversational, not corporate

CRITICAL - NO FABRICATION:
- ONLY reference facts explicitly provided in the context below. Do NOT invent or embellish details.
- Do NOT claim the sender has followed, read, or engaged with the recipient's content unless explicitly stated.
- Do NOT fabricate specific projects, publications, talks, newsletters, or achievements for either person.
- Do NOT invent shared connections, mutual interests, or experiences that aren't in the provided data.
- If the data is sparse, keep the message shorter and more general rather than filling gaps with made-up details.
- Everything in the message must be defensible if the recipient asks about it.`;
}

export function buildOutreachUserPrompt(args: {
  sender: OutreachSender;
  recipient: OutreachRecipient;
  sourceContext: string;
  outreachType: OutreachType;
  customIntent?: string;
}): string {
  const { sender, recipient, sourceContext, outreachType, customIntent } = args;

  const framing =
    OUTREACH_FRAMING[outreachType] ?? OUTREACH_FRAMING["discovery"];

  const lines: string[] = [];
  lines.push(`OUTREACH GOAL:\n${framing}`);
  if (outreachType === "custom" && customIntent && customIntent.trim()) {
    lines.push(`Custom intent: ${customIntent.trim()}`);
  }

  // Sender block
  const senderLines: string[] = [];
  if (sender.professionalSummary)
    senderLines.push(`Professional summary: ${sender.professionalSummary}`);
  const currentTitle = sender.currentTitle ?? sender.currentRole ?? null;
  if (currentTitle) senderLines.push(`Current title: ${currentTitle}`);
  if (sender.currentRole && sender.currentCompany) {
    senderLines.push(
      `Current role: ${sender.currentRole} at ${sender.currentCompany}`,
    );
  }
  if (sender.topSkills && sender.topSkills.length > 0) {
    senderLines.push(
      `Key skills: ${sender.topSkills.slice(0, 8).join(", ")}`,
    );
  }
  if (sender.cvExcerpt) {
    senderLines.push(`CV excerpt: ${sender.cvExcerpt.substring(0, 800)}`);
  }
  senderLines.push(`Sender's name: ${sender.firstName ?? "the sender"}`);
  lines.push(`ABOUT THE SENDER:\n${senderLines.join("\n")}`);

  // Recipient block
  const recipientLines: string[] = [`Name: ${recipient.name}`];
  if (recipient.headline) recipientLines.push(`Headline: ${recipient.headline}`);
  if (recipient.currentRole && recipient.currentCompany) {
    recipientLines.push(
      `Current role: ${recipient.currentRole} at ${recipient.currentCompany}`,
    );
  }
  if (recipient.profileSummary) {
    recipientLines.push(`Profile summary: ${recipient.profileSummary}`);
  }
  if (recipient.relevanceReason) {
    recipientLines.push(`Relevance: ${recipient.relevanceReason}`);
  }
  lines.push(`ABOUT THE RECIPIENT:\n${recipientLines.join("\n")}`);

  // Source
  lines.push(`SOURCE CONTEXT:\n${sourceContext}`);

  lines.push("Write the outreach message now.");
  return lines.join("\n\n");
}

// ── People extraction prompt ──────────────────────────────────────────────

export function buildPeopleExtractionSystemPrompt(
  userProfileSummary: string | null,
): string {
  const base = `You extract structured profile data from raw LinkedIn search snippets. The user is researching a career and is looking at people who currently work in this field. For each profile passed in, return:

- name: full name as it appears
- headline: the LinkedIn headline / tagline
- currentRole: current job title (best guess from the snippet)
- currentCompany: current employer
- profileSummary: 2-3 sentences summarising their background and trajectory, written in neutral third-person
- relevanceReason: 1-2 sentences saying why a reader of this career guide would benefit from speaking to them

Only use facts present in the snippet. Do NOT invent achievements, employers, or relationships. If a field is genuinely unknown, give a short honest placeholder rather than fabricating.`;

  if (userProfileSummary && userProfileSummary.trim()) {
    return `${base}

For relevanceReason, weight the user's own background where it is informative:
${userProfileSummary.trim()}`;
  }
  return base;
}

export function buildPeopleExtractionUserPrompt(args: {
  guideTitle: string;
  profiles: Array<{ url: string; title: string; text: string }>;
}): string {
  const { guideTitle, profiles } = args;
  const blocks = profiles
    .map(
      (p, i) =>
        `--- Profile ${i + 1} ---\nURL: ${p.url}\nTitle: ${p.title}\nContent: ${p.text}`,
    )
    .join("\n\n");
  return `Career guide topic: ${guideTitle}\n\nExtract structured profile information from these LinkedIn search results. Return one entry per profile, in the same order.\n\n${blocks}`;
}
