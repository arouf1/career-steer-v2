import { describe, expect, it } from "vitest";
import {
  buildJobPostingJsonLd,
  deriveCountryFromLocation,
  isUndisclosedEmployer,
  normalizeEmploymentType,
  parseSalary,
  type JobPostingInput,
} from "./jobPostingSchema";

const SAMPLE_FIRST_SEEN = new Date("2026-04-01T10:00:00Z").getTime();

const sample: JobPostingInput = {
  jobId: "j-acme-london-pm-001",
  title: "Senior Product Manager",
  companyName: "Acme",
  companyLogoUrl: null,
  companyHomepageUrl: null,
  location: "London, United Kingdom",
  description: "<p>We're hiring a senior PM…</p>",
  schedule: "Full-time",
  salary: "£70,000 — £90,000",
  workFromHome: false,
  experienceLevel: null,
  industry: null,
  firstSeenAt: SAMPLE_FIRST_SEEN,
  canonicalUrl:
    "https://career-steer.app/jobs/listing/london/acme/senior-product-manager/abc123",
  validForDays: 45,
};

describe("isUndisclosedEmployer", () => {
  it("flags confidential / stealth / leading-company patterns", () => {
    expect(isUndisclosedEmployer("Confidential")).toBe(true);
    expect(isUndisclosedEmployer("Undisclosed Employer")).toBe(true);
    expect(isUndisclosedEmployer("A Leading Company")).toBe(true);
    expect(isUndisclosedEmployer("Stealth")).toBe(true);
    expect(isUndisclosedEmployer("Stealth Mode Startup")).toBe(true);
    expect(isUndisclosedEmployer("Private Company")).toBe(true);
    expect(isUndisclosedEmployer("Company Confidential")).toBe(true);
  });

  it("does not flag real company names", () => {
    expect(isUndisclosedEmployer("Acme")).toBe(false);
    expect(isUndisclosedEmployer("The New York Times")).toBe(false);
    expect(isUndisclosedEmployer("Capital One")).toBe(false);
  });

  it("flags empty / whitespace input", () => {
    expect(isUndisclosedEmployer("")).toBe(true);
    expect(isUndisclosedEmployer("   ")).toBe(true);
    expect(isUndisclosedEmployer(null)).toBe(true);
    expect(isUndisclosedEmployer(undefined)).toBe(true);
  });
});

describe("normalizeEmploymentType", () => {
  it("maps the common variants", () => {
    expect(normalizeEmploymentType("Full-time")).toBe("FULL_TIME");
    expect(normalizeEmploymentType("full time")).toBe("FULL_TIME");
    expect(normalizeEmploymentType("Part-time")).toBe("PART_TIME");
    expect(normalizeEmploymentType("Contract")).toBe("CONTRACTOR");
    expect(normalizeEmploymentType("Freelance")).toBe("CONTRACTOR");
    expect(normalizeEmploymentType("Temporary")).toBe("TEMPORARY");
    expect(normalizeEmploymentType("Internship")).toBe("INTERN");
    expect(normalizeEmploymentType("Volunteer")).toBe("VOLUNTEER");
  });

  it("defaults to FULL_TIME on null/undefined", () => {
    expect(normalizeEmploymentType(null)).toBe("FULL_TIME");
    expect(normalizeEmploymentType(undefined)).toBe("FULL_TIME");
  });

  it("returns OTHER on unknown values", () => {
    expect(normalizeEmploymentType("zero hours")).toBe("OTHER");
  });
});

describe("deriveCountryFromLocation", () => {
  it("matches UK variants", () => {
    expect(deriveCountryFromLocation("London, United Kingdom")?.code).toBe("GB");
    expect(deriveCountryFromLocation("Edinburgh, Scotland")?.code).toBe("GB");
    expect(deriveCountryFromLocation("Cardiff, Wales")?.code).toBe("GB");
  });

  it("matches US variants", () => {
    expect(deriveCountryFromLocation("New York, USA")?.code).toBe("US");
    expect(deriveCountryFromLocation("San Francisco, CA")?.code).toBe("US");
  });

  it("matches CA, AU, IE", () => {
    expect(deriveCountryFromLocation("Toronto, Canada")?.code).toBe("CA");
    expect(deriveCountryFromLocation("Sydney, Australia")?.code).toBe("AU");
    expect(deriveCountryFromLocation("Dublin, Ireland")?.code).toBe("IE");
  });

  it("returns null on unrecognised inputs", () => {
    expect(deriveCountryFromLocation("Wakanda")).toBeNull();
    expect(deriveCountryFromLocation("")).toBeNull();
  });
});

