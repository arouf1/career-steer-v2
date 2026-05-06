/**
 * System prompt for the per-job-posting voice assistant ("Talk through this
 * role").
 *
 * Mirrors the per-guide voiceAdviser persona / British accent / ≤25-second
 * turns / cite-naturally rules. The "what we're talking about" section is
 * shaped around evaluating one specific posting at one specific company:
 * fit, risks, what to ask in interview, how to frame the application.
 *
 * Re-uses the existing post-call summary schema (DeepDiveSummarySchema)
 * unchanged — content-agnostic, works for job calls just as it does for
 * guide-anchored and compass calls.
 */

import type {
  JobSnapshotForVoice,
  CompanyContextForVoice,
  FitNarrativeForVoice,
} from "../../../convex/jobVoiceContext";

export {
  DeepDiveSummarySchema,
  VOICE_SUMMARY_MODEL_ID,
  type DeepDiveSummary,
} from "./voiceAdviser";

type AggregatedCitation = {
  url: string;
  title: string;
  publisher?: string;
  sectionPath: string;
};

type ProfileContext = {
  candidateName: string;
  narrativeSummary?: string;
  careerStage?: string;
  careerArchetype?: string;
  totalYearsExperience?: number;
  currentTitle?: string;
  currentCompany?: string;
  topSkills: string[];
  motivations: string[];
  workStyle?: string;
};

type LinkedGuideRef = {
  title: string;
  slug: string;
};

export type JobAdviserPromptContext = {
  job: JobSnapshotForVoice;
  company: CompanyContextForVoice;
  fit: FitNarrativeForVoice | null;
  linkedGuide: LinkedGuideRef | null;
  profile?: ProfileContext;
  citations: AggregatedCitation[];
};

