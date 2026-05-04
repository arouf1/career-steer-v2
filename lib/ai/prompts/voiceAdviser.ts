import { z } from "zod";

// Post-call summary. Gemini 3 Flash via OpenRouter — same slug as outreach
// (short structured extraction, high-volume).
//
// Per memory `feedback_gemini_structured_output_schema_limits`: Gemini
// structured output rejects bound/length constraints, so this schema is
// constraint-free. Describe the bounds in the prompt instead.
export const VOICE_SUMMARY_MODEL_ID = "google/gemini-3-flash-preview";

export const DeepDiveSummarySchema = z.object({
  title: z
    .string()
    .describe("Natural-language title for this conversation, ~6-10 words"),
  summary: z
    .string()
    .describe("2-3 sentence overview of what was discussed and decided"),
  insights: z
    .array(z.string())
    .describe(
      "Key insights the user discovered or that the adviser surfaced; each one short, plain English",
    ),
  sentiment: z
    .union([z.literal("positive"), z.literal("neutral"), z.literal("negative")])
    .describe("Overall emotional sentiment of the conversation"),
  keyTopics: z
    .array(z.string())
    .describe(
      "3-7 short noun phrases that label the main topics covered (e.g. 'salary expectations', 'portfolio gaps')",
    ),
  actionPoints: z
    .array(
      z.object({
        priority: z.union([
          z.literal("high"),
          z.literal("medium"),
          z.literal("low"),
        ]),
        description: z
          .string()
          .describe("Concrete action the user committed to or should take"),
      }),
    )
    .describe("Up to 5 action points; empty array if none surfaced"),
  userEngagement: z
    .union([z.literal("high"), z.literal("medium"), z.literal("low")])
    .describe("How engaged the user was in the conversation"),
  followUpNeeded: z
    .boolean()
    .describe(
      "True if the conversation hit a hard stop or surfaced questions the adviser couldn't answer",
    ),
  followUpSuggestions: z
    .array(z.string())
    .describe(
      "Specific things to explore next time; empty array if none. Each one is a short suggestion phrase.",
    ),
  guideRelevance: z
    .union([
      z.literal("on-topic"),
      z.literal("partially-relevant"),
      z.literal("off-topic"),
    ])
    .describe(
      "Whether the conversation actually engaged with the career guide it was anchored to, or drifted away",
    ),
});

export type DeepDiveSummary = z.infer<typeof DeepDiveSummarySchema>;

// ── Live-session system instructions (real-time persona, NOT for the
// post-call summary above). Built fresh per session in
// convex/voiceCallContext.ts and shipped to Gemini Live in the setup message.

type AggregatedCitation = {
  url: string;
  title: string;
  publisher?: string;
  sectionPath: string;
};

type GuideContext = {
  title: string;
  overview: string;
  dayToDay?: string;
  whyConsider?: string;
  riskFactors?: string[];
  typicalSkills?: string[];
  region: {
    key: "us" | "uk";
    label: string;
    salary?: { entry?: string; mid?: string; senior?: string };
    careerOutlook?: string;
    learningPath?: string[];
  };
};

type ProfileContext = {
  candidateName: string;
  narrativeSummary?: string;
  careerStage?: string;
  careerArchetype?: string;
  totalYearsExperience?: number;
  currentTitle?: string;
  currentCompany?: string;
  topSkills: string[]; // 5-10 canonicalized
  motivations: string[]; // short labels
  workStyle?: string;
};

export type VoiceAdviserPromptContext = {
  guide: GuideContext;
  profile?: ProfileContext;
  citations: AggregatedCitation[];
};

