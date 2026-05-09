import { describe, it, expect } from "vitest";
import {
  InterviewSynthesisSchema,
  buildSynthesisPrompt,
  buildInterviewerPrompt,
  InterviewRubricSchema,
  enforceVerbatimQuotes,
} from "./interviewer";

describe("InterviewSynthesisSchema", () => {
  it("accepts a well-formed synthesis output", () => {
    const ok = {
      interviewBundle: {
        rounds: [
          { name: "Recruiter screen", durationMinutes: 30, focus: "Mutual fit", interviewerArchetype: "recruiter" },
        ],
        signatureQuestions: [
          { question: "Tell me about a time you disagreed with a teammate.", rationale: "Tests collaboration." },
        ],
        rubric: {
          rigor: 4,
          rigorRationale: "Public company with strong brand recognition.",
          interviewerArchetype: "engineering manager",
          dimensions: [
            { key: "structure", anchorBelow: "Rambling.", anchorAt: "STAR.", anchorAbove: "Crisp + quantified." },
            { key: "depth", anchorBelow: "Surface.", anchorAt: "Adequate.", anchorAbove: "Probes own assumptions." },
            { key: "role-fit", anchorBelow: "Misaligned.", anchorAt: "Plausible.", anchorAbove: "Strong evidence." },
            { key: "company-fit", anchorBelow: "Generic.", anchorAt: "Aware.", anchorAbove: "Specific + informed." },
          ],
        },
        prestigeSignals: {
          employeeBand: "5k-50k",
          fundingOrPublic: "public",
          brandMentions: 200,
          glassdoorDifficulty: 4,
        },
      },
      interviewProse: "Stripe runs a 4-round loop including a take-home, live coding, system design, and values round.",
      recentNews: { bullets: [] },
    };
    expect(() => InterviewSynthesisSchema.parse(ok)).not.toThrow();
  });

  it("does NOT use min/max/int/length Zod constraints (Gemini compat)", () => {
    // Zod 4 stores `"minLength": null` on every string node even without constraints.
    // The regex below checks for ACTUAL bound values (non-null numbers), not
    // just the presence of the key — so we match `"minLength":3` but not `"minLength":null`.
    // This preserves the intent of the plan's test while being correct on Zod 4.
    const json = JSON.stringify(InterviewSynthesisSchema._def);
    expect(json).not.toMatch(/"minimum":\s*\d|"maximum":\s*\d|"minLength":\s*\d|"maxLength":\s*\d|"minItems":\s*\d|"maxItems":\s*\d/);
  });
});

describe("buildSynthesisPrompt", () => {
  it("includes the company, role, and every available Exa source by section", () => {
    const prompt = buildSynthesisPrompt({
      companyName: "Acme",
      roleTitle: "Staff Engineer",
      exaResults: {
        loop: { answer: "ACME RUNS A 5-ROUND LOOP", citations: [] },
        questions: { answer: "Q1: Tell me about a system you scaled", citations: [] },
        rigor: { answer: "Glassdoor 4.2/5", citations: [] },
        prestigeSignals: { answer: "Public company, 8000 employees", citations: [] },
      },
      newsAnswer: undefined,
    });
    expect(prompt).toMatch(/Acme/);
    expect(prompt).toMatch(/Staff Engineer/);
    expect(prompt).toMatch(/ACME RUNS A 5-ROUND LOOP/);
    expect(prompt).toMatch(/Glassdoor 4\.2\/5/);
    expect(prompt).toMatch(/3 to 5 rounds/);
    expect(prompt).toMatch(/exactly 4 dimensions/);
  });

  it("instructs the model to cite the prestige signals in rigorRationale", () => {
    const prompt = buildSynthesisPrompt({
      companyName: "X",
      roleTitle: "Y",
      exaResults: {
        loop: { answer: "", citations: [] },
        questions: { answer: "", citations: [] },
        rigor: { answer: "", citations: [] },
        prestigeSignals: { answer: "", citations: [] },
      },
      newsAnswer: undefined,
    });
    expect(prompt).toMatch(/rigorRationale/);
    expect(prompt).toMatch(/cite/i);
  });
});

