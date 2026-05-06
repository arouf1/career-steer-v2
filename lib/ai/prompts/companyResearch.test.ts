import { describe, expect, it } from "vitest";
import {
  buildCompanyResearchPrompt,
  buildCompanyRolePrompt,
  COMPANY_RESEARCH_SYSTEM_PROMPT,
  CompanyResearchSchema,
  CompanyRoleResearchSchema,
} from "./companyResearch";
import type {
  CompanyResearchInput,
  CompanyRoleResearchInput,
} from "./companyResearch";

const sampleResearchByField = {
  culture: {
    answer:
      "Acme is known for a fast-paced, design-led culture with high engineering autonomy.",
    sources: [
      { url: "https://example.com/a", title: "Inside Acme", fetchedAt: 0 },
      { url: "https://example.com/b", title: "Acme reviews", fetchedAt: 0 },
    ],
  },
  financials: {
    answer:
      "Series C, $120M raised, 250 employees, profitable as of Q4 2025.",
    sources: [
      { url: "https://example.com/c", title: "Acme funding round", fetchedAt: 0 },
    ],
  },
};

describe("COMPANY_RESEARCH_SYSTEM_PROMPT", () => {
  it("instructs the model to ground in sources and never invent", () => {
    const p = COMPANY_RESEARCH_SYSTEM_PROMPT.toLowerCase();
    expect(p).toMatch(/source|cite|grounded?/);
    expect(p).toMatch(/invent|fabricate|do not (?:add|make up)|hallucinate/);
  });
});

describe("buildCompanyResearchPrompt", () => {
  const input: CompanyResearchInput = {
    companyName: "Acme",
    researchByField: sampleResearchByField,
  };

  it("includes the company name", () => {
    expect(buildCompanyResearchPrompt(input)).toContain("Acme");
  });

  it("includes each field's research answer in the prompt", () => {
    const p = buildCompanyResearchPrompt(input);
    expect(p).toContain(sampleResearchByField.culture.answer);
    expect(p).toContain(sampleResearchByField.financials.answer);
  });

  it("attaches indexed source markers per field so the model can cite them", () => {
    const p = buildCompanyResearchPrompt(input);
    // Sources are presented with explicit indexes — the model returns these
    // back in usedSources.{field}: number[].
    expect(p).toMatch(/\[0\]/);
    expect(p).toMatch(/\[1\]/);
  });

  it("instructs the model to return null for fields with no research", () => {
    const partial = {
      companyName: "Acme",
      researchByField: { culture: sampleResearchByField.culture },
    };
    const p = buildCompanyResearchPrompt(partial);
    // Financials wasn't in researchByField → instruct to return null. The
    // instruction can span lines, so use the `s` flag so `.` matches \n.
    expect(p.toLowerCase()).toMatch(
      /financials[\s\S]*null|return null[\s\S]*financials/,
    );
  });
});

describe("buildCompanyRolePrompt", () => {
  const input: CompanyRoleResearchInput = {
    companyName: "Acme",
    roleTitle: "Senior Software Engineer",
    researchByField: {
      interview: {
        answer: "Acme uses 1 phone screen + 4 onsite rounds…",
        sources: [
          { url: "https://example.com/i", title: "Acme interviews", fetchedAt: 0 },
        ],
      },
      compensation: {
        answer: "TC at Acme for SSE is $200-260k according to levels.fyi…",
        sources: [
          { url: "https://example.com/c", title: "Acme comp data", fetchedAt: 0 },
        ],
      },
    },
  };

  it("mentions both the company and the role context", () => {
    const p = buildCompanyRolePrompt(input);
    expect(p).toContain("Acme");
    expect(p).toContain("Senior Software Engineer");
  });

  it("includes both fields' research", () => {
    const p = buildCompanyRolePrompt(input);
    expect(p).toContain("phone screen");
    expect(p).toContain("levels.fyi");
  });

  it("returns a string", () => {
    expect(typeof buildCompanyRolePrompt(input)).toBe("string");
  });
});

describe("CompanyResearchSchema", () => {
  it("accepts valid output", () => {
    const ok = CompanyResearchSchema.safeParse({
      culture: "Some prose.",
      financials: "Some prose.",
      usedSources: { culture: [0, 1], financials: [0] },
    });
    expect(ok.success).toBe(true);
  });

  it("accepts null fields with empty source lists", () => {
    const ok = CompanyResearchSchema.safeParse({
      culture: null,
      financials: "Some prose.",
      usedSources: { culture: [], financials: [0] },
    });
    expect(ok.success).toBe(true);
  });

  it("rejects when required keys are missing", () => {
    const bad = CompanyResearchSchema.safeParse({
      culture: "Some prose.",
      // missing financials, usedSources
    });
    expect(bad.success).toBe(false);
  });
});

describe("CompanyRoleResearchSchema", () => {
  it("accepts valid output", () => {
    const ok = CompanyRoleResearchSchema.safeParse({
      interview: "Some prose.",
      compensation: "Some prose.",
      usedSources: { interview: [0], compensation: [0] },
    });
    expect(ok.success).toBe(true);
  });

  it("accepts null fields", () => {
    const ok = CompanyRoleResearchSchema.safeParse({
      interview: "Some prose.",
      compensation: null,
      usedSources: { interview: [0], compensation: [] },
    });
    expect(ok.success).toBe(true);
  });
});
