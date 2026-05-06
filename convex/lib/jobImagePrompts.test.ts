import { describe, expect, it } from "vitest";
import { buildJobImagePrompt } from "./jobImagePrompts";
import type { JobImagePromptInput } from "./jobImagePrompts";

const base: JobImagePromptInput = {
  title: "Senior Product Manager",
  companyName: "Acme",
  city: "London",
  brandColor: null,
  archetypeSlug: null,
};

describe("buildJobImagePrompt", () => {
  it("includes title and company verbatim", () => {
    const p = buildJobImagePrompt(base);
    expect(p).toContain("Senior Product Manager");
    expect(p).toContain("Acme");
  });

  it("mentions the city when present", () => {
    expect(buildJobImagePrompt({ ...base, city: "London" })).toContain(
      "London",
    );
  });

  it("incorporates brand colour as a styling hint when present", () => {
    const p = buildJobImagePrompt({ ...base, brandColor: "#0a84ff" });
    expect(p).toContain("#0a84ff");
  });

  it("omits brand colour from the prompt when null", () => {
    const p = buildJobImagePrompt({ ...base, brandColor: null });
    expect(p).not.toContain("#");
  });

  it("hints at the archetype context when provided", () => {
    const p = buildJobImagePrompt({
      ...base,
      archetypeSlug: "software-engineer",
    });
    // Archetype shows up as a prose context hint, not the slug verbatim.
    expect(p.toLowerCase()).toMatch(/software engineer/);
  });

  it("never includes the literal strings 'null' or 'undefined'", () => {
    const p = buildJobImagePrompt(base);
    expect(p).not.toMatch(/\bnull\b/);
    expect(p).not.toMatch(/\bundefined\b/);
  });

  it("includes hard rules: no text in image, no logos, no faces", () => {
    const p = buildJobImagePrompt(base).toLowerCase();
    expect(p).toMatch(/no (?:text|words|letters|writing)/);
    expect(p).toMatch(/no (?:logos?|brand marks?)/);
    expect(p).toMatch(/no (?:faces?|people|portraits?)/);
  });

  it("specifies aspect-ratio guidance for the hero (16:9)", () => {
    expect(buildJobImagePrompt(base)).toMatch(/16:?9/);
  });

  it("returns a non-empty string", () => {
    const p = buildJobImagePrompt(base);
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(50);
  });
});