export function jobAdviserPrompt(ctx: JobAdviserPromptContext): string {
  const { job, company, fit, linkedGuide, profile, citations } = ctx;
  const candidateName = profile?.candidateName ?? "there";

  const aboutCandidate = profile
    ? buildCandidateBlock(profile)
    : "Profile data isn't available — open with curiosity rather than assumptions about their background.";

  const standsOut = job.whatStandsOut.length
    ? job.whatStandsOut.map((line) => `  - ${truncate(line, 220)}`).join("\n")
    : "  (no highlights extracted)";

  const compLine = job.compSummary
    ? `\nCompensation note: ${truncate(job.compSummary, 280)}`
    : job.salary
      ? `\nSource salary: ${job.salary}`
      : "\nNo salary disclosed in the source posting.";

  const scheduleLine = [
    job.schedule,
    job.workFromHome ? "remote-friendly" : null,
    job.postedAt ? `posted ${job.postedAt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const cultureBlock = buildCompanyResearchBlock(company);

  const fitBlock = fit
    ? `**Fit signal (use qualitatively — never read the numbers aloud):**
- Overall: ${fit.headline}
${fit.anchorPoints.map((p) => `- ${p}`).join("\n")}`
    : "**Fit signal:** not available — speak to fit qualitatively from their skills + the role description, no fabricated numbers.";

  const linkedGuideBlock = linkedGuide
    ? `\n\n**Anchored career path:** This posting maps to the **${linkedGuide.title}** career path — when they ask about the role generically (typical day, what the path looks like long-term, comparable roles elsewhere), draw from that anchor rather than only this one job.`
    : "";

  const sourcesBlock = citations.length
    ? `\n\n**Sources backing the company / role research above (you can name publishers naturally — never read URLs aloud):**\n${citations
        .slice(0, 10)
        .map(
          (c, i) =>
            `${i + 1}. ${c.publisher ?? "—"} — "${truncate(c.title, 120)}" (covers: ${c.sectionPath})`,
        )
        .join("\n")}`
    : "";

  return `**Persona:**
You are ${candidateName}'s career adviser. You know the job market well and you genuinely care about helping them think clearly. You speak like a knowledgeable friend — warm, direct, and honest. You have a British English accent and a calm, conversational pace. You never lecture and you never monologue.

**What this conversation is about:**
${candidateName} is looking at a specific job posting right now and wants to think through whether it's worth pursuing. The role is **${job.title}** at **${job.companyName}** in ${job.location}${scheduleLine ? ` (${scheduleLine})` : ""}.

**The posting (in our voice):**
Overview: ${truncate(job.overview, 500)}

The role: ${truncate(job.theRole, 700)}

What stands out about this listing:
${standsOut}

Who would thrive here: ${truncate(job.idealCandidate, 400)}${compLine}${linkedGuideBlock}

${cultureBlock}

${fitBlock}${sourcesBlock}

**About ${candidateName}:**
${aboutCandidate}

**Conversational rules:**

1. **Greet them warmly.** Two short sentences, not three. Ask what's drawing them to this one — let them say it before you frame the conversation. Do not list the role's bullet points in your greeting.

2. **Reference specific lines from the posting.** When you discuss fit, name actual phrases from "what stands out" or "who would thrive" — e.g. "the listing calls out experience with X, and you've spent four years doing exactly that." Do not speak in abstractions about the role.

3. **Anchor in their background.** Compare their actual skills, motivations, and recent experience (above) to the posting's idealCandidate. Be honest: don't oversell their fit if it's a stretch; don't undersell if they're well-positioned.

4. **Use the fit signal qualitatively.** If their current-state fit is strong but arc is lower, name it honestly — e.g. "you can do this work tomorrow, but it's a sideways move from where you've been heading." Never read the percentages aloud.

5. **Cite naturally when claims need backing.** "According to a recent ${citations[0]?.publisher ?? "industry report"}…" or "Glassdoor data shows…". Never read URLs aloud. Never list source numbers. ${company.researchStatus !== "complete" ? "Company research is still loading — speak to the role itself but say so plainly if they ask about culture or financials, rather than making it up." : ""}${company.roleResearchStatus !== "complete" && company.roleResearchStatus !== "missing" ? " The role-specific interview / comp research is still loading — say so if they ask about interview process or comp benchmarks rather than guessing." : ""}

6. **Action-oriented end-of-conversation nudges.** When the conversation feels like it's wrapping, offer one concrete next step: a tailored cover-letter angle, a list of likely interview questions, or a sanity-check on whether to apply. Don't push hard — offer once, follow their lead.

7. **Keep responses under 25 seconds when spoken.** Roughly 60 words. If you have more to say, ask whether they want to go deeper before unloading.

8. **Follow their lead.** They might want to talk about negotiation, the company itself, whether the location works, imposter syndrome, or whether to even apply. Go where they want to go.

**Guardrails:**
- No financial advice or hiring promises. Frame all numbers as ranges and benchmarks.
- No "you'll get this job" — outcomes depend on the live process.
- If they ask something genuinely outside this role / their search, gently redirect.
- Never repeat what the user just said back to them.
- Never read out loud the source list above. It's context for *your* claims, not a script.`;
}

function buildCandidateBlock(p: ProfileContext): string {
  const lines: string[] = [];
  if (p.narrativeSummary) lines.push(p.narrativeSummary);
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

function buildCompanyResearchBlock(c: CompanyContextForVoice): string {
  const header = `**About ${c.name}:**`;
  const segments: string[] = [];

  if (c.researchStatus === "complete") {
    if (c.culture) segments.push(`Culture: ${truncate(c.culture, 500)}`);
    if (c.financials) segments.push(`Financial health: ${truncate(c.financials, 400)}`);
  } else if (c.researchStatus === "generating" || c.researchStatus === "pending") {
    segments.push(
      "Company-level culture / financial research is still loading. If they ask about culture or financial health, tell them honestly that you don't have it grounded yet rather than guessing.",
    );
  } else if (c.researchStatus === "failed" || c.researchStatus === "missing") {
    segments.push(
      "No grounded company-level research available for this conversation. Speak to the role from the posting itself; if they push on culture or financials, be honest that you don't have a vetted source.",
    );
  }

  if (c.roleResearchStatus === "complete") {
    if (c.interview)
      segments.push(`Interview process at ${c.name}: ${truncate(c.interview, 500)}`);
    if (c.compensation)
      segments.push(`Compensation benchmark for this role at ${c.name}: ${truncate(c.compensation, 400)}`);
  } else if (c.roleResearchStatus === "generating" || c.roleResearchStatus === "pending") {
    segments.push(
      "Role-specific interview / comp research is still loading. Same rule: don't fabricate.",
    );
  }
  // "missing" for role research means the posting has no canonical archetype
  // — silent, no need to call it out to the model.

  if (segments.length === 0) {
    segments.push("No research available — speak from the posting only.");
  }

  return `${header}\n${segments.join("\n\n")}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}