export function voiceAdviserPrompt(ctx: VoiceAdviserPromptContext): string {
  const { guide, profile, citations } = ctx;
  const candidateName = profile?.candidateName ?? "there";

  const aboutCandidate = profile
    ? buildCandidateBlock(profile)
    : "Profile data isn't available — they're an early-career or unauthenticated user. Open with curiosity rather than assumptions about their background.";

  const regionalSalary = guide.region.salary
    ? `Salary band (${guide.region.label}): entry ${guide.region.salary.entry ?? "—"}, mid ${guide.region.salary.mid ?? "—"}, senior ${guide.region.salary.senior ?? "—"}`
    : "";

  const dayToDay = guide.dayToDay
    ? `\nDay-to-day reality: ${truncate(guide.dayToDay, 600)}`
    : "";
  const whyConsider = guide.whyConsider
    ? `\nWhy people consider it: ${truncate(guide.whyConsider, 400)}`
    : "";
  const skills = guide.typicalSkills?.length
    ? `\nTypical skills: ${guide.typicalSkills.slice(0, 10).join(", ")}`
    : "";
  const risks = guide.riskFactors?.length
    ? `\nKnown risks: ${guide.riskFactors.slice(0, 5).join("; ")}`
    : "";
  const outlook = guide.region.careerOutlook
    ? `\nCareer outlook (${guide.region.label}): ${truncate(guide.region.careerOutlook, 400)}`
    : "";
  const learningPath = guide.region.learningPath?.length
    ? `\nLearning path (${guide.region.label}): ${guide.region.learningPath.slice(0, 6).join(" → ")}`
    : "";

  const sourcesBlock = citations.length
    ? `\n\n**Sources backing this guide (you can name publishers naturally — never read URLs aloud):**\n${citations
        .slice(0, 10)
        .map(
          (c, i) =>
            `${i + 1}. ${c.publisher ?? "—"} — "${truncate(c.title, 120)}" (covers: ${c.sectionPath})`,
        )
        .join("\n")}`
    : "";

  return `**Persona:**
You are ${candidateName}'s career adviser. You know career paths well and you genuinely care about helping them think clearly. You speak like a knowledgeable friend — warm, direct, and honest. You have a British English accent and a calm, conversational pace. You never lecture and you never monologue.

**What this conversation is about:**
This is a discovery call about a specific career path: **${guide.title}**.

Guide overview: ${truncate(guide.overview, 600)}${dayToDay}${whyConsider}${skills}${risks}${outlook}${learningPath}
${regionalSalary ? `\n${regionalSalary}` : ""}${sourcesBlock}

**About ${candidateName}:**
${aboutCandidate}

**Conversational rules:**

1. **Greet them warmly.** Two short sentences, not three. Ask how they're doing. Do not name the career path in your greeting — let them say what brought them here.

2. **Find out what drew them to this path.** Listen. Do not paraphrase or repeat what they say. Add new value with every response.

3. **Anchor in their background.** When you discuss fit, refer to their actual experience and skills (above) — not generic career advice. Be honest about strengths and gaps. Don't oversell their fit if it's a stretch; don't undersell if they're well-positioned.

4. **Use the guide's grounded facts.** When salary, day-to-day, learning path, or outlook come up, draw from the guide content above. If the conversation moves to something live or specific (a particular company, recent layoff news), use Google Search.

5. **Cite naturally when claims need backing.** "According to a recent ONS report…" or "the BLS puts the median around…". Never read URLs aloud. Never list source numbers.

6. **Keep responses under 25 seconds when spoken.** That's roughly 60 words. If you have more to say, ask whether they want to go deeper before unloading.

7. **Follow their lead.** They might want to talk about negotiation, family logistics, imposter syndrome, transferable skills, or whether to retrain at all. Go where they want to go.

**Guardrails:**
- No financial advice or promises about hiring outcomes.
- No salary "guarantees" — frame all numbers as ranges and benchmarks.
- If they ask something genuinely outside career territory, gently redirect.
- If they sound anxious, slow down. Reassure without being dismissive.
- Never repeat what the user just said back to them.
- Never read out loud the source list above. It's context for *your* claims, not a script.`;
}

function buildCandidateBlock(p: ProfileContext): string {
  const lines: string[] = [];
  if (p.narrativeSummary) {
    lines.push(p.narrativeSummary);
  }
  const role = p.currentTitle
    ? `${p.currentTitle}${p.currentCompany ? ` at ${p.currentCompany}` : ""}`
    : null;
  if (role) lines.push(`Current role: ${role}`);
  if (p.careerStage) lines.push(`Stage: ${p.careerStage}`);
  if (p.careerArchetype) lines.push(`Archetype: ${p.careerArchetype}`);
  if (typeof p.totalYearsExperience === "number") {
    lines.push(`Total experience: ~${Math.round(p.totalYearsExperience)} years`);
  }
  if (p.topSkills.length) {
    lines.push(`Top skills: ${p.topSkills.slice(0, 10).join(", ")}`);
  }
  if (p.motivations.length) {
    lines.push(`What drives them: ${p.motivations.join(", ")}`);
  }
  if (p.workStyle) lines.push(`Work style: ${p.workStyle}`);
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}
