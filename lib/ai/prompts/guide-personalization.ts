import { z } from "zod";

// Gemini 3 Flash — picked for personalization because the surface is
// latency-sensitive (user is staring at a skeleton waiting for output) and
// the inputs are already grounded in profile data + Exa snippets, so the
// model doesn't need pro-tier reasoning. Verified live on OpenRouter
// (`google/gemini-3-flash-preview`) at the time of writing.
export const PERSONALIZATION_MODEL_ID = "google/gemini-3-flash-preview";

// Bound counts (4–6 strengths, 3–5 transferable / gaps, 80–120 word summary,
// 150–200 word fit narrative, 14–22 word "why" per skill row) are described in
// prompt + .describe() copy and NOT enforced via Zod constraints. Gemini
// structured output rejects .min/.max/.int/array-length constraints; encoding
// bounds in prose is the project-standard workaround.
const PersonalizedRegionalSchema = z.object({
  countryCode: z
    .string()
    .describe(
      "ISO 3166-1 alpha-2 code for the user's country (e.g. 'CA', 'DE', 'AU', 'JP', 'IN', 'SG').",
    ),
  countryName: z
    .string()
    .describe("Full country name (e.g. 'Canada', 'Germany', 'Japan')."),
  currencySymbol: z
    .string()
    .describe(
      "The currency symbol or short code to display before salary numbers. Examples: 'CA$', '€', '¥', 'A$', '₹', 'S$'. Use the form readers in that country actually use.",
    ),
  salary: z.object({
    entry: z
      .string()
      .describe(
        "Entry-level salary range for this role in this country, in local currency. Format examples: '45,000 to 60,000', '40,000+'. Do NOT include the currency symbol — it is supplied separately.",
      ),
    mid: z.string().describe("Mid-level salary range, same format as entry."),
    senior: z
      .string()
      .describe("Senior-level salary range, same format as entry."),
    note: z
      .string()
      .nullable()
      .describe(
        "Optional one-sentence note explaining drivers (city premium, public/private split, etc.). Null when not needed.",
      ),
  }),
  careerOutlook: z
    .string()
    .describe(
      "120-180 word outlook paragraph specific to this country: demand, growth direction, dominant employers/sectors, geographic concentration. Reference real local context.",
    ),
  learningPath: z
    .array(z.string())
    .describe(
      "5-7 ordered steps to enter this role from this country. Reference local credentials, institutions, certifications, professional bodies. Each item is a sentence or short paragraph.",
    ),
  relatedRoles: z
    .array(z.string())
    .describe(
      "4-6 related role titles common in this country's market.",
    ),
});

export const GuidePersonalizationSchema = z.object({
  whyYoureAFit: z
    .string()
    .describe(
      "150-200 word personalised narrative explaining why this role fits the reader, addressed to them as 'you'.",
    ),
  skillsAssessment: z.object({
    strengths: z
      .array(
        z.object({
          skill: z
            .string()
            .describe(
              "Short noun phrase naming the strength (e.g. 'Quantitative data analysis'). No sentence form, no symbols.",
            ),
          why: z
            .string()
            .describe(
              "14-22 word sentence in second person explaining why this strength matters specifically for THIS role. Name the concrete leverage it gives you (a daily task it makes easy, a stakeholder pressure it absorbs, a decision it sharpens). Avoid generic praise.",
            ),
        }),
      )
      .describe(
        "4-6 specific strengths the reader already brings, drawn from their CV or enriched profile. Each row pairs a short skill phrase with the role-specific reason it counts.",
      ),
    transferable: z
      .array(
        z.object({
          skill: z
            .string()
            .describe(
              "Short noun phrase naming an adjacent skill the reader has (e.g. 'Cross-functional project coordination').",
            ),
          why: z
            .string()
            .describe(
              "14-22 word sentence in second person explaining the bridge: what about this skill maps onto a real demand of THIS role even though the labels differ.",
            ),
        }),
      )
      .describe(
        "3-5 skills from the reader's background that travel well into this role even if they are not direct matches. Each row pairs the skill with the bridge.",
      ),
    gaps: z
      .array(
        z.object({
          skill: z
            .string()
            .describe(
              "Short noun phrase naming the missing capability (e.g. 'Regulatory documentation for clinical trials').",
            ),
          why: z
            .string()
            .describe(
              "14-22 word sentence in second person explaining why this gap matters in THIS role: name what you can't do credibly without it, or what it unlocks.",
            ),
        }),
      )
      .describe(
        "3-5 honest gaps the reader would need to close to thrive in this role. Each row pairs the gap with the role-specific consequence of leaving it open.",
      ),
    summary: z
      .string()
      .describe(
        "80-120 word honest narrative comparing the reader's current shape to what this role demands.",
      ),
  }),
  regional: PersonalizedRegionalSchema.nullable().describe(
    "Country-tailored regional block (salary band, outlook, learning path, related roles) for the reader's home country. Set to null ONLY when the reader's country is United States or United Kingdom (the public guide already covers those) or when the reader's country cannot be determined from their profile. For every other country — Canada, Germany, Australia, Singapore, India, Japan, Brazil, anywhere — populate this block with locally accurate figures and context.",
  ),
});
export type GuidePersonalization = z.infer<typeof GuidePersonalizationSchema>;

