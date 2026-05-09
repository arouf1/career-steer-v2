import { describe, it, expect } from "vitest";
import {
  buildInterviewQueries,
  buildNewsQuery,
  isBundleStale,
  isNewsStale,
  BUNDLE_TTL_MS,
  NEWS_TTL_MS,
} from "./interviewResearch";

describe("interviewResearch.buildInterviewQueries", () => {
  it("returns 4 prompts that all reference the company and role", () => {
    const qs = buildInterviewQueries({
      companyName: "Stripe",
      roleTitle: "Senior Software Engineer",
    });
    expect(Object.keys(qs).sort()).toEqual([
      "loop",
      "prestigeSignals",
      "questions",
      "rigor",
    ]);
    for (const v of Object.values(qs)) {
      expect(v).toMatch(/Stripe/);
      expect(v).toMatch(/Senior Software Engineer/i);
    }
  });

  it("converts a slug-style role into prose", () => {
    const qs = buildInterviewQueries({
      companyName: "Acme",
      roleTitle: "staff-product-manager",
    });
    expect(qs.loop).toMatch(/staff product manager/i);
  });
});

describe("interviewResearch.buildNewsQuery", () => {
  it("includes a 90-day window phrasing in the query", () => {
    const q = buildNewsQuery({ companyName: "OpenAI" });
    expect(q).toMatch(/OpenAI/);
    expect(q).toMatch(/90 days|three months|recent/i);
  });
});

describe("interviewResearch.isBundleStale / isNewsStale", () => {
  it("returns true when timestamp is missing", () => {
    expect(isBundleStale(undefined)).toBe(true);
    expect(isNewsStale(undefined)).toBe(true);
  });

  it("returns true when older than the TTL", () => {
    const now = Date.now();
    expect(isBundleStale(now - BUNDLE_TTL_MS - 1, now)).toBe(true);
    expect(isNewsStale(now - NEWS_TTL_MS - 1, now)).toBe(true);
  });

  it("returns false when fresher than the TTL", () => {
    const now = Date.now();
    expect(isBundleStale(now - 1000, now)).toBe(false);
    expect(isNewsStale(now - 1000, now)).toBe(false);
  });
});
