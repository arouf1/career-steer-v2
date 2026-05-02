/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const harness = () =>
  convexTest({
    schema,
    modules: import.meta.glob("./**/*.ts"),
  });

const TEST_RATE_LIMIT = { countInWindow: 1, windowStartedAt: Date.now() };

const seedProfile = async (
  t: ReturnType<typeof harness>,
  experience: Array<{
    title: string;
    company: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  }>,
  tokenSuffix?: string,
): Promise<{ userId: Id<"users">; profileId: Id<"profiles"> }> => {
  return await t.run(async (ctx) => {
    const tokenIdentifier =
      tokenSuffix ?? `test|${Math.random().toString(36).slice(2)}`;
    const userId = await ctx.db.insert("users", {
      tokenIdentifier,
      email: `${tokenIdentifier}@test.local`,
    });
    const profileId = await ctx.db.insert("profiles", {
      userId,
      sourceFormat: "pdf" as const,
      rawText: "test rÃ©sumÃ©",
      parsedAt: Date.now(),
      reviewed: true,
      rateLimit: TEST_RATE_LIMIT,
      experience,
      education: [],
      skills: [],
    });
    return { userId, profileId };
  });
};

const seedCanon = async (
  t: ReturnType<typeof harness>,
  prefilteredKey: string,
  canonicalTitle: string,
) => {
  await t.mutation(internal.titleCanonicalization._writeThrough, {
    prefilteredKey,
    sourceTitle: canonicalTitle,
    canonicalTitle,
    model: "google/gemini-3.1-pro-preview",
    confidence: 0.99,
  });
};

describe("profileGuideSeeding.seedGuidesFromProfile", () => {
  it("dedupes titles within a single profile (3 'Software Engineer' roles -> 1 guide)", async () => {
    const t = harness();
    await seedCanon(t, "software engineer", "Software Engineer");

    const { userId } = await seedProfile(t, [
      { title: "Software Engineer", company: "A", startDate: "2018-01" },
      { title: "Software Engineer", company: "B", startDate: "2020-01" },
      { title: "Software Engineer", company: "C", startDate: "2022-01" },
    ]);

    const result = await t.action(
      internal.profileGuideSeeding.seedGuidesFromProfile,
      { userId },
    );
    expect(result.skipped).toBe(false);
    expect(result.seededSlugs).toHaveLength(1);

    const guides = await t.run(async (ctx) =>
      ctx.db.query("career_guides").collect(),
    );
    expect(guides).toHaveLength(1);
    expect(guides[0].title).toBe("Software Engineer");
  });

  it("two profiles with overlapping titles produce one guide row per canonical", async () => {
    const t = harness();
    await seedCanon(t, "product manager", "Product Manager");

    const { userId: user1 } = await seedProfile(
      t,
      [{ title: "PM", company: "A", startDate: "2018-01" }],
      "user1",
    );
    const { userId: user2 } = await seedProfile(
      t,
      [{ title: "Product Manager", company: "B", startDate: "2019-01" }],
      "user2",
    );

    await Promise.all([
      t.action(internal.profileGuideSeeding.seedGuidesFromProfile, {
        userId: user1,
      }),
      t.action(internal.profileGuideSeeding.seedGuidesFromProfile, {
        userId: user2,
      }),
    ]);

    const guides = await t.run(async (ctx) =>
      ctx.db
        .query("career_guides")
        .withIndex("by_title_normalized", (q) =>
          q.eq("titleNormalized", "product manager"),
        )
        .collect(),
    );
    expect(guides).toHaveLength(1);
  });

  it("is idempotent — re-running on an unchanged profile creates no new guides", async () => {
    const t = harness();
    await seedCanon(t, "data scientist", "Data Scientist");

    const { userId } = await seedProfile(t, [
      { title: "Data Scientist", company: "A", startDate: "2020-01" },
    ]);

    const r1 = await t.action(
      internal.profileGuideSeeding.seedGuidesFromProfile,
      { userId },
    );
    expect(r1.skipped).toBe(false);

    const r2 = await t.action(
      internal.profileGuideSeeding.seedGuidesFromProfile,
      { userId },
    );
    expect(r2.skipped).toBe(true);

    const guides = await t.run(async (ctx) =>
      ctx.db.query("career_guides").collect(),
    );
    expect(guides).toHaveLength(1);
  });

  it("caps at 10 most-recent jobs (sorted by endDate desc; missing endDate = current)", async () => {
    const t = harness();
    // Use letter-suffix titles to avoid the trailing-level-digit stripper in
    // the abbreviation prefilter. Each is a distinct prefilter key.
    const letters = "ABCDEFGHIJKL".split(""); // 12 entries
    const titles = letters.map((l) => `Apple ${l} Engineer`);
    for (const title of titles) {
      await seedCanon(t, title.toLowerCase(), title);
    }

    // Index 0 (oldest) → index 11 (newest). With cap of 10, we expect
    // indices 2–11 to land — i.e. titles ending in C..L. Indices 0–1
    // (A, B) should be dropped.
    const experience = titles.map((title, i) => ({
      title,
      company: `Co${i}`,
      startDate: `${2010 + i}-01`,
      endDate: `${2010 + i}-12`,
    }));
    const { userId } = await seedProfile(t, experience);

    await t.action(internal.profileGuideSeeding.seedGuidesFromProfile, {
      userId,
    });

    const guides = await t.run(async (ctx) =>
      ctx.db.query("career_guides").collect(),
    );
    expect(guides).toHaveLength(10);
    const guideTitles = guides.map((g) => g.title);
    expect(guideTitles).not.toContain("Apple A Engineer");
    expect(guideTitles).not.toContain("Apple B Engineer");
    expect(guideTitles).toContain("Apple L Engineer");
    expect(guideTitles).toContain("Apple C Engineer");
  });

  it("returns gracefully when profile has no experience", async () => {
    const t = harness();
    const { userId } = await seedProfile(t, []);
    const result = await t.action(
      internal.profileGuideSeeding.seedGuidesFromProfile,
      { userId },
    );
    expect(result.seededSlugs).toEqual([]);
  });
});