export type RegionalExaSnippet = {
  topic: "salary" | "outlook" | "learning-path";
  query: string;
  answer: string;
  sources: Array<{ url: string; title: string; publisher?: string }>;
};

type PromptInputs = {
  guide: {
    title: string;
    overview: string;
    dayToDay: string;
    typicalSkills: string[];
    riskFactors: string[];
    salaryUk: { entry: string; mid: string; senior: string };
    salaryUs: { entry: string; mid: string; senior: string };
    careerOutlookUk: string;
    careerOutlookUs: string;
    learningPathUk: string[];
    learningPathUs: string[];
  };
  profile: {
    rawText: string;
    summary?: string | null;
    headline?: string | null;
    location?: string | null;
    skills: string[];
    recentExperience: Array<{
      title: string;
      company: string;
      startDate?: string;
      endDate?: string;
      description?: string;
    }>;
  };
  enrichment: {
    careerStage?: string;
    careerArchetype?: string;
    narrativeSummary?: string;
    motivations?: Array<{ kind: string; evidenceQuote: string }>;
    workStyleSignals?: {
      collaboration: string;
      pace: string;
      scope: string;
    };
    totalYearsExperience?: number;
    geographicMobility?: {
      cities?: string[];
      countries?: string[];
      remoteSignal?: string;
    };
    enrichedSkills?: Array<{
      canonical?: string;
      proficiencySignal?: string;
      yearsOfExperience?: number;
    }>;
  };
  /** Exa-grounded snippets for the reader's region. Empty for US/UK users. */
  regionalSources?: RegionalExaSnippet[];
};

const SYSTEM_PROMPT = `You write honest, specific, second-person career analysis for a B2C career-coaching product.

Voice rules:
- Address the reader as "you" / "your" throughout. Never "the candidate" or "the user".
- Be specific. Reference at least one concrete detail from the reader's profile (a role title, a company, a skill, a sector, or their location) in the fit narrative and in the skills summary.
- Be honest. If the fit is weak in a meaningful way, say so. Do not flatter.
- Use hyphens (-), never em-dashes.
- No bullet symbols or formatting characters in any field - just the phrase or sentence.

"Why" rules for every skill row (strengths, transferable, gaps):
- Each "why" is one sentence, 14-22 words, in second person.
- Name a concrete consequence inside THIS role - a real task it makes easy, a stakeholder pressure it absorbs, a decision it sharpens, or what stays out of reach without it.
- Reference the role's actual day-to-day or risk profile when you can. Generic praise ("strong skill, very useful") is forbidden.
- For strengths: explain the leverage you already get from it in this role.
- For transferable: explain the bridge - what about it maps onto a demand of this role even though the labels differ.
- For gaps: explain what you can't do credibly without it, or what it unlocks once closed. No softening.

Output rules:
- Return JSON matching the provided schema exactly.
- Bound counts: 4-6 strengths, 3-5 transferable, 3-5 gaps. Fit narrative 150-200 words. Summary 80-120 words.
- Do not include any prose outside the JSON.`;

const trimToWords = (s: string, maxWords: number): string => {
  const words = s.trim().split(/\s+/);
  if (words.length <= maxWords) return s.trim();
  return words.slice(0, maxWords).join(" ") + "...";
};

