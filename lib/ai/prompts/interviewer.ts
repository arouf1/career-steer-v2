import { z } from "zod";

/**
 * Schemas, prompts, and helpers for the interview simulation feature.
 *
 * Three logical chunks colocated in one file because they share constants
 * and the calibration story is only readable when you can see them
 * side-by-side:
 *   1. InterviewSynthesisSchema + buildSynthesisPrompt — turn raw Exa
 *      research into a structured `interviewBundle` (+ prose + news).
 *   2. buildInterviewerPrompt — build the Gemini Live system instruction
 *      that drives the actual mock interview.
 *   3. InterviewRubricSchema + buildRubricPrompt + enforceVerbatimQuotes
 *      — post-call grading against the same bundle, with a hallucinated-
 *      quote check.
 *
 * Per .claude/rules/ai-sdk-patterns.md: Zod schemas avoid .min/.max/.int
 * because Gemini structured-output rejects bound constraints. Bounds are
 * encoded in prompt text.
 */

// ─── 1. Synthesis ─────────────────────────────────────────────────────────

const RoundSchema = z.object({
  name: z.string(),
  durationMinutes: z.number().optional(),
  focus: z.string(),
  interviewerArchetype: z.string(),
});

const SignatureQuestionSchema = z.object({
  question: z.string(),
  rationale: z.string(),
});

const DimensionSchema = z.object({
  key: z.string(),
  anchorBelow: z.string(),
  anchorAt: z.string(),
  anchorAbove: z.string(),
});

const RubricSchema = z.object({
  rigor: z.number(),
  rigorRationale: z.string(),
  interviewerArchetype: z.string(),
  dimensions: z.array(DimensionSchema),
});

const PrestigeSignalsSchema = z.object({
  employeeBand: z.string().optional(),
  fundingOrPublic: z.string().optional(),
  brandMentions: z.number().optional(),
  glassdoorDifficulty: z.number().optional(),
});

const NewsBulletSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  sourceUrl: z.string(),
  publisher: z.string().optional(),
  publishedAt: z.number().optional(),
});

export const InterviewBundleSchema = z.object({
  rounds: z.array(RoundSchema),
  signatureQuestions: z.array(SignatureQuestionSchema),
  rubric: RubricSchema,
  prestigeSignals: PrestigeSignalsSchema,
});

export const InterviewSynthesisSchema = z.object({
  interviewBundle: InterviewBundleSchema,
  interviewProse: z.string(),
  recentNews: z.object({ bullets: z.array(NewsBulletSchema) }),
});

export type InterviewBundle = z.infer<typeof InterviewBundleSchema>;
export type InterviewSynthesis = z.infer<typeof InterviewSynthesisSchema>;
export type NewsBullets = z.infer<typeof InterviewSynthesisSchema>["recentNews"];

export type ExaSlice = { answer: string; citations: Array<{ url: string; title?: string; publisher?: string; fetchedAt: number }> };

export type SynthesisPromptArgs = {
  companyName: string;
  roleTitle: string;
  exaResults: {
    loop?: ExaSlice;
    questions?: ExaSlice;
    rigor?: ExaSlice;
    prestigeSignals?: ExaSlice;
  };
  newsAnswer?: ExaSlice;
};

