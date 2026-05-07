import { describe, expect, it } from "vitest";
import {
  computeDedupKey,
  extractCity,
  extractCountryCode,
  normalizeCompanyName,
  normalizeTitle,
  slugify,
} from "./normalize";

describe("extractCountryCode", () => {
  it("detects US from 'City, ST, United States'", () => {
    expect(extractCountryCode("Everett, WA, United States")).toBe("us");
  });

  it("detects US from 'USA' suffix", () => {
    expect(extractCountryCode("Renton, WA, USA")).toBe("us");
  });

  it("detects UK from 'United Kingdom'", () => {
    expect(extractCountryCode("Maidstone, England, United Kingdom")).toBe("gb");
  });

  it("detects UK from 'England'", () => {
    expect(extractCountryCode("Wardle, England")).toBe("gb");
  });

  it("detects UK from 'Scotland' / 'Wales'", () => {
    expect(extractCountryCode("Edinburgh, Scotland")).toBe("gb");
    expect(extractCountryCode("Cardiff, Wales")).toBe("gb");
  });

  it("detects Ireland separately from the UK", () => {
    expect(extractCountryCode("Dublin, Ireland")).toBe("ie");
  });

  it("returns undefined for city-only inputs", () => {
    expect(extractCountryCode("Warrington")).toBeUndefined();
  });

  it("returns undefined for empty / Anywhere / Remote", () => {
    expect(extractCountryCode("")).toBeUndefined();
    expect(extractCountryCode("Anywhere")).toBeUndefined();
    expect(extractCountryCode("Remote")).toBeUndefined();
  });

  it("strips trailing parentheticals like '(Hybrid)' before parsing", () => {
    expect(extractCountryCode("London, United Kingdom (Hybrid)")).toBe("gb");
  });

  it("tolerates lowercase ISO codes if no name match", () => {
    expect(extractCountryCode("Munich, de")).toBe("de");
  });

  it("recognises common European countries", () => {
    expect(extractCountryCode("Berlin, Germany")).toBe("de");
    expect(extractCountryCode("Paris, France")).toBe("fr");
    expect(extractCountryCode("Madrid, Spain")).toBe("es");
    expect(extractCountryCode("Amsterdam, Netherlands")).toBe("nl");
  });
});

describe("normalizeCompanyName", () => {
  it("strips trailing legal suffixes", () => {
    expect(normalizeCompanyName("Acme Inc")).toBe("acme");
    expect(normalizeCompanyName("Acme, Ltd.")).toBe("acme");
    expect(normalizeCompanyName("Acme Corp")).toBe("acme");
    expect(normalizeCompanyName("Acme LLC")).toBe("acme");
    expect(normalizeCompanyName("Acme Limited")).toBe("acme");
    expect(normalizeCompanyName("Acme GmbH")).toBe("acme");
    expect(normalizeCompanyName("Acme plc")).toBe("acme");
    expect(normalizeCompanyName("Acme Corporation")).toBe("acme");
    expect(normalizeCompanyName("Acme Holdings")).toBe("acme");
  });

  it("preserves multi-word names", () => {
    expect(normalizeCompanyName("The New York Times")).toBe("the new york times");
    expect(normalizeCompanyName("Capital One Financial")).toBe(
      "capital one financial",
    );
  });

  it("drops parentheticals at the end", () => {
    expect(normalizeCompanyName("Acme (Acquired by Beta)")).toBe("acme");
    expect(normalizeCompanyName("Acme Inc (UK)")).toBe("acme");
  });

  it("collapses whitespace", () => {
    expect(normalizeCompanyName("Acme   Inc")).toBe("acme");
    expect(normalizeCompanyName("  Acme  ")).toBe("acme");
  });

  it("is idempotent", () => {
    const inputs = [
      "Acme Inc",
      "The New York Times",
      "Capital One Financial",
      "Acme (Acquired)",
      "  Sloppy  Spacing  ",
    ];
    for (const input of inputs) {
      const once = normalizeCompanyName(input);
      const twice = normalizeCompanyName(once);
      expect(twice).toBe(once);
    }
  });

  it("returns empty string for empty input", () => {
    expect(normalizeCompanyName("")).toBe("");
    expect(normalizeCompanyName("   ")).toBe("");
  });
});

describe("normalizeTitle", () => {
  it("preserves seniority qualifiers", () => {
    expect(normalizeTitle("Senior Engineer")).not.toBe(normalizeTitle("Engineer"));
    expect(normalizeTitle("Staff Engineer")).not.toBe(normalizeTitle("Engineer"));
    expect(normalizeTitle("Lead Designer")).not.toBe(normalizeTitle("Designer"));
  });

  it("drops trailing work-arrangement parentheticals", () => {
    expect(normalizeTitle("Engineer (Remote)")).toBe("engineer");
    expect(normalizeTitle("Engineer (Hybrid)")).toBe("engineer");
    expect(normalizeTitle("Engineer - Hybrid")).toBe("engineer");
    expect(normalizeTitle("Engineer - Remote")).toBe("engineer");
  });

  it("drops trailing posting IDs", () => {
    expect(normalizeTitle("SEO Manager - #3575381")).toBe("seo manager");
    expect(normalizeTitle("Engineer (#JR12345)")).toBe("engineer");
  });

  it("collapses whitespace and lowercases", () => {
    expect(normalizeTitle("Senior   Software  Engineer")).toBe(
      "senior software engineer",
    );
    expect(normalizeTitle("  Engineer  ")).toBe("engineer");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeTitle("")).toBe("");
  });
});

