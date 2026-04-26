import { describe, it, expect } from "vitest";
import { ProfileSchema, type Profile } from "./schema";

describe("ProfileSchema", () => {
  it("parses a fully populated profile", () => {
    const input: Profile = {
      name: "Aqil Rouf",
      headline: "Career coach",
      summary: "Builds AI tools.",
      location: "London, UK",
      experience: [{
        title: "Engineer",
        company: "Acme",
        startDate: "Jan 2022",
        endDate: null,
        description: "Built things.",
      }],
      education: [{
        school: "Oxford",
        degree: "BSc",
        field: "CS",
        startDate: "2014",
        endDate: "2018",
      }],
      skills: ["TypeScript", "Convex"],
    };
    expect(ProfileSchema.parse(input)).toEqual(input);
  });

  it("allows null/missing optional fields", () => {
    const input = {
      name: null,
      headline: null,
      summary: null,
      location: null,
      experience: [],
      education: [],
      skills: [],
    };
    expect(() => ProfileSchema.parse(input)).not.toThrow();
  });

  it("requires title and company on experience entries", () => {
    expect(() =>
      ProfileSchema.parse({
        name: null, headline: null, summary: null, location: null,
        experience: [{ title: "", company: "" }],
        education: [], skills: [],
      })
    ).toThrow();
  });

  it("rejects extra unknown fields", () => {
    expect(() =>
      ProfileSchema.parse({
        name: null, headline: null, summary: null, location: null,
        experience: [], education: [], skills: [],
        extra: "nope",
      })
    ).toThrow();
  });
});