export function buildSynthesisPrompt(args: SynthesisPromptArgs): string {
  const sections: string[] = [];

  sections.push(`You are synthesizing research into a structured interview bundle for a mock-interview simulator.`);
  sections.push(`The bundle calibrates how an AI interviewer will conduct, and later grade, a mock interview for a ${args.roleTitle} role at ${args.companyName}.`);
  sections.push("");
  sections.push("== Output requirements ==");
  sections.push("Return JSON matching the provided schema. Constraints (encoded here, not the schema):");
  sections.push("- `interviewBundle.rounds`: 3 to 5 rounds describing the typical loop.");
  sections.push("- `interviewBundle.signatureQuestions`: 5 to 8 entries. Use questions actually reported by candidates where the research supports it; otherwise generate role-appropriate ones grounded in the research.");
  sections.push("- `interviewBundle.rubric.dimensions`: exactly 4 dimensions with keys 'structure', 'depth', 'role-fit', 'company-fit'.");
  sections.push("- `interviewBundle.rubric.rigor`: an integer 1-5.");
  sections.push("- `interviewBundle.rubric.rigorRationale`: ONE sentence that cites the specific prestige signals that drove the score (e.g. 'public company with 8k employees and a Glassdoor difficulty of 4.1').");
  sections.push("- `interviewProse`: a 2-4 sentence human-readable summary suitable for the existing `interview` field.");
  if (args.newsAnswer) {
    sections.push("- `recentNews.bullets`: 3 to 6 bullets from the news research, each with a headline, one-sentence summary, and source URL.");
  } else {
    sections.push("- `recentNews.bullets`: return [] (news research was not refreshed this run).");
  }
  sections.push("");
  sections.push("== Calibration anchors ==");
  sections.push("Derive `rigor` from the prestige signals you receive — NOT from the company name. Anchors:");
  sections.push("- <50 employees, no household name → rigor 2-3 (less calibrated process).");
  sections.push("- 50-500 employees, modest brand → rigor 3.");
  sections.push("- 500-5k employees, recognised in domain → rigor 3-4.");
  sections.push("- 5k+ employees AND brand mentions >50, OR public, OR famously selective → rigor 4-5.");
  sections.push("- Glassdoor difficulty score (when present) is the strongest single signal; weight it heaviest.");
  sections.push("");
  sections.push("Each dimension's `anchorAt` should describe what a 60/100 score looks like at THIS company specifically (the bar for 'meets expectations' here, not in general). `anchorBelow` describes what scores below 40 look like; `anchorAbove` describes what scores above 80 look like.");
  sections.push("");
  sections.push("Each round in `rounds` should have an `interviewerArchetype` like 'recruiter', 'hiring manager', 'engineering manager', 'staff engineer', 'bar raiser', 'principal', etc. The whole-loop `rubric.interviewerArchetype` should be the dominant one — this is the persona the live interviewer adopts.");
  sections.push("");
  sections.push(`== Research input ==`);
  sections.push(`Company: ${args.companyName}`);
  sections.push(`Role: ${args.roleTitle}`);
  sections.push("");
  if (args.exaResults.loop) {
    sections.push("--- Loop structure (Exa research) ---");
    sections.push(args.exaResults.loop.answer || "(no usable result)");
    sections.push("");
  }
  if (args.exaResults.questions) {
    sections.push("--- Reported questions (Exa research) ---");
    sections.push(args.exaResults.questions.answer || "(no usable result)");
    sections.push("");
  }
  if (args.exaResults.rigor) {
    sections.push("--- Difficulty / selectivity (Exa research) ---");
    sections.push(args.exaResults.rigor.answer || "(no usable result)");
    sections.push("");
  }
  if (args.exaResults.prestigeSignals) {
    sections.push("--- Company size & brand (Exa research) ---");
    sections.push(args.exaResults.prestigeSignals.answer || "(no usable result)");
    sections.push("");
  }
  if (args.newsAnswer) {
    sections.push("--- Recent news (Exa research, last 90 days) ---");
    sections.push(args.newsAnswer.answer || "(no usable result)");
    sections.push("");
  }

  return sections.join("\n");
}

// ─── 2. Live interviewer prompt ───────────────────────────────────────────

export type CandidateContext = {
  firstName: string;
  currentTitle?: string;
  yearsExperience?: number;
  topSkills?: string[];
  narrative?: string;
  resumeExcerpt?: string;
};

export type PostingContext = {
  title: string;
  city?: string;
  excerpt?: string;
};

export type CompanyContext = {
  name: string;
};

export type InterviewerPromptArgs = {
  candidate: CandidateContext;
  posting: PostingContext;
  company: CompanyContext;
  bundle: InterviewBundle;
  news?: NewsBullets;
};