describe("extractCity", () => {
  it("returns first comma-separated token", () => {
    expect(extractCity("London, United Kingdom")).toBe("London");
    expect(extractCity("San Francisco, CA")).toBe("San Francisco");
    expect(extractCity("New York, NY, United States")).toBe("New York");
  });

  it("strips trailing work-arrangement parentheticals", () => {
    expect(extractCity("London, United Kingdom (Hybrid)")).toBe("London");
    expect(extractCity("Berlin, Germany (Remote)")).toBe("Berlin");
  });

  it("handles city-only input", () => {
    expect(extractCity("London")).toBe("London");
    expect(extractCity("Berlin (Remote)")).toBe("Berlin");
  });

  it("returns empty string for empty input", () => {
    expect(extractCity("")).toBe("");
  });

  it("trims whitespace from segments", () => {
    expect(extractCity("  London  ,  UK  ")).toBe("London");
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Senior Engineer")).toBe("senior-engineer");
    expect(slugify("Product Manager")).toBe("product-manager");
  });

  it("collapses non-alphanumeric runs into a single hyphen", () => {
    expect(slugify("hello!@# world")).toBe("hello-world");
    expect(slugify("a/b/c")).toBe("a-b-c");
  });

  it("drops leading and trailing hyphens", () => {
    expect(slugify("  Hello!  ")).toBe("hello");
    expect(slugify("---hello---")).toBe("hello");
  });

  it("preserves diacritics by converting them to hyphens (V1 behaviour)", () => {
    // Documented choice: V1's regex treated non-ASCII as separators rather
    // than transliterating. Replicated here for slug consistency with V1.
    // If we ever want to transliterate (Café → cafe), do it as an explicit
    // pre-pass before slugify, not inside it.
    expect(slugify("Café Manager")).toBe("caf-manager");
  });

  it("caps at maxLength with no trailing hyphen at the cut", () => {
    const long = "a".repeat(200);
    const result = slugify(long, 100);
    expect(result.length).toBe(100);
    expect(result.endsWith("-")).toBe(false);
  });

  it("respects custom max length", () => {
    expect(slugify("hello world", 5)).toBe("hello");
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
    expect(slugify("---")).toBe("");
  });
});

describe("computeDedupKey", () => {
  const sample = { title: "Senior Engineer", company: "Acme", city: "London" };

  it("is deterministic", async () => {
    const keys = await Promise.all(
      Array.from({ length: 10 }, () => computeDedupKey(sample)),
    );
    for (const k of keys) expect(k).toBe(keys[0]);
  });

  it("is hex-encoded sha256 (length 64, hex chars only)", async () => {
    const key = await computeDedupKey(sample);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes inputs case-insensitively", async () => {
    const a = await computeDedupKey({
      title: "Senior Engineer",
      company: "Acme",
      city: "London",
    });
    const b = await computeDedupKey({
      title: "senior engineer",
      company: "ACME",
      city: "LONDON",
    });
    expect(a).toBe(b);
  });

  it("treats company suffixes as equivalent", async () => {
    const a = await computeDedupKey({
      title: "Engineer",
      company: "Acme Inc",
      city: "London",
    });
    const b = await computeDedupKey({
      title: "Engineer",
      company: "Acme",
      city: "London",
    });
    expect(a).toBe(b);
  });

  it("treats work-arrangement parens as equivalent on title", async () => {
    const a = await computeDedupKey({
      title: "Engineer (Remote)",
      company: "Acme",
      city: "London",
    });
    const b = await computeDedupKey({
      title: "Engineer",
      company: "Acme",
      city: "London",
    });
    expect(a).toBe(b);
  });

  it("treats work-arrangement parens as equivalent on city", async () => {
    const a = await computeDedupKey({
      title: "Engineer",
      company: "Acme",
      city: "London (Hybrid)",
    });
    const b = await computeDedupKey({
      title: "Engineer",
      company: "Acme",
      city: "London",
    });
    expect(a).toBe(b);
  });

  it("city-sensitive: same role+company in different cities differ", async () => {
    const london = await computeDedupKey({ ...sample, city: "London" });
    const newYork = await computeDedupKey({ ...sample, city: "New York" });
    expect(london).not.toBe(newYork);
  });

  it("title-sensitive: different seniority differs", async () => {
    const senior = await computeDedupKey({ ...sample, title: "Senior Engineer" });
    const plain = await computeDedupKey({ ...sample, title: "Engineer" });
    expect(senior).not.toBe(plain);
  });

  it("company-sensitive: different companies differ", async () => {
    const acme = await computeDedupKey({ ...sample, company: "Acme" });
    const beta = await computeDedupKey({ ...sample, company: "Beta" });
    expect(acme).not.toBe(beta);
  });

  it("accepts city already extracted (no embedded comma)", async () => {
    // The mutation calls extractCity() before computeDedupKey, so the city
    // arg should already be a clean city name. Verify we don't choke on it.
    const key = await computeDedupKey({
      title: "Engineer",
      company: "Acme",
      city: "London",
    });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
