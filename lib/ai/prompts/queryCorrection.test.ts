import { describe, expect, it } from "vitest";
import {
  buildCorrectionPrompt,
  CORRECTION_SYSTEM_PROMPT,
  JOB_QUERY_CORRECTION_MODEL_ID,
  normalizeQueryForCorrectionCache,
  QueryCorrectionSchema,
  shouldCorrect,
} from "./queryCorrection";

describe("JOB_QUERY_CORRECTION_MODEL_ID", () => {
  it("is the project's canonical Flash model", () => {
    // All other Flash callers in the project use this exact string. Keep
    // them in lockstep so model upgrades happen in one place.
    expect(JOB_QUERY_CORRECTION_MODEL_ID).toBe("google/gemini-3-flash-preview");
  });
});

describe("normalizeQueryForCorrectionCache", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeQueryForCorrectionCache("  Software   Engineer  ")).toBe(
      "software engineer",
    );
  });

  it("returns empty string for empty input", () => {
    expect(normalizeQueryForCorrectionCache("")).toBe("");
    expect(normalizeQueryForCorrectionCache("   ")).toBe("");
  });

  it("is idempotent", () => {
    const a = normalizeQueryForCorrectionCache("Senior   PM");
    const b = normalizeQueryForCorrectionCache(a);
    expect(b).toBe(a);
  });
});

describe("shouldCorrect", () => {
  it("skips inputs that are too short to meaningfully correct", () => {
    expect(shouldCorrect("")).toBe(false);
    expect(shouldCorrect("a")).toBe(false);
    expect(shouldCorrect("ab")).toBe(false);
  });

  it("runs on inputs >= 3 characters", () => {
    expect(shouldCorrect("abc")).toBe(true);
    expect(shouldCorrect("software engineer")).toBe(true);
  });

  it("skips pure-numeric or pure-symbol inputs", () => {
    expect(shouldCorrect("123")).toBe(false);
    expect(shouldCorrect("!!!")).toBe(false);
  });
});

describe("CORRECTION_SYSTEM_PROMPT", () => {
  it("instructs the model to be conservative", () => {
    const p = CORRECTION_SYSTEM_PROMPT.toLowerCase();
    expect(p).toMatch(/conservative|when in doubt|leave it alone|unchanged/);
  });

  it("forbids expanding abbreviations", () => {
    const p = CORRECTION_SYSTEM_PROMPT.toLowerCase();
    expect(p).toMatch(/abbreviation|acronym/);
  });

  it("forbids 'improving' the search beyond typo fixes", () => {
    const p = CORRECTION_SYSTEM_PROMPT.toLowerCase();
    expect(p).toMatch(/improve|expand|enrich|rephrase/);
  });

  it("warns against changing brand or proper-noun names", () => {
    const p = CORRECTION_SYSTEM_PROMPT.toLowerCase();
    expect(p).toMatch(/brand|proper noun|company name/);
  });
});

describe("buildCorrectionPrompt", () => {
  it("includes the user's input verbatim", () => {
    const p = buildCorrectionPrompt("softwre enginer");
    expect(p).toContain("softwre enginer");
  });

  it("never includes the literal string 'undefined'", () => {
    const p = buildCorrectionPrompt("");
    expect(p).not.toMatch(/\bundefined\b/);
  });

  it("returns a string", () => {
    expect(typeof buildCorrectionPrompt("python developer")).toBe("string");
  });
});

describe("QueryCorrectionSchema", () => {
  it("accepts a typical correction", () => {
    const ok = QueryCorrectionSchema.safeParse({
      corrected: "software engineer",
      hadTypo: true,
      confidence: 0.95,
    });
    expect(ok.success).toBe(true);
  });

  it("accepts a no-correction outcome", () => {
    const ok = QueryCorrectionSchema.safeParse({
      corrected: "product manager",
      hadTypo: false,
      confidence: 1,
    });
    expect(ok.success).toBe(true);
  });

  it("rejects when fields are missing", () => {
    expect(
      QueryCorrectionSchema.safeParse({ corrected: "x" }).success,
    ).toBe(false);
    expect(
      QueryCorrectionSchema.safeParse({ corrected: "x", hadTypo: true }).success,
    ).toBe(false);
  });
});