describe("buildInterviewerPrompt", () => {
  it("renders a system prompt with persona, candidate brief, role brief, and the signature questions", () => {
    const prompt = buildInterviewerPrompt({
      candidate: {
        firstName: "Sam",
        currentTitle: "Senior Engineer",
        yearsExperience: 8,
        topSkills: ["Go", "Postgres"],
        narrative: "Built and led platform teams at two scale-ups.",
        resumeExcerpt: "—",
      },
      posting: { title: "Staff Engineer", city: "London", excerpt: "Ship infra at scale." },
      company: { name: "Stripe" },
      bundle: {
        rounds: [{ name: "System design", focus: "scaling discussion", interviewerArchetype: "staff EM" }],
        signatureQuestions: [{ question: "Walk me through a system you scaled.", rationale: "—" }],
        rubric: {
          rigor: 4,
          rigorRationale: "Public, household name.",
          interviewerArchetype: "staff EM",
          dimensions: [
            { key: "structure", anchorBelow: "—", anchorAt: "STAR-shaped", anchorAbove: "—" },
            { key: "depth", anchorBelow: "—", anchorAt: "probes assumptions", anchorAbove: "—" },
            { key: "role-fit", anchorBelow: "—", anchorAt: "matches scope", anchorAbove: "—" },
            { key: "company-fit", anchorBelow: "—", anchorAt: "informed about Stripe", anchorAbove: "—" },
          ],
        },
        prestigeSignals: {},
      },
      news: { bullets: [{ headline: "Q4 results", summary: "Revenue up 30%.", sourceUrl: "x.com" }] },
    });
    expect(prompt).toMatch(/staff EM at Stripe/);
    expect(prompt).toMatch(/Sam/);
    expect(prompt).toMatch(/Walk me through a system you scaled/);
    expect(prompt).toMatch(/STAR-shaped/);
    expect(prompt).toMatch(/Q4 results/);
    expect(prompt).toMatch(/googleSearch/);
    expect(prompt).toMatch(/Never break character/);
  });
});

describe("InterviewRubricSchema", () => {
  it("accepts a complete rubric with 4 dimensions, 3 exercises, and verbatim quotes", () => {
    const ok = {
      overallScore: 70,
      oneLineVerdict: "Strong on structure; tighten company-specific framing.",
      dimensions: [
        { key: "structure", score: 80, whatWorked: "Used STAR.", whatToFix: "—" },
        { key: "depth", score: 60, whatWorked: "—", whatToFix: "Probe own assumptions." },
        { key: "role-fit", score: null, whatWorked: "—", whatToFix: "Not enough signal." },
        { key: "company-fit", score: 60, whatWorked: "—", whatToFix: "Cite specifics." },
      ],
      bestMoment: { quote: "I led the migration from MySQL to Postgres.", why: "Concrete, scoped, owned." },
      biggestMiss: { quote: "I'd do something with caching.", why: "Vague.", betterAnswerSketch: "Name the caches, the layer, the eviction policy." },
      nextStepExercises: [
        { title: "STAR drill", why: "Tighten depth.", how: "Write 3 STAR stories." },
        { title: "Read Stripe blog", why: "Company specificity.", how: "Read 2 posts." },
        { title: "Mock again", why: "Reps.", how: "Run 2 more mocks this week." },
      ],
    };
    expect(() => InterviewRubricSchema.parse(ok)).not.toThrow();
  });
});

describe("enforceVerbatimQuotes", () => {
  it("returns ok when both quotes are present in transcript", () => {
    const r = enforceVerbatimQuotes({
      transcript: "Hello. I led the migration from MySQL to Postgres. Then I'd do something with caching.",
      bestQuote: "I led the migration from MySQL to Postgres.",
      missQuote: "I'd do something with caching.",
    });
    expect(r.ok).toBe(true);
  });

  it("returns the offending quote when one is hallucinated", () => {
    const r = enforceVerbatimQuotes({
      transcript: "Some other text entirely.",
      bestQuote: "A quote that isn't here.",
      missQuote: "Neither is this one.",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContain("A quote that isn't here.");
      expect(r.missing).toContain("Neither is this one.");
    }
  });
});
