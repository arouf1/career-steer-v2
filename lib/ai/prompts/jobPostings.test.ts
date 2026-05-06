import { describe, expect, it } from "vitest";
import { buildRewritePrompt, REWRITE_SYSTEM_PROMPT } from "./jobPostings";
import type { RewriteInput } from "./jobPostings";

const baseInput: RewriteInput = {
  title: "Senior Product Manager",
  companyName: "Acme",
  location: "London, United Kingdom",
  city: "London",
  rawDescription: "We are looking for a senior PM to lead our growth team…",
  salary: null,
  schedule: null,
  postedAt: null,
  workFromHome: null,
};

describe("buildRewritePrompt", () => {
  it("includes title, company, and city verbatim", () => {
    const prompt = buildRewritePrompt(baseInput);
    expect(prompt).toContain("Senior Product Manager");
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("London");
  });

  it("includes the raw description verbatim so the model can rewrite from it", () => {
    const prompt = buildRewritePrompt(baseInput);
    expect(prompt).toContain(baseInput.rawDescription);
  });

  it("instructs the model to return null compSummary when no salary is disclosed", () => {
    const prompt = buildRewritePrompt({ ...baseInput, salary: null });
    expect(prompt.toLowerCase()).toMatch(
      /no salary.*disclosed|salary is not.*disclosed|return null.*compsummary/,
    );
  });

  it("includes the salary when present so the model can summarise it", () => {
    const prompt = buildRewritePrompt({ ...baseInput, salary: "£70,000–£90,000" });
    expect(prompt).toContain("£70,000–£90,000");
  });

  it("calls out remote when workFromHome is true", () => {
    const prompt = buildRewritePrompt({ ...baseInput, workFromHome: true });
    expect(prompt.toLowerCase()).toMatch(/remote/);
  });

  it("includes posting schedule when present (Full-time, etc.)", () => {
    const prompt = buildRewritePrompt({ ...baseInput, schedule: "Full-time" });
    expect(prompt).toContain("Full-time");
  });

  it("never leaks the literal strings 'null' or 'undefined' from optional fields", () => {
    const prompt = buildRewritePrompt(baseInput);
    // We're checking the actual values, not the word "null" appearing in
    // instructions ("return null when no salary is disclosed" is fine).
    // So look for tell-tale leaks like "Salary: null" or "Schedule: null".
    expect(prompt).not.toMatch(/:\s*null\b/);
    expect(prompt).not.toMatch(/:\s*undefined\b/);
  });

  it("encodes word-count bounds in prose so Gemini schema constraints aren't required", () => {
    const prompt = buildRewritePrompt(baseInput);
    // The model needs explicit guidance on length per section because the
    // Zod schema can't carry bounds (Gemini structured output rejects
    // .min/.max). The prompt is the only enforcement.
    expect(prompt).toMatch(/80.*120 words?/i); // overview
    expect(prompt).toMatch(/150 words?/i);     // theRole
    expect(prompt).toMatch(/3.*5 (?:bullets?|items?)/i); // whatStandsOut
  });

  it("encodes meta-title and meta-description budgets in prose", () => {
    const prompt = buildRewritePrompt(baseInput);
    expect(prompt).toMatch(/50.*60 (?:characters?|chars?)/i);
    expect(prompt).toMatch(/150.*160 (?:characters?|chars?)/i);
  });

  it("returns a string", () => {
    expect(typeof buildRewritePrompt(baseInput)).toBe("string");
  });
});

describe("REWRITE_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof REWRITE_SYSTEM_PROMPT).toBe("string");
    expect(REWRITE_SYSTEM_PROMPT.length).toBeGreaterThan(50);
  });

  it("instructs the model to write in our voice and avoid copy-pasting", () => {
    expect(REWRITE_SYSTEM_PROMPT.toLowerCase()).toMatch(
      /paraphrase|rewrite|in (?:our|your) (?:own )?(?:voice|words)/,
    );
  });

  it("instructs the model never to invent facts not in the source", () => {
    expect(REWRITE_SYSTEM_PROMPT.toLowerCase()).toMatch(
      /invent|fabricate|hallucinate|do not (?:add|make up)/,
    );
  });
});