describe("parseSalary", () => {
  it("parses ranges", () => {
    expect(parseSalary("£70,000 — £90,000")).toEqual({
      minValue: 70000,
      maxValue: 90000,
    });
    expect(parseSalary("$120k - $150k")).toEqual({
      minValue: 120,
      maxValue: 150,
    }); // documented quirk: "k" not expanded; sub-issue
    expect(parseSalary("70000 to 90000 USD")).toEqual({
      minValue: 70000,
      maxValue: 90000,
    });
  });

  it("parses single values", () => {
    expect(parseSalary("£85,000 per year")).toEqual({ value: 85000 });
  });

  it("returns null when no parseable numbers", () => {
    expect(parseSalary(null)).toBeNull();
    expect(parseSalary("Competitive")).toBeNull();
  });

  it("ignores tiny noise numbers like years and counts", () => {
    expect(parseSalary("Posted 2024, salary 80,000")).toEqual({ value: 80000 });
  });
});

describe("buildJobPostingJsonLd", () => {
  it("emits the required schema.org fields", () => {
    const ld = buildJobPostingJsonLd(sample);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("JobPosting");
    expect(ld.title).toBe("Senior Product Manager");
    expect(ld.description).not.toContain("<p>"); // HTML stripped
    expect(ld.datePosted).toBe(new Date(SAMPLE_FIRST_SEEN).toISOString());
    expect(ld.validThrough).toBe(
      new Date(SAMPLE_FIRST_SEEN + 45 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(ld.employmentType).toBe("FULL_TIME");
    expect(ld.hiringOrganization.name).toBe("Acme");
    expect(ld.url).toBe(sample.canonicalUrl);
  });

  it("includes identifier with company + jobId", () => {
    const ld = buildJobPostingJsonLd(sample);
    expect(ld.identifier).toEqual({
      "@type": "PropertyValue",
      name: "Acme",
      value: sample.jobId,
    });
  });

  it("includes jobLocation when not remote", () => {
    const ld = buildJobPostingJsonLd({ ...sample, workFromHome: false });
    expect(ld.jobLocation).toBeDefined();
    expect(ld.jobLocation?.address.addressLocality).toBe("London");
    expect(ld.jobLocation?.address.addressCountry).toBe("GB");
  });

  it("omits jobLocation and adds applicantLocationRequirements when remote", () => {
    const ld = buildJobPostingJsonLd({ ...sample, workFromHome: true });
    expect(ld.jobLocation).toBeUndefined();
    expect(ld.jobLocationType).toBe("TELECOMMUTE");
    expect(ld.applicantLocationRequirements?.name).toBe("United Kingdom");
  });

  it("includes baseSalary when salary parses, with currency derived from country", () => {
    const ld = buildJobPostingJsonLd(sample);
    expect(ld.baseSalary?.currency).toBe("GBP");
    expect(ld.baseSalary?.value.minValue).toBe(70000);
    expect(ld.baseSalary?.value.maxValue).toBe(90000);
  });

  it("omits baseSalary when no salary disclosed", () => {
    const ld = buildJobPostingJsonLd({ ...sample, salary: null });
    expect(ld.baseSalary).toBeUndefined();
  });

  it("includes hiringOrganization.logo when companyLogoUrl is provided", () => {
    const ld = buildJobPostingJsonLd({
      ...sample,
      companyLogoUrl: "https://example.com/logo.png",
    });
    expect(ld.hiringOrganization.logo).toBe("https://example.com/logo.png");
  });

  it("includes hiringOrganization.sameAs when companyHomepageUrl is provided", () => {
    const ld = buildJobPostingJsonLd({
      ...sample,
      companyHomepageUrl: "https://acme.com",
    });
    expect(ld.hiringOrganization.sameAs).toBe("https://acme.com");
  });

  it("strips HTML and truncates description at 500 chars", () => {
    const html = "<p>" + "x".repeat(800) + "</p>";
    const ld = buildJobPostingJsonLd({ ...sample, description: html });
    expect(ld.description.length).toBeLessThanOrEqual(500);
    expect(ld.description).not.toContain("<p>");
  });
});
