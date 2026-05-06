import { describe, expect, it } from "vitest";
import {
  buildJobEmbeddingTexts,
  type JobEmbeddingInput,
} from "./job-embedding-text";

const sample: JobEmbeddingInput = {
  title: "Senior Software Engineer",
  companyName: "Acme",
  city: "London",
  countryCode: "GB",
  schedule: "Full-time",
  workFromHome: false,
  salary: "£90,000 — £120,000",
  content: {
    overview:
      "Acme is hiring a senior backend engineer to lead the data-platform team.",
    theRole:
      "You'll own the data ingestion path, mentor two engineers, and " +
      "ship to production weekly. The team uses Go, PostgreSQL, and Kafka.",
    whatStandsOut: [
      "Equity in a Series C startup with $40M ARR.",
      "Hybrid in central London, 2 days remote.",
      "On-call rotation is 1-in-6, well-paid stipend.",
    ],
    idealCandidate:
      "Five-plus years of backend engineering experience. Comfortable " +
      "with Go, distributed systems, and on-call. Mentorship instinct.",
    compSummary:
      "Base £90-120k plus equity. Annual bonus tied to team-level KPIs.",
  },
  roleArchetypeSlug: "software-engineer",
};

describe("buildJobEmbeddingTexts", () => {
  it("returns four facets", () => {
    const texts = buildJobEmbeddingTexts(sample);
    expect(texts).toHaveProperty("whole");
    expect(texts).toHaveProperty("arc");
    expect(texts).toHaveProperty("currentState");
    expect(texts).toHaveProperty("domain");
    for (const v of Object.values(texts)) {
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(20);
    }
  });

  it("whole includes the broadest signal: title, company, overview, theRole", () => {
    const t = buildJobEmbeddingTexts(sample).whole;
    expect(t).toContain("Senior Software Engineer");
    expect(t).toContain("Acme");
    expect(t).toContain("data-platform");
    expect(t).toContain("data ingestion");
  });

  it("arc emphasises trajectory signals: comp, archetype, distinctive items", () => {
    const t = buildJobEmbeddingTexts(sample).arc;
    expect(t).toContain("Senior Software Engineer");
    // Comp + standouts are the trajectory cues for a job posting.
    expect(t).toContain("£90-120k");
    expect(t).toContain("Series C");
  });

  it("currentState emphasises day-to-day at this company", () => {
    const t = buildJobEmbeddingTexts(sample).currentState;
    // theRole and idealCandidate together describe what someone in this
    // role does and who they need to be — the "currently doing this work"
    // signal that matches profile currentState.
    expect(t).toContain("data ingestion");
    expect(t).toContain("Five-plus years");
  });

  it("domain emphasises tooling, skills, and adjacent terms", () => {
    const t = buildJobEmbeddingTexts(sample).domain;
    // Tools/tech mentioned in theRole show up here.
    expect(t).toContain("Go");
    expect(t).toContain("PostgreSQL");
    expect(t).toContain("Kafka");
    expect(t).toContain("distributed systems");
  });

  it("each facet stays under the 6000-character budget", () => {
    const t = buildJobEmbeddingTexts(sample);
    for (const [name, text] of Object.entries(t)) {
      expect(text.length, `${name} should be <= 6000 chars`).toBeLessThanOrEqual(
        6000,
      );
    }
  });

  it("never includes the literal strings 'null' or 'undefined'", () => {
    // Build with a posting missing several optional fields.
    const minimal: JobEmbeddingInput = {
      title: "Engineer",
      companyName: "Acme",
      city: "Berlin",
      countryCode: null,
      schedule: null,
      workFromHome: null,
      salary: null,
      content: {
        overview: "Description goes here.",
        theRole: "Day-to-day stuff.",
        whatStandsOut: [],
        idealCandidate: "Someone good.",
        compSummary: null,
      },
      roleArchetypeSlug: null,
    };
    const t = buildJobEmbeddingTexts(minimal);
    for (const [name, text] of Object.entries(t)) {
      expect(text, `${name} should not contain 'null'`).not.toMatch(/\bnull\b/);
      expect(
        text,
        `${name} should not contain 'undefined'`,
      ).not.toMatch(/\bundefined\b/);
    }
  });

  it("calls out remote-friendly when workFromHome is true", () => {
    const t = buildJobEmbeddingTexts({ ...sample, workFromHome: true }).whole;
    expect(t.toLowerCase()).toMatch(/remote/);
  });

  it("includes archetype framing when present", () => {
    const t = buildJobEmbeddingTexts(sample).arc;
    expect(t.toLowerCase()).toMatch(/software engineer/);
  });

  it("handles the no-content case (returns whatever is available without crashing)", () => {
    const noContent: JobEmbeddingInput = {
      title: "Engineer",
      companyName: "Acme",
      city: "Berlin",
      countryCode: null,
      schedule: null,
      workFromHome: null,
      salary: null,
      content: null,
      roleArchetypeSlug: null,
    };
    const t = buildJobEmbeddingTexts(noContent);
    // Should still produce text — the title and company alone carry signal.
    expect(t.whole).toContain("Engineer");
    expect(t.whole).toContain("Acme");
  });
});