export function buildInterviewerPrompt(args: InterviewerPromptArgs): string {
  const { candidate, posting, company, bundle, news } = args;
  const archetype = bundle.rubric.interviewerArchetype;
  const anchorAtBullets = bundle.rubric.dimensions
    .map((d) => `  - ${d.key}: ${d.anchorAt}`)
    .join("\n");
  const candidateLines: string[] = [];
  if (candidate.currentTitle) candidateLines.push(`Current role: ${candidate.currentTitle}`);
  if (candidate.yearsExperience != null) candidateLines.push(`Experience: ${candidate.yearsExperience} years`);
  if (candidate.topSkills?.length) candidateLines.push(`Top skills: ${candidate.topSkills.slice(0, 5).join(", ")}`);
  if (candidate.narrative) candidateLines.push(`Narrative: ${candidate.narrative}`);
  if (candidate.resumeExcerpt) candidateLines.push(`Resume excerpt:\n${candidate.resumeExcerpt.slice(0, 800)}`);

  const newsBullets = news?.bullets?.length
    ? news.bullets.slice(0, 3).map((b) => `  - ${b.headline}: ${b.summary}`).join("\n")
    : "  (no recent news captured)";

  const loopBullets = bundle.rounds
    .map((r) => `  - ${r.name} (${r.interviewerArchetype}) — ${r.focus}`)
    .join("\n");

  const signatureSpine = bundle.signatureQuestions
    .map((q) => `  - "${q.question}"`)
    .join("\n");

  return [
    `**Persona:**`,
    `You are a ${archetype} at ${company.name}, interviewing ${candidate.firstName} for the ${posting.title} position. Your tone matches how this company actually conducts this loop, based on candidate accounts.`,
    ``,
    `Calibration: this loop runs at rigor ${bundle.rubric.rigor}/5 (${bundle.rubric.rigorRationale}). Hold the bar at that level — your bar is not "hard" or "easy" in the abstract, it is what excellence looks like at ${company.name} for this role. Reference frame for what "meets the bar" (60/100) means here:`,
    anchorAtBullets,
    ``,
    `**About ${candidate.firstName}:**`,
    candidateLines.length ? candidateLines.join("\n") : "(no candidate profile available — ask open questions to learn the basics first)",
    ``,
    `**About this role:**`,
    `${posting.title} at ${company.name}${posting.city ? ` · ${posting.city}` : ""}`,
    posting.excerpt ? posting.excerpt.slice(0, 500) : "",
    ``,
    `**Recent at ${company.name}** (use sparingly — only if the candidate brings it up or asks "what do you know about us recently"):`,
    newsBullets,
    ``,
    `**Likely loop structure** — you are simulating ONE round of this loop; pick whichever feels most useful given the candidate's background:`,
    loopBullets,
    ``,
    `**Coverage target — what "done" looks like:**`,
    `Your job is to come away with enough signal to grade the candidate against these four dimensions: ${bundle.rubric.dimensions.map((d) => d.key).join(", ")}. You are NOT trying to cover every signature question — you are trying to leave with a confident read on each dimension. Each dimension needs at least one substantive exchange (the candidate said something specific enough that you could write a non-trivial sentence about it). After each substantive exchange, call markDimensionCovered to mark which dimension you just got signal on (silently — do NOT narrate the call out loud, the candidate must not hear it). When all four dimensions are marked solid or stronger, you have enough to wrap.`,
    ``,
    `**Conversational rules:**`,
    `1. Open with a 30-second warm hello. One ice-breaker. Then transition.`,
    `2. One question per turn. Wait for the full answer.`,
    `3. **Hold the bar.** Do not validate, thank, or move on after a weak, vague, or wrong answer. If the candidate hand-waves ("we just kind of figured it out", "it was complicated"), push back in character: "Let me push you on that — what specifically did you do?" or "That's surprising for someone with your background — walk me through the actual decision." If the candidate says something factually wrong or contradicts themselves, name it: "That doesn't square with what you said earlier — help me reconcile that." If they don't know, sit in the silence for a beat before moving on; do not rescue them. Affirmation ("great answer", "love it", "makes sense") is reserved for genuinely strong responses — not as filler. Your warmth comes through in tone, not in praise.`,
    `4. **Drill down on substance.** When the candidate mentions a specific number, system, decision, trade-off, conflict, or choice that has real meat behind it, do NOT move on to the next question. Pull on that thread for 1-3 follow-ups before continuing: "What was the trade-off you considered?" / "How did you arrive at that number?" / "What would you do differently?" / "Who pushed back, and what did you do about it?" The trade-off is depth vs coverage — favor depth, but do not let one story consume the whole interview if it leaves a dimension untouched.`,
    `5. **Steer toward gaps.** Before asking the next question, mentally check which of the four dimensions you still lack signal on, and pick a question (from the spine below or your own) that targets the weakest area. By minute 8-10 you should have at least surface signal on all four; the remaining time is for the dimension that needs the most depth.`,
    `6. Use these signature questions as your spine. Pick from them based on which dimension you need to probe — you don't need to ask all of them. Use them verbatim or near-verbatim; mix in your own follow-ups based on candidate answers:`,
    signatureSpine,
    `7. Mid-call, if the candidate references current events about ${company.name} you don't already know from the brief above, you may call googleSearch ONCE to fetch context. Do not search proactively.`,
    `8. Cap each spoken response at ~25 seconds.`,
    `9. **Knowing when you're done.** End the interview when EITHER (a) you have called markDimensionCovered on all four dimensions with confidence solid or stronger, OR (b) you reach minute 13 — whichever comes first. The minimum interview length is ~5 minutes (you need at least the warm hello, two substantive exchanges, and a wrap); ending earlier than that means you didn't really interview them. To wrap, say: "I think I have a good sense of where you're at — before we close, what questions do you have for me?" Answer honestly from the hiring-manager POV. End by thanking them and naming one specific thing they did well — only if they earned it; if the interview was weak, end professionally without false praise.`,
    ``,
    `**Tool usage:**`,
    `- markDimensionCovered: silently call after each exchange that gave you real signal on a dimension. Idempotent — re-call if the candidate elaborates and your confidence changes. Use the dimension keys ${bundle.rubric.dimensions.map((d) => '"' + d.key + '"').join(", ")} verbatim.`,
    `- googleSearch: only when the candidate references something about ${company.name} you cannot answer from the brief. One search per call max.`,
    ``,
    `**Guardrails:**`,
    `- Never break character. You are the interviewer, not an AI.`,
    `- Never mention the rigor score, the rubric, or that this is a simulation.`,
    `- Never repeat what the candidate said back to them.`,
    `- If the candidate asks for feedback during the call, defer: "I'll have thoughts at the end — let's keep going."`,
  ].join("\n");
}

