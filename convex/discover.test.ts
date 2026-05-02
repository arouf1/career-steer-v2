/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Tests for `discover.generateSnapshot` Steps 1-3:
 *  - Step 1: pull all guide embeddings
 *  - Step 2: compute facet sims (arc/currentState/domain/whole)
 *  - Step 3: top-K by wholeSim, then drop arcSim < ARC_SIM_FLOOR (0.3)
 *
 * Tasks 2.3+ refine the downstream curation; this test only covers the
 * floor filter, leaving lane assignment / curation as a degenerate stub.
 */

// Minimal valid `profiles` row. Must include every required field of the
// schema validator; optionals (name/headline/etc.) are omitted.
function profileSeed(userId: Id<"users">) {
  return {
    userId,
    sourceFormat: "pdf" as const,
    rawText: "test resume",
    parsedAt: Date.now(),
    reviewed: false,
    rateLimit: { countInWindow: 0, windowStartedAt: Date.now() },
    experience: [],
    education: [],
    skills: [],
  };
}

// Minimal valid `career_guides` row. `content` is optional in the schema
// — we leave it off to avoid faking the giant nested content shape.
function guideSeed(slug: string, title: string) {
  return {
    slug,
    title,
    titleNormalized: title.toLowerCase(),
    contentStatus: "complete" as const,
    illustrationStatus: "complete" as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("discover.generateSnapshot — quality floor (arcSim ≥ 0.3)", () => {
  it("includes high-arcSim guides and excludes guides below the arc floor", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, strongGuideId, belowFloorGuideId } =
      await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-floor-test",
          email: "floor@example.com",
        });
        const profileId = await ctx.db.insert("profiles", profileSeed(userId));

        // Profile facet vectors. Use 4-dim vectors — convex-test reads vectors
        // as plain arrays via .collect(); only vectorSearch enforces the
        // declared dimensions, and we don't use vectorSearch here.
        const embeddingId = await ctx.db.insert("profile_embeddings", {
          profileId,
          userId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        // Guide A: arc-aligned with the user → arcSim = 1.0, well above floor.
        const strongGuideId = await ctx.db.insert(
          "career_guides",
          guideSeed("strong-match", "Strong match"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: strongGuideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        // Guide B: orthogonal arc → arcSim = 0, below ARC_SIM_FLOOR (0.3).
        // Whole vector kept aligned so it would otherwise survive top-K by
        // wholeSim — proving the floor is what removed it.
        const belowFloorGuideId = await ctx.db.insert(
          "career_guides",
          guideSeed("below-floor", "Below floor"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: belowFloorGuideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [0, 1, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        return {
          userId,
          profileId,
          embeddingId,
          strongGuideId,
          belowFloorGuideId,
        };
      });

    await t.action(internal.discover.generateSnapshot, {
      userId,
      profileId,
      expectedProfileEmbeddingId: embeddingId,
      forceFreshReasons: true,
    });

    const snapshot = await t.run(async (ctx) => {
      return await ctx.db
        .query("discover_canvases")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.status).toBe("ready");

    const allCardGuideIds = snapshot!.lanes
      .flatMap((lane) => lane.cards)
      .map((card) => card.guideId);

    expect(allCardGuideIds).toContain(strongGuideId);
    expect(allCardGuideIds).not.toContain(belowFloorGuideId);

    // Junction table reflects the same set.
    const junction = await t.run(async (ctx) => {
      return await ctx.db
        .query("discover_snapshot_guides")
        .withIndex("by_snapshotId", (q) => q.eq("snapshotId", snapshot!._id))
        .collect();
    });
    const junctionGuideIds = junction.map((row) => row.guideId);
    expect(junctionGuideIds).toContain(strongGuideId);
    expect(junctionGuideIds).not.toContain(belowFloorGuideId);
  });

  it("throws profile-not-ready when the expected embedding has been deleted", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-missing-embedding",
        email: "missing@example.com",
      });
      const profileId = await ctx.db.insert("profiles", profileSeed(userId));
      const embeddingId = await ctx.db.insert("profile_embeddings", {
        profileId,
        userId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });
      // Simulate the embedding having been deleted between scheduling and
      // the action firing.
      await ctx.db.delete(embeddingId);
      return { userId, profileId, embeddingId };
    });

    await expect(
      t.action(internal.discover.generateSnapshot, {
        userId,
        profileId,
        expectedProfileEmbeddingId: embeddingId,
        forceFreshReasons: true,
      }),
    ).rejects.toThrow(/profile-not-ready/);
  });
});
