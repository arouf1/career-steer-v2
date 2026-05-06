// Schema.org JobPosting JSON-LD builder for /jobs/listing/[city]/[company]/[title]/[id].
// Mirrors V1 (`/Users/aqilrouf/Documents/Projects/career-steer/src/lib/structured-data.ts`)
// field-for-field — V1 was Google-validated and ranked, so this is a known-good
// shape. Adapted to V2's job_postings schema (detectedExtensions instead of
// V1's parsed jobType/salaryRange/workArrangement).
//
// Google's JobPosting docs: https://developers.google.com/search/docs/appearance/structured-data/job-posting

export type JobPostingInput = {
  jobId: string;
  title: string;
  companyName: string;
  companyLogoUrl: string | null;
  companyHomepageUrl: string | null;
  location: string;
  description: string;
  schedule: string | null;       // "Full-time", "Contract", etc — from detectedExtensions
  salary: string | null;          // free-text — from detectedExtensions
  workFromHome: boolean | null;   // true if remote
  experienceLevel: string | null;
  industry: string | null;
  firstSeenAt: number;
  canonicalUrl: string;
  validForDays: number;           // typically 45 (matches the staleness archive window)
};

export type JobPostingJsonLd = {
  "@context": "https://schema.org";
  "@type": "JobPosting";
  identifier: {
    "@type": "PropertyValue";
    name: string;
    value: string;
  };
  title: string;
  description: string;
  datePosted: string;
  validThrough: string;
  employmentType: string;
  hiringOrganization: {
    "@type": "Organization";
    name: string;
    sameAs?: string;
    logo?: string;
  };
  jobLocation?: {
    "@type": "Place";
    address: {
      "@type": "PostalAddress";
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
    };
  };
  jobLocationType?: "TELECOMMUTE";
  applicantLocationRequirements?: {
    "@type": "Country";
    name: string;
  };
  baseSalary?: {
    "@type": "MonetaryAmount";
    currency: string;
    value: {
      "@type": "QuantitativeValue";
      value?: number;
      minValue?: number;
      maxValue?: number;
      unitText: "YEAR";
    };
  };
  experienceRequirements?: string;
  industry?: string;
  url: string;
  publisher: {
    "@type": "Organization";
    name: string;
    url: string;
    logo: { "@type": "ImageObject"; url: string };
  };
};

// ── Detection helpers (exported for tests + reuse in the page handler) ────

const UNDISCLOSED_PATTERNS = [
  /^confidential$/i,
  /^undisclosed/i,
  /^a\s+(leading|top|major|global|well[\s-]known|prominent)\s+/i,
  // Anything starting with "stealth" — broader than V1's pattern, which only
  // matched "Stealth", "Stealth Mode", etc. Picks up "Stealth Mode Startup"
  // and any other variants source listings throw at us.
  /^stealth\b/i,
  /^private\s+(company|employer)$/i,
  /company\s+confidential/i,
];

export function isUndisclosedEmployer(
  companyName: string | null | undefined,
): boolean {
  if (companyName == null) return true;
  const trimmed = companyName.trim();
  if (trimmed.length === 0) return true;
  return UNDISCLOSED_PATTERNS.some((re) => re.test(trimmed));
}

export function normalizeEmploymentType(
  schedule: string | null | undefined,
): string {
  if (!schedule) return "FULL_TIME";
  const n = schedule.toLowerCase().replace(/[\s_-]+/g, "");
  if (n.includes("fulltime")) return "FULL_TIME";
  if (n.includes("parttime")) return "PART_TIME";
  if (n.includes("contract") || n.includes("freelance")) return "CONTRACTOR";
  if (n.includes("temporary") || n.includes("temp")) return "TEMPORARY";
  if (n.includes("intern")) return "INTERN";
  if (n.includes("volunteer")) return "VOLUNTEER";
  if (n.includes("perdiem") || n.includes("casual")) return "PER_DIEM";
  return "OTHER";
}

export function deriveCountryFromLocation(
  location: string,
): { code: string; name: string } | null {
  const loc = location.toLowerCase();
  if (
    /\b(united kingdom|uk|england|scotland|wales|northern ireland)\b/.test(loc)
  ) {
    return { code: "GB", name: "United Kingdom" };
  }
  if (/\b(united states|usa|u\.s\.a?)\b/.test(loc)) {
    return { code: "US", name: "United States" };
  }
  if (/\b(canada)\b/.test(loc)) return { code: "CA", name: "Canada" };
  if (/\b(australia)\b/.test(loc)) return { code: "AU", name: "Australia" };
  if (/\b(ireland)\b/.test(loc)) return { code: "IE", name: "Ireland" };
  // Fall back to US-state suffix heuristics.
  if (
    /,\s*(ca|ny|tx|fl|il|wa|ma|dc|nj|co|ga|pa|oh|mi|nc|va|az|or|mn|wi)\b/.test(
      loc,
    )
  ) {
    return { code: "US", name: "United States" };
  }
  return null;
}