// ─── Live tools (Gemini Live function calling) ─────────────────────────────

export type InterviewerLiveTool =
  | {
      functionDeclarations: Array<{
        name: string;
        description: string;
        parameters: {
          type: "OBJECT";
          properties: Record<string, unknown>;
          required?: string[];
        };
      }>;
    }
  | { googleSearch: Record<string, never> };

/**
 * Build the tool list for an interview-sim Gemini Live session.
 *
 * Two tools:
 *   - markDimensionCovered (function): the interviewer calls this once it has
 *     substantive signal on a rubric dimension. Idempotent on dimension; the
 *     hook routes the call to the markDimensionCovered Convex mutation, which
 *     stores it on voice_calls.coverage so the dialog gauge can render
 *     progress and the model can self-ground via getCoverageStatus (deferred).
 *   - googleSearch (built-in): for current-events questions about the company.
 *
 * The dimension enum is derived from the bundle's actual dimension keys so
 * any future schema evolution stays consistent across the prompt, the tool,
 * and the rubric grader.
 */
export function interviewerTools(dimensionKeys: string[]): InterviewerLiveTool[] {
  return [
    {
      functionDeclarations: [
        {
          name: "markDimensionCovered",
          description:
            "Call this once you have substantive signal on a rubric dimension — i.e. the candidate has said something specific enough that you could write a non-trivial sentence about that dimension. Idempotent: if you've already marked a dimension and your view changes (e.g. they elaborated and demonstrated more), call it again with the new evidence and confidence; the latest call wins. Do NOT narrate the call out loud — keep it silent. Do NOT mark a dimension based on hand-waving or vague answers; if in doubt, don't mark it yet.",
          parameters: {
            type: "OBJECT",
            properties: {
              dimension: {
                type: "STRING",
                enum: dimensionKeys,
                description:
                  "Which rubric dimension this exchange covered. Must be one of the listed values verbatim.",
              },
              evidence: {
                type: "STRING",
                description:
                  "One sentence summarizing what the candidate said that gave you signal on this dimension. Keep it concrete — quote a phrase or number if useful.",
              },
              confidence: {
                type: "STRING",
                enum: ["weak", "solid", "strong"],
                description:
                  "How strong the signal is. 'weak' = surface mention only; 'solid' = a real example with specifics; 'strong' = depth, specificity, and probing follow-ups all landed.",
              },
            },
            required: ["dimension", "evidence", "confidence"],
          },
        },
      ],
    },
    { googleSearch: {} },
  ];
}

// ─── 3. Post-call rubric ──────────────────────────────────────────────────

const RubricDimensionResultSchema = z.object({
  key: z.string(),
  score: z.number().nullable(),
  whatWorked: z.string(),
  whatToFix: z.string(),
});

const NextStepExerciseSchema = z.object({
  title: z.string(),
  why: z.string(),
  how: z.string(),
});

export const InterviewRubricSchema = z.object({
  overallScore: z.number(),
  oneLineVerdict: z.string(),
  dimensions: z.array(RubricDimensionResultSchema),
  bestMoment: z.object({ quote: z.string(), why: z.string() }),
  biggestMiss: z.object({
    quote: z.string(),
    why: z.string(),
    betterAnswerSketch: z.string(),
  }),
  nextStepExercises: z.array(NextStepExerciseSchema),
});

