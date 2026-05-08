/**
 * Integration tests for the synthesis + rubric prompts.
 *
 * These tests hit the REAL OpenRouter LLM (Gemini 3.1 Pro). Per CLAUDE.md,
 * mocking is forbidden for integration tests in this project.
 *
 * Expected runtime: ~30-60s per test, ~2-4 min total.
 * Run with: pnpm vitest run convex/interviewSim.test.ts
 *
 * Requires OPENROUTER_API_KEY in .env.local.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { generateText, Output } from "ai";
import { chatModel } from "../lib/ai/providers";
import { CONTENT_MODEL_ID } from "../lib/ai/prompts/career-guides";
import {
  InterviewSynthesisSchema,
  InterviewRubricSchema,
  buildSynthesisPrompt,
  buildRubricPrompt,
  enforceVerbatimQuotes,
} from "../lib/ai/prompts/interviewer";

// ── Load .env.local if the key isn't already set (CI injects it directly) ──
if (!process.env.OPENROUTER_API_KEY) {
  try {
    const envPath = resolve(__dirname, "../.env.local");
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env.local not present — env vars must be injected externally
  }
}

const SLOW = 60_000;

const fixtureExa = (answer: string) => ({
  answer,
  citations: [{ url: "https://example.com", title: answer.slice(0, 40), fetchedAt: Date.now() }],
});

describe("synthesis prompt against real LLM", () => {
  it("produces a bundle with rigor 4-5 for a famous, large company", async () => {
    const prompt = buildSynthesisPrompt({
      companyName: "Stripe",
      roleTitle: "Senior Software Engineer",
      exaResults: {
        loop: fixtureExa("Stripe interviews include a recruiter screen, a take-home, a system design, a pair programming session, and a values round."),
        questions: fixtureExa("Common questions include 'tell me about a system you scaled' and 'walk me through how you'd design a payment processor'."),
        rigor: fixtureExa("Glassdoor lists Stripe interview difficulty around 4.1/5. Stripe is widely considered very selective."),
        prestigeSignals: fixtureExa("Stripe is a private company with around 8000 employees and a valuation in the tens of billions; the brand is widely recognised in tech."),
      },
      newsAnswer: undefined,
    });
    const { experimental_output } = await generateText({
      model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
      experimental_output: Output.object({ schema: InterviewSynthesisSchema }),
      prompt,
    });
    expect(experimental_output.interviewBundle.rubric.rigor).toBeGreaterThanOrEqual(4);
    expect(experimental_output.interviewBundle.rounds.length).toBeGreaterThanOrEqual(3);
    expect(experimental_output.interviewBundle.signatureQuestions.length).toBeGreaterThanOrEqual(5);
    expect(experimental_output.interviewBundle.rubric.dimensions).toHaveLength(4);
    const dimKeys = experimental_output.interviewBundle.rubric.dimensions.map((d) => d.key);
    expect(new Set(dimKeys)).toEqual(new Set(["structure", "depth", "role-fit", "company-fit"]));
  }, SLOW);

  it("produces a bundle with rigor 2-3 for a tiny seed-stage shop", async () => {
    const prompt = buildSynthesisPrompt({
      companyName: "Acme Seed Co",
      roleTitle: "Founding Engineer",
      exaResults: {
        loop: fixtureExa("Acme Seed Co is a 6-person seed-stage startup. Their interview is one founder chat plus a pair coding session."),
        questions: fixtureExa("They ask 'tell me about yourself' and 'what excites you about the early-stage problem space'."),
        rigor: fixtureExa("No Glassdoor reviews available."),
        prestigeSignals: fixtureExa("6 employees, $2M seed round, no notable brand recognition outside their immediate niche."),
      },
      newsAnswer: undefined,
    });
    const { experimental_output } = await generateText({
      model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
      experimental_output: Output.object({ schema: InterviewSynthesisSchema }),
      prompt,
    });
    expect(experimental_output.interviewBundle.rubric.rigor).toBeLessThanOrEqual(3);
    expect(experimental_output.interviewBundle.rubric.rigorRationale).toMatch(/seed|small|early|6/i);
  }, SLOW);
});

describe("rubric prompt against real LLM", () => {
  it("returns null score for a dimension that wasn't covered in the call", async () => {
    const transcript = [
      "Interviewer: Tell me about yourself.",
      "Candidate: I'm Sam, an engineer.",
      "Interviewer: Cool. Why are you interested in this role?",
      "Candidate: Sounds good.",
      "Interviewer: Thanks for your time.",
    ].join("\n");
    const bundle = {
      rounds: [{ name: "Behavioral", focus: "Mutual fit", interviewerArchetype: "hiring manager" }],
      signatureQuestions: [{ question: "Tell me about yourself.", rationale: "Opener" }],
      rubric: {
        rigor: 3,
        rigorRationale: "Generic.",
        interviewerArchetype: "hiring manager",
        dimensions: [
          { key: "structure", anchorBelow: "Rambling", anchorAt: "STAR", anchorAbove: "Crisp" },
          { key: "depth", anchorBelow: "Surface", anchorAt: "Adequate", anchorAbove: "Probing" },
          { key: "role-fit", anchorBelow: "Misaligned", anchorAt: "Plausible", anchorAbove: "Strong evidence" },
          { key: "company-fit", anchorBelow: "Generic", anchorAt: "Aware", anchorAbove: "Specific + informed" },
        ],
      },
      prestigeSignals: {},
    };
    const prompt = buildRubricPrompt({
      candidate: { firstName: "Sam" },
      posting: { title: "Engineer" },
      company: { name: "Acme" },
      bundle,
      transcript,
    });
    const { experimental_output } = await generateText({
      model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
      experimental_output: Output.object({ schema: InterviewRubricSchema }),
      prompt,
    });
    // At least one dimension should be null because the call was so short.
    expect(experimental_output.dimensions.some((d) => d.score == null)).toBe(true);
  }, SLOW);

  it("quotes verbatim from the transcript", async () => {
    const transcript = [
      "Interviewer: Walk me through a system you scaled.",
      "Candidate: I led the migration from MySQL to Postgres for our payments service. We moved 50 million rows over a weekend with zero downtime by using logical replication and a phased cutover.",
      "Interviewer: Nice. What was the hardest part?",
      "Candidate: The hardest part was reconciling sequence values for the auto-increment columns mid-cutover.",
      "Interviewer: Thanks for your time.",
    ].join("\n");
    const bundle = {
      rounds: [{ name: "Technical", focus: "Depth", interviewerArchetype: "staff engineer" }],
      signatureQuestions: [{ question: "Walk me through a system you scaled.", rationale: "—" }],
      rubric: {
        rigor: 4,
        rigorRationale: "—",
        interviewerArchetype: "staff engineer",
        dimensions: [
          { key: "structure", anchorBelow: "—", anchorAt: "STAR", anchorAbove: "—" },
          { key: "depth", anchorBelow: "—", anchorAt: "Adequate", anchorAbove: "—" },
          { key: "role-fit", anchorBelow: "—", anchorAt: "Plausible", anchorAbove: "—" },
          { key: "company-fit", anchorBelow: "—", anchorAt: "Aware", anchorAbove: "—" },
        ],
      },
      prestigeSignals: {},
    };
    const prompt = buildRubricPrompt({
      candidate: { firstName: "Sam" },
      posting: { title: "Staff Engineer" },
      company: { name: "Acme" },
      bundle,
      transcript,
    });
    const { experimental_output } = await generateText({
      model: chatModel(CONTENT_MODEL_ID, { zdr: true }),
      experimental_output: Output.object({ schema: InterviewRubricSchema }),
      prompt,
    });
    const check = enforceVerbatimQuotes({
      transcript,
      bestQuote: experimental_output.bestMoment.quote,
      missQuote: experimental_output.biggestMiss.quote,
    });
    expect(check.ok).toBe(true);
  }, SLOW);
});
