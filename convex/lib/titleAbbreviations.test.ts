import { describe, it, expect } from "vitest";
import { expandTitleAbbreviations } from "./titleAbbreviations";

describe("expandTitleAbbreviations", () => {
  it("expands seniority abbreviations", () => {
    expect(expandTitleAbbreviations("Sr Software Engineer")).toBe(
      "senior software engineer",
    );
    expect(expandTitleAbbreviations("Sr. Software Engineer")).toBe(
      "senior software engineer",
    );
    expect(expandTitleAbbreviations("Jr. Developer")).toBe("junior developer");
  });

  it("expands role abbreviations", () => {
    expect(expandTitleAbbreviations("SWE")).toBe("software engineer");
    expect(expandTitleAbbreviations("PM")).toBe("product manager");
    expect(expandTitleAbbreviations("PMM")).toBe("product marketing manager");
    expect(expandTitleAbbreviations("VP Engineering")).toBe(
      "vice president engineering",
    );
  });

  it("normalises whitespace and case", () => {
    expect(expandTitleAbbreviations("  Senior   Software   Engineer  ")).toBe(
      "senior software engineer",
    );
    expect(expandTitleAbbreviations("SENIOR SOFTWARE ENGINEER")).toBe(
      "senior software engineer",
    );
  });

  it("strips trailing roman-numeral / numeric levels", () => {
    expect(expandTitleAbbreviations("Software Engineer III")).toBe(
      "software engineer",
    );
    expect(expandTitleAbbreviations("Software Engineer 3")).toBe(
      "software engineer",
    );
    expect(expandTitleAbbreviations("Software Engineer II")).toBe(
      "software engineer",
    );
  });

  it("does not expand inside larger words", () => {
    expect(expandTitleAbbreviations("Office of CTO")).toBe(
      "office of chief technology officer",
    );
    expect(expandTitleAbbreviations("PMO Lead")).toBe("pmo lead");
  });

  it("handles empty input", () => {
    expect(expandTitleAbbreviations("")).toBe("");
    expect(expandTitleAbbreviations("   ")).toBe("");
  });

  it("collapses syntactically-equivalent variants (abbreviations + trailing level) to the same key", () => {
    // Same-family abbreviation expansions converge.
    expect(expandTitleAbbreviations("Sr. SWE")).toBe(
      expandTitleAbbreviations("Senior Software Engineer"),
    );
    // Trailing levels are syntactic noise and converge.
    expect(expandTitleAbbreviations("Software Engineer 3")).toBe(
      expandTitleAbbreviations("Software Engineer III"),
    );
    // Cross-family (with vs without seniority qualifier) does NOT converge here —
    // that is the LLM canonicalizer's job. Verified at the integration boundary
    // (Task 6: same canonical title → same guide row via layer-3 slug OCC).
    expect(expandTitleAbbreviations("Senior Software Engineer")).not.toBe(
      expandTitleAbbreviations("Software Engineer"),
    );
  });
});