const formatList = (items: string[] | undefined, max: number): string =>
  !items || items.length === 0
    ? "(none recorded)"
    : items.slice(0, max).map((s) => `- ${s}`).join("\n");

const formatExperience = (
  rows: PromptInputs["profile"]["recentExperience"],
): string => {
  if (rows.length === 0) return "(no experience recorded)";
  return rows
    .slice(0, 3)
    .map((r, i) => {
      const dates = [r.startDate, r.endDate].filter(Boolean).join(" - ");
      const head = `${i + 1}. ${r.title} at ${r.company}${dates ? ` (${dates})` : ""}`;
      const desc = r.description ? `\n   ${trimToWords(r.description, 60)}` : "";
      return head + desc;
    })
    .join("\n");
};

const formatMotivations = (
  m: PromptInputs["enrichment"]["motivations"],
): string => {
  if (!m || m.length === 0) return "(none recorded)";
  return m
    .slice(0, 3)
    .map((row) => `- ${row.kind}: "${trimToWords(row.evidenceQuote, 25)}"`)
    .join("\n");
};

const formatEnrichedSkills = (
  s: PromptInputs["enrichment"]["enrichedSkills"],
): string => {
  if (!s || s.length === 0) return "(none recorded)";
  return s
    .slice(0, 12)
    .map((row) => {
      const parts = [row.canonical ?? "(unknown)"];
      if (row.proficiencySignal) parts.push(`(${row.proficiencySignal})`);
      if (typeof row.yearsOfExperience === "number")
        parts.push(`${row.yearsOfExperience}y`);
      return `- ${parts.join(" ")}`;
    })
    .join("\n");
};

const formatRegionalSources = (sources: RegionalExaSnippet[]): string => {
  if (sources.length === 0) return "(no Exa snippets fetched)";
  return sources
    .map((s, i) => {
      const sourceList = s.sources
        .slice(0, 6)
        .map((src, j) => `   [${i + 1}.${j + 1}] ${src.title} — ${src.url}`)
        .join("\n");
      return `### Topic ${i + 1}: ${s.topic} (query: "${s.query}")\n${trimToWords(s.answer, 240)}\nSources:\n${sourceList}`;
    })
    .join("\n\n");
};

export const buildGuidePersonalizationPrompt = (
  inputs: PromptInputs,
): { system: string; user: string } => {
  const { guide, profile, enrichment, regionalSources } = inputs;
  const cv = profile.rawText.length > 3000
    ? profile.rawText.slice(0, 3000) + "\n... [truncated]"
    : profile.rawText;

  const user = `## The role you're analysing

Title: ${guide.title}

Overview:
${trimToWords(guide.overview, 220)}

Day-to-day:
${trimToWords(guide.dayToDay, 160)}

Typical skills required:
${formatList(guide.typicalSkills, 12)}

Risk factors / honest considerations:
${formatList(guide.riskFactors, 6)}

UK salary: entry ${guide.salaryUk.entry} / mid ${guide.salaryUk.mid} / senior ${guide.salaryUk.senior}
US salary: entry ${guide.salaryUs.entry} / mid ${guide.salaryUs.mid} / senior ${guide.salaryUs.senior}

UK career outlook: ${trimToWords(guide.careerOutlookUk, 120)}
US career outlook: ${trimToWords(guide.careerOutlookUs, 120)}

Learning path (UK):
${formatList(guide.learningPathUk, 8)}

Learning path (US):
${formatList(guide.learningPathUs, 8)}

## The reader (you)

Headline: ${profile.headline ?? "(not set)"}
Location: ${profile.location ?? "(not set)"}
Self-summary: ${profile.summary ?? "(not set)"}

Career stage: ${enrichment.careerStage ?? "(unknown)"}
Career archetype: ${enrichment.careerArchetype ?? "(unknown)"}
Total years of experience: ${enrichment.totalYearsExperience ?? "(unknown)"}
Work style: collaboration=${enrichment.workStyleSignals?.collaboration ?? "?"}, pace=${enrichment.workStyleSignals?.pace ?? "?"}, scope=${enrichment.workStyleSignals?.scope ?? "?"}
Geographic mobility: cities=${enrichment.geographicMobility?.cities?.join(", ") ?? "?"}; countries=${enrichment.geographicMobility?.countries?.join(", ") ?? "?"}; remote=${enrichment.geographicMobility?.remoteSignal ?? "?"}

Enriched career narrative:
${enrichment.narrativeSummary ? trimToWords(enrichment.narrativeSummary, 180) : "(none)"}

Top motivations (with evidence):
${formatMotivations(enrichment.motivations)}

Self-reported skills:
${formatList(profile.skills, 16)}

Enriched skills (canonical, with proficiency signals where known):
${formatEnrichedSkills(enrichment.enrichedSkills)}

Recent experience (most recent 3 roles):
${formatExperience(profile.recentExperience)}

CV (raw text, truncated to ~3000 chars):
${cv}

## Exa-grounded sources for the reader's region

${
  regionalSources && regionalSources.length > 0
    ? `These snippets were freshly retrieved by Exa for this reader's location. They are the GROUND TRUTH for the regional block — use the salary numbers, outlook claims, and learning path steps from these snippets, not from your training data. Quote and paraphrase them, do not invent.\n\n${formatRegionalSources(regionalSources)}`
    : "(none — either the reader is in US/UK and the public guide already serves them, or no Exa context was retrieved. Set regional to null in this case.)"
}