function currencyForCountry(country: { code: string } | null): string {
  if (!country) return "USD";
  switch (country.code) {
    case "GB":
      return "GBP";
    case "US":
      return "USD";
    case "CA":
      return "CAD";
    case "AU":
      return "AUD";
    case "IE":
      return "EUR";
    default:
      return "USD";
  }
}

export function parseSalary(
  salary: string | null | undefined,
): { value?: number; minValue?: number; maxValue?: number } | null {
  if (!salary) return null;
  // Filter noise. Keep numbers >= 100 so abbreviated values ("$120k", "$120")
  // still register, but skip 1-2 digit values. Also skip 4-digit numbers in
  // the year-like range 1900-2100 — almost always a date reference, never
  // a salary figure.
  const isYearLike = (n: number) => n >= 1900 && n <= 2100;
  const numbers = salary
    .match(/[\d,]+/g)
    ?.map((n) => parseInt(n.replace(/,/g, ""), 10))
    .filter((n) => !Number.isNaN(n) && n >= 100 && !isYearLike(n));
  if (!numbers || numbers.length === 0) return null;
  if (numbers.length === 1) return { value: numbers[0] };
  return { minValue: Math.min(...numbers), maxValue: Math.max(...numbers) };
}

// ── Assembly ──────────────────────────────────────────────────────────────

export function buildJobPostingJsonLd(
  input: JobPostingInput,
): JobPostingJsonLd {
  const cleanDescription = input.description
    .replace(/<[^>]*>/g, "")
    .replace(/\n+/g, " ")
    .trim()
    .substring(0, 500);

  const country = deriveCountryFromLocation(input.location);
  const isRemote = input.workFromHome === true;
  const [rawCity, rawRegion] = input.location.split(",").map((s) => s.trim());

  const postalAddress: NonNullable<JobPostingJsonLd["jobLocation"]>["address"] =
    {
      "@type": "PostalAddress",
      ...(rawCity ? { addressLocality: rawCity } : {}),
      ...(rawRegion && rawRegion !== country?.name
        ? { addressRegion: rawRegion }
        : {}),
      ...(country ? { addressCountry: country.code } : {}),
    };

  const salary = parseSalary(input.salary);
  const baseSalary: JobPostingJsonLd["baseSalary"] | undefined = salary
    ? {
        "@type": "MonetaryAmount",
        currency: currencyForCountry(country),
        value: {
          "@type": "QuantitativeValue",
          ...(salary.value !== undefined ? { value: salary.value } : {}),
          ...(salary.minValue !== undefined
            ? { minValue: salary.minValue }
            : {}),
          ...(salary.maxValue !== undefined
            ? { maxValue: salary.maxValue }
            : {}),
          unitText: "YEAR",
        },
      }
    : undefined;

  // Publisher self-reference. Domain is read from NEXT_PUBLIC_SITE_URL with a
  // safe default — this is server-rendered HTML, so the env is read at build
  // time on the Vercel side.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://career-steer.app";

  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    identifier: {
      "@type": "PropertyValue",
      name: input.companyName,
      value: input.jobId,
    },
    title: input.title,
    description: cleanDescription,
    datePosted: new Date(input.firstSeenAt).toISOString(),
    validThrough: new Date(
      input.firstSeenAt + input.validForDays * 24 * 60 * 60 * 1000,
    ).toISOString(),
    employmentType: normalizeEmploymentType(input.schedule),
    hiringOrganization: {
      "@type": "Organization",
      name: input.companyName,
      ...(input.companyHomepageUrl
        ? { sameAs: input.companyHomepageUrl }
        : {}),
      ...(input.companyLogoUrl ? { logo: input.companyLogoUrl } : {}),
    },
    ...(isRemote
      ? {}
      : {
          jobLocation: {
            "@type": "Place",
            address: postalAddress,
          },
        }),
    ...(isRemote ? { jobLocationType: "TELECOMMUTE" as const } : {}),
    ...(isRemote && country
      ? {
          applicantLocationRequirements: {
            "@type": "Country" as const,
            name: country.name,
          },
        }
      : {}),
    ...(baseSalary ? { baseSalary } : {}),
    ...(input.experienceLevel
      ? { experienceRequirements: input.experienceLevel }
      : {}),
    ...(input.industry ? { industry: input.industry } : {}),
    url: input.canonicalUrl,
    publisher: {
      "@type": "Organization",
      name: "Career Steer",
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/logo.png`,
      },
    },
  };
}