export type InterviewRubric = z.infer<typeof InterviewRubricSchema>;

export type RubricPromptArgs = {
  candidate: CandidateContext;
  posting: PostingContext;
  company: CompanyContext;
  bundle: InterviewBundle;
  transcript: string;
  /** Optional correction echo for retry attempts — listed quotes were not found verbatim. */
  failedQuotes?: string[];
};

export function buildRubricPrompt(args: RubricPromptArgs): string {
  const { candidate, posting, company, bundle, transcript } = args;
  const anchorBlock = bundle.rubric.dimensions
    .map((d) => `- ${d.key}\n  Below (<40): ${d.anchorBelow}\n  At (60 = meets bar): ${d.anchorAt}\n  Above (>80): ${d.anchorAbove}`)
    .join("\n");

  const sections: string[] = [];
  sections.push(`You are grading a mock interview for the ${posting.title} role at ${company.name}.`);
  sections.push(`Calibration: rigor ${bundle.rubric.rigor}/5 (${bundle.rubric.rigorRationale}).`);
  sections.push(`A score of 60 means "meets the bar at ${company.name} for this role" — NOT "good in general". 80+ is strong. 90+ is exceptional. 40-59 is below the bar. <40 is a significant gap.`);
  sections.push(``);
  sections.push(`== Output schema requirements ==`);
  sections.push(`- nextStepExercises: exactly 3 entries.`);
  sections.push(`- dimensions: exactly 4 entries with keys: structure, depth, role-fit, company-fit (matching the bundle).`);
  sections.push(`- overallScore: weighted average of the 4 dimension scores (treat null as not contributing). Round to an integer in the range 0-100.`);
  sections.push(`- Each dimension score: an integer in the range 0-100 (or null if there was no substantive signal on that dimension).`);
  sections.push(`- oneLineVerdict: a single sentence the candidate sees above the fold.`);
  sections.push(``);
  sections.push(`== Verbatim-quote rule (critical) ==`);
  sections.push(`bestMoment.quote and biggestMiss.quote MUST be substrings of the transcript exactly as the candidate spoke them. Do not paraphrase. If you cannot find a verbatim quote that supports the point you'd like to make, lower the score for that dimension instead of fabricating a quote.`);
  sections.push(``);
  sections.push(`== Null-score rule (strict) ==`);
  sections.push(`Set score to null for a dimension when there is NO substantive candidate statement in the transcript that addresses it. "Substantive" means at least one candidate turn with more than a sentence of relevant content. If the candidate gave only a greeting, a vague one-liner, or no turn at all on that dimension, the score MUST be null — do not infer or extrapolate.`);
  sections.push(`For very short transcripts (fewer than 5 candidate turns total), most dimensions will be null. That is correct and expected — report what actually happened.`);
  sections.push(``);
  if (args.failedQuotes?.length) {
    sections.push(`== CORRECTION ==`);
    sections.push(`On the previous attempt these quotes were NOT verbatim substrings of the transcript:`);
    args.failedQuotes.forEach((q) => sections.push(`  - ${q}`));
    sections.push(`Pick replacement quotes that ARE present in the transcript below. If no suitable verbatim quote exists, lower the score and say so.`);
    sections.push(``);
  }
  sections.push(`== Dimension anchors (use these, not a generic standard) ==`);
  sections.push(anchorBlock);
  sections.push(``);
  sections.push(`== Candidate ==`);
  sections.push(`${candidate.firstName}${candidate.currentTitle ? ` (${candidate.currentTitle})` : ""}${candidate.yearsExperience != null ? ` · ${candidate.yearsExperience} yrs` : ""}`);
  if (candidate.narrative) sections.push(candidate.narrative);
  sections.push(``);
  sections.push(`== Transcript ==`);
  sections.push(transcript);
  return sections.join("\n");
}

export type EnforceQuotesArgs = {
  transcript: string;
  bestQuote: string;
  missQuote: string;
};

export type EnforceQuotesResult =
  | { ok: true }
  | { ok: false; missing: string[] };

export function enforceVerbatimQuotes(args: EnforceQuotesArgs): EnforceQuotesResult {
  const missing: string[] = [];
  if (!args.transcript.includes(args.bestQuote)) missing.push(args.bestQuote);
  if (!args.transcript.includes(args.missQuote)) missing.push(args.missQuote);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