## Your task

Produce JSON matching the schema with three pieces:

1. whyYoureAFit (150-200 words): A direct, honest analysis of how this role fits *you* given the profile above. Reference specific things from your background. If you're a strong fit, say why concretely. If it's a stretch, name the stretch. If your location is set and the role's regional outlook gives you an angle (e.g. demand in your country, salary band relative to your context), use it.

2. skillsAssessment: every row is { skill, why }. The "skill" is a short noun phrase; the "why" is a 14-22 word second-person sentence that ties the skill to a specific demand of THIS role. Generic descriptions are not acceptable.
   - strengths (4-6): Skills you already bring that directly match this role. Pull from enriched skills + recent experience. skill = short phrase ("stakeholder communication"); why = the leverage it gives you here ("you'll absorb the daily push from clinical leads who need fast, well-framed updates without escalation").
   - transferable (3-5): Skills from your background that don't directly map but translate well. skill = short phrase; why = the bridge ("running cross-functional launches at Stripe maps onto coordinating compliance, design, and risk reviews when shipping a new product line here").
   - gaps (3-5): Skills you would need to develop. skill = specific phrase ("regulatory documentation for clinical trials", not "domain knowledge"); why = what stays out of reach without it ("without it you can't sign off on study reports for the FDA submissions this team owns end-to-end").
   - summary (80-120 words): An honest narrative weighing where you stand against this role's demands. Mention the location angle if relevant.

3. regional: A country-tailored regional block for the reader's home country.
   - When to populate: Exa snippets were provided above (i.e., this section is non-empty). Pull every salary figure, outlook claim, and learning-path step from those snippets — DO NOT invent numbers, employers, or qualifications.
   - When to set null: no Exa snippets were provided OR the reader's location is missing/ambiguous OR the reader is clearly in the United States or United Kingdom (public guide already serves them).
   - When populated, all fields must be locally accurate AND grounded in the Exa snippets:
     * countryCode: ISO 3166-1 alpha-2.
     * countryName: full country name.
     * currencySymbol: the form local readers actually use ('CA$' for Canadian dollars, 'A$' for Australian, '€' for euro, '¥' for yen, '₹' for rupee, 'S$' for Singapore dollar, 'HK$' for Hong Kong, 'AED' for UAE dirham, etc.). Do NOT include the symbol in the salary numbers — it is rendered separately.
     * salary.entry / mid / senior: take ranges directly from the salary Exa snippet, in local currency shorthand (e.g. '60,000 to 80,000', '40,000+'). Use national-level figures unless the snippet only gives city data, in which case note the city in salary.note.
     * careerOutlook (120-180 words): paraphrase the outlook Exa snippet — demand, growth direction, dominant employers and sectors, regulatory landscape, geographic concentration. Cite real institutions named in the sources.
     * learningPath (5-7 ordered steps): build from the learning-path Exa snippet — credentials, institutions, professional bodies, and certifications named in the sources.
     * relatedRoles (4-6): titles common in this country's job market (Exa-derived where present, otherwise general knowledge).
   - Address the reader directly throughout ("you", "your") and use hyphens, not em-dashes.`;

  return { system: SYSTEM_PROMPT, user };
};
