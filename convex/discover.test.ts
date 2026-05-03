/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
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

// Career-stage suite: the discover canvas's 4-lane bucketer compares the
// user's `profile_enrichments.careerStage` against each guide's
// `content.typicalCareerStage` to assign a lane (forward → linear,
// equal → adjacent, lower → earlier, missing → transformational). Tests
// that rely on cards landing in a SPECIFIC lane (rather than just on
// rank/floor logic) seed both sides via these helpers.

type CareerStage =
  | "early-career"
  | "mid-career"
  | "senior-IC"
  | "manager"
  | "director"
  | "exec";

// Minimal valid `profile_enrichments` seed. Used with `careerStage` set so
// the bucketer can rank the user against guides. The required arrays/flags
// are zero-length for compactness — the only field the discover pipeline
// reads is `careerStage`.
function enrichmentSeed(args: {
  profileId: Id<"profiles">;
  userId: Id<"users">;
  careerStage: CareerStage;
}) {
  return {
    profileId: args.profileId,
    userId: args.userId,
    status: "ready" as const,
    careerStage: args.careerStage,
    enrichedExperience: [],
    enrichedSkills: [],
    enrichedEducation: [],
    confidenceFlags: [],
    model: "test",
    enrichedAt: Date.now(),
  };
}

// Minimal `career_guides.content` shape with a chosen `typicalCareerStage`.
// All other required content fields are populated with empty strings/arrays
// so the schema validator accepts the row. Individual tests only care about
// `typicalCareerStage` (lane bucketing) and occasionally `overview`/`title`
// (rerank prompt + LLM reasons).
function guideContentSeed(stage: CareerStage) {
  const emptyRegion = {
    salary: { entry: "", mid: "", senior: "" },
    careerOutlook: "",
    learningPath: [] as string[],
    relatedRoles: [] as string[],
  };
  return {
    overview: "",
    typicalSkills: [] as string[],
    dayToDay: "",
    riskFactors: [] as string[],
    whyConsider: "",
    regional: { us: emptyRegion, uk: emptyRegion },
    typicalCareerStage: stage,
  };
}

// Build a guide doc with `content` already populated for a given career
// stage. Convenience shortcut: use directly inside `ctx.db.insert("career_guides", ...)`.
function guideSeedWithStage(slug: string, title: string, stage: CareerStage) {
  return {
    ...guideSeed(slug, title),
    content: guideContentSeed(stage),
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

describe("discover.generateSnapshot — Step 4 (dismissals) + Step 5 (lanes)", () => {
  it("excludes dismissed guides from the snapshot", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, dismissedGuideId, keptGuideId } =
      await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-dismissal-test",
          email: "dismiss@example.com",
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

        // Both guides have arc-aligned vectors so they survive the arc floor;
        // only the dismissal filter should remove `dismissedGuideId`.
        const dismissedGuideId = await ctx.db.insert(
          "career_guides",
          guideSeed("dismissed", "Dismissed"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: dismissedGuideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        const keptGuideId = await ctx.db.insert(
          "career_guides",
          guideSeed("kept", "Kept"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: keptGuideId,
          wholeVector: [0.9, 0.1, 0, 0],
          arcVector: [0.9, 0.1, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        await ctx.db.insert("discover_reactions", {
          userId,
          guideId: dismissedGuideId,
          reaction: "dismissed",
          reactedAt: Date.now(),
        });

        return {
          userId,
          profileId,
          embeddingId,
          dismissedGuideId,
          keptGuideId,
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
    const ids = snapshot!.lanes.flatMap((lane) =>
      lane.cards.map((c) => c.guideId),
    );
    expect(ids).not.toContain(dismissedGuideId);
    expect(ids).toContain(keptGuideId);
  });

  it("buckets candidates into 4 lanes by career-stage comparison + wholeSim floor", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    // User is `manager` rank. Seed four guides:
    //   forwardId   stage="exec"        (rank > user) → linear
    //   sidewaysId  stage="manager"     (rank == user) → adjacent
    //   earlierId   stage="mid-career"  (rank < user) → earlier
    //   noStageId   stage missing       (unknown) → transformational
    // All four guides share `wholeSim = 1.0` so they're all above the
    // `SIDEWAYS_WHOLE_SIM_FLOOR` (0.72) — the only differentiator is stage.
    const {
      userId,
      profileId,
      embeddingId,
      forwardId,
      sidewaysId,
      earlierId,
      noStageId,
    } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-lane-test",
        email: "lane@example.com",
      });
      // seedingGuideSlugs includes "earlier" so the earlier-stage guide
      // below enters the earlier lane via the experience override (the only
      // path into earlier after the lane-tightening change). Without this
      // the guide would fall through to transformational.
      const profileId = await ctx.db.insert("profiles", {
        ...profileSeed(userId),
        seedingGuideSlugs: ["earlier"],
      });
      await ctx.db.insert(
        "profile_enrichments",
        enrichmentSeed({ profileId, userId, careerStage: "manager" }),
      );
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

      const forwardId = await ctx.db.insert(
        "career_guides",
        guideSeedWithStage("forward", "Forward (exec)", "exec"),
      );
      await ctx.db.insert("career_guide_embeddings", {
        guideId: forwardId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });

      const sidewaysId = await ctx.db.insert(
        "career_guides",
        guideSeedWithStage("sideways", "Sideways (manager)", "manager"),
      );
      await ctx.db.insert("career_guide_embeddings", {
        guideId: sidewaysId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });

      const earlierId = await ctx.db.insert(
        "career_guides",
        guideSeedWithStage("earlier", "Earlier (mid-career)", "mid-career"),
      );
      await ctx.db.insert("career_guide_embeddings", {
        guideId: earlierId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });

      const noStageId = await ctx.db.insert(
        "career_guides",
        guideSeed("no-stage", "No stage"),
      );
      await ctx.db.insert("career_guide_embeddings", {
        guideId: noStageId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
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
        forwardId,
        sidewaysId,
        earlierId,
        noStageId,
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

    const lanes = Object.fromEntries(
      snapshot!.lanes.map((l) => [l.kind, l.cards.map((c) => c.guideId)]),
    );

    expect(lanes.linear).toEqual([forwardId]);
    expect(lanes.adjacent).toEqual([sidewaysId]);
    expect(lanes.earlier).toEqual([earlierId]);
    expect(lanes.transformational).toEqual([noStageId]);
  });

  it("admits to 'earlier' only via seedingGuideSlugs override; non-seeded stage-down guides go to transformational", async () => {
    // Regression for the lane-tightening change: 'earlier' is now strictly
    // "roles the user has held" — embedding-only admissions (the old
    // wholeSim/domainSim floors) are gone. Two guides at the same lower
    // stage and high embedding similarity to the user: one whose slug is
    // in profile.seedingGuideSlugs, one not. Only the seeded one enters
    // 'earlier'; the unseeded one — even with perfect cosine — goes to
    // transformational. This is the explicit replacement for the old
    // "domainSim floor keeps Actuary out" test, since there's no longer
    // an embedding path into earlier for either case.
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, seededId, unseededId } =
      await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-earlier-override-test",
          email: "earlier-override@example.com",
        });
        const profileId = await ctx.db.insert("profiles", {
          ...profileSeed(userId),
          // Only "past-role-seeded" qualifies for earlier. The other guide
          // below has equally strong embedding signal but no seed entry.
          seedingGuideSlugs: ["past-role-seeded"],
        });
        await ctx.db.insert(
          "profile_enrichments",
          enrichmentSeed({ profileId, userId, careerStage: "manager" }),
        );
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

        const seededId = await ctx.db.insert(
          "career_guides",
          guideSeedWithStage(
            "past-role-seeded",
            "Past role (seeded)",
            "mid-career",
          ),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: seededId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        // Same shape as the seeded one but slug is NOT in seedingGuideSlugs.
        // Pre-tightening this would have entered 'earlier' via the embedding
        // floors. Post-tightening it falls through to transformational.
        const unseededId = await ctx.db.insert(
          "career_guides",
          guideSeedWithStage(
            "lookalike-not-seeded",
            "Lookalike (not seeded)",
            "mid-career",
          ),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: unseededId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        return { userId, profileId, embeddingId, seededId, unseededId };
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

    const lanes = Object.fromEntries(
      snapshot!.lanes.map((l) => [l.kind, l.cards.map((c) => c.guideId)]),
    );

    expect(lanes.earlier).toEqual([seededId]);
    expect(lanes.transformational).toEqual([unseededId]);
  });
});

describe("discover.generateSnapshot — Step 6c (aspirational with rerank)", () => {
  it("uses rerank top-1 as the aspirational slot when rerank succeeds", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const {
      userId,
      profileId,
      embeddingId,
      strongIds,
      bridgeIds,
      aspirationalId,
      otherAspirationalId,
    } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-aspirational-rerank",
        email: "asp-rerank@example.com",
      });
      const profileId = await ctx.db.insert("profiles", profileSeed(userId));
      // User stage = mid-career so guides marked `manager` land in the
      // linear lane (forward) for the slot-curation assertions below.
      await ctx.db.insert(
        "profile_enrichments",
        enrichmentSeed({ profileId, userId, careerStage: "mid-career" }),
      );
      const embeddingId = await ctx.db.insert("profile_embeddings", {
        profileId,
        userId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        arcSourceText: "I want to write things people remember",
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });

      // 3 strong picks: arcSim = 1.0, domainSim = 0.0. Stage = "manager"
      // (forward of user's mid-career) → linear lane.
      const strongIds: Id<"career_guides">[] = [];
      for (let i = 0; i < 3; i++) {
        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeedWithStage(`strong-${i}`, `Strong ${i}`, "manager"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [0, 1, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });
        strongIds.push(guideId);
      }

      // 2 bridge picks: arcSim = 0.6, domainSim = 1.0. Stage = "manager"
      // → linear lane.
      const bridgeIds: Id<"career_guides">[] = [];
      for (let i = 0; i < 2; i++) {
        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeedWithStage(`bridge-${i}`, `Bridge ${i}`, "manager"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [0.6, 0.8, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });
        bridgeIds.push(guideId);
      }

      // Aspirational candidates: arcSim = 0.8 (above floor, below strong).
      // Both share the same scores, so the rerank seam decides which wins.
      // Stage = "manager" → linear lane (so they compete for the
      // aspirational slot within linear).
      const aspirationalId = await ctx.db.insert(
        "career_guides",
        guideSeedWithStage("rerank-wins", "Rerank wins", "manager"),
      );
      await ctx.db.insert("career_guide_embeddings", {
        guideId: aspirationalId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [0.8, 0.6, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [0, 1, 0, 0],
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });

      const otherAspirationalId = await ctx.db.insert(
        "career_guides",
        guideSeedWithStage("rerank-loses", "Rerank loses", "manager"),
      );
      await ctx.db.insert("career_guide_embeddings", {
        guideId: otherAspirationalId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [0.8, 0.6, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [0, 1, 0, 0],
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });

      // Filler candidates without `typicalCareerStage`. They fall through
      // to the transformational lane (compareStages returns "unknown"),
      // leaving the linear lane to the 7 expected candidates above.
      for (let i = 0; i < 28; i++) {
        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeed(`filler-${i}`, `Filler ${i}`),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 1, 0, 0], // arcSim ≈ 0.707 (above floor)
          currentStateVector: [0.5, 0.866, 0, 0], // currentStateSim ≈ 0.5
          domainVector: [0, 1, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });
      }

      return {
        userId,
        profileId,
        embeddingId,
        strongIds,
        bridgeIds,
        aspirationalId,
        otherAspirationalId,
      };
    });

    // Inject a deterministic rerank: pick the index whose document text
    // contains "Rerank wins". The test cleanup runs in finally so a thrown
    // assertion doesn't leak the stub into other tests.
    (globalThis as any).__testRerank__ = async (args: {
      query: string;
      documents: string[];
      topN: number;
    }) => {
      const idx = args.documents.findIndex((d) => d.includes("Rerank wins"));
      return idx >= 0
        ? [{ index: idx, relevanceScore: 0.99 }]
        : [{ index: 0, relevanceScore: 0.5 }];
    };
    // Stub Step 8 reasons LLM so we don't touch the network here.
    (globalThis as any).__testReasonsLLM__ = async (args: {
      arcSourceText: string;
      pairs: Array<{ guideId: string }>;
    }) => {
      const map = new Map<string, string>();
      for (const p of args.pairs) map.set(p.guideId, `reason for ${p.guideId}`);
      return map;
    };

    try {
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

      const linearLane = snapshot!.lanes.find((l) => l.kind === "linear");
      expect(linearLane).toBeDefined();

      const aspirationalCards = linearLane!.cards.filter(
        (c) => c.slotKind === "aspirational",
      );
      expect(aspirationalCards).toHaveLength(1);
      expect(aspirationalCards[0].guideId).toBe(aspirationalId);
      expect(aspirationalCards[0].guideId).not.toBe(otherAspirationalId);

      // Sanity: strong + bridge counts unchanged by 6c.
      expect(
        linearLane!.cards.filter((c) => c.slotKind === "strong"),
      ).toHaveLength(3);
      expect(
        linearLane!.cards.filter((c) => c.slotKind === "bridge"),
      ).toHaveLength(2);

      // Reference both strong + bridge id sets so the test data is exercised.
      expect(strongIds).toHaveLength(3);
      expect(bridgeIds).toHaveLength(2);
    } finally {
      delete (globalThis as any).__testRerank__;
      delete (globalThis as any).__testReasonsLLM__;
    }
  });

  it("falls back to formula when rerank throws", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, fallbackCandidateIds } =
      await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-aspirational-fallback",
          email: "asp-fallback@example.com",
        });
        const profileId = await ctx.db.insert("profiles", profileSeed(userId));
        await ctx.db.insert(
          "profile_enrichments",
          enrichmentSeed({ profileId, userId, careerStage: "mid-career" }),
        );
        const embeddingId = await ctx.db.insert("profile_embeddings", {
          profileId,
          userId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          arcSourceText: "I want to write things people remember",
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        // 3 strong + 2 bridge + 2 aspirational candidates, all stage="manager"
        // (forward of user's mid-career) so they land in the linear lane.
        for (let i = 0; i < 3; i++) {
          const guideId = await ctx.db.insert(
            "career_guides",
            guideSeedWithStage(`strong-${i}`, `Strong ${i}`, "manager"),
          );
          await ctx.db.insert("career_guide_embeddings", {
            guideId,
            wholeVector: [1, 0, 0, 0],
            arcVector: [1, 0, 0, 0],
            currentStateVector: [1, 0, 0, 0],
            domainVector: [0, 1, 0, 0],
            dimensions: 4,
            model: "test",
            generatedAt: Date.now(),
          });
        }
        for (let i = 0; i < 2; i++) {
          const guideId = await ctx.db.insert(
            "career_guides",
            guideSeedWithStage(`bridge-${i}`, `Bridge ${i}`, "manager"),
          );
          await ctx.db.insert("career_guide_embeddings", {
            guideId,
            wholeVector: [1, 0, 0, 0],
            arcVector: [0.6, 0.8, 0, 0],
            currentStateVector: [1, 0, 0, 0],
            domainVector: [1, 0, 0, 0],
            dimensions: 4,
            model: "test",
            generatedAt: Date.now(),
          });
        }

        const fallbackCandidateIds: Id<"career_guides">[] = [];
        for (let i = 0; i < 2; i++) {
          const guideId = await ctx.db.insert(
            "career_guides",
            guideSeedWithStage(`fallback-${i}`, `Fallback ${i}`, "manager"),
          );
          await ctx.db.insert("career_guide_embeddings", {
            guideId,
            wholeVector: [1, 0, 0, 0],
            arcVector: [0.8, 0.6, 0, 0],
            currentStateVector: [1, 0, 0, 0],
            domainVector: [0, 1, 0, 0],
            dimensions: 4,
            model: "test",
            generatedAt: Date.now(),
          });
          fallbackCandidateIds.push(guideId);
        }

        // Filler candidates without stage → fall through to transformational
        // lane (compareStages returns "unknown"); they don't pollute linear.
        for (let i = 0; i < 28; i++) {
          const guideId = await ctx.db.insert(
            "career_guides",
            guideSeed(`filler-${i}`, `Filler ${i}`),
          );
          await ctx.db.insert("career_guide_embeddings", {
            guideId,
            wholeVector: [1, 0, 0, 0],
            arcVector: [1, 1, 0, 0], // arcSim ≈ 0.707 (above floor)
            currentStateVector: [0.5, 0.866, 0, 0], // currentStateSim ≈ 0.5
            domainVector: [0, 1, 0, 0],
            dimensions: 4,
            model: "test",
            generatedAt: Date.now(),
          });
        }

        return { userId, profileId, embeddingId, fallbackCandidateIds };
      });

    // Rerank throws; pickAspirational must fall back to the formula path.
    (globalThis as any).__testRerank__ = async () => {
      throw new Error("rerank-network-down");
    };
    // Stub Step 8 reasons LLM so we don't touch the network here.
    (globalThis as any).__testReasonsLLM__ = async (args: {
      arcSourceText: string;
      pairs: Array<{ guideId: string }>;
    }) => {
      const map = new Map<string, string>();
      for (const p of args.pairs) map.set(p.guideId, `reason for ${p.guideId}`);
      return map;
    };

    try {
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
      const linearLane = snapshot!.lanes.find((l) => l.kind === "linear");
      expect(linearLane).toBeDefined();
      const aspirationalCards = linearLane!.cards.filter(
        (c) => c.slotKind === "aspirational",
      );
      expect(aspirationalCards).toHaveLength(1);
      // Formula fallback must pick from the leftover candidates (the 2
      // "Fallback i" guides, since strong + bridge consumed the others).
      expect(fallbackCandidateIds).toContain(aspirationalCards[0].guideId);
    } finally {
      delete (globalThis as any).__testRerank__;
      delete (globalThis as any).__testReasonsLLM__;
    }
  });
});

describe("discover.generateSnapshot — Step 6a/b (strong + bridge slots)", () => {
  it("picks top-3 strong + top-2 bridge per lane with correct slotKind", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, strongIds, bridgeIds } =
      await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-curation-test",
          email: "curate@example.com",
        });
        const profileId = await ctx.db.insert("profiles", profileSeed(userId));
        await ctx.db.insert(
          "profile_enrichments",
          enrichmentSeed({ profileId, userId, careerStage: "mid-career" }),
        );
        // Profile facets:
        //   arcVector            = [1,0,0,0]
        //   currentStateVector   = [1,0,0,0]
        //   domainVector         = [0,0,1,0]
        const embeddingId = await ctx.db.insert("profile_embeddings", {
          profileId,
          userId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [0, 0, 1, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        // 3 "Strong i" guides:
        //   arcVector    = [1,0,0,0]      → arcSim = 1.0
        //   domainVector = [0,1,0,0]      → domainSim = 0.0
        // Stage = "manager" (forward of mid-career) → linear lane.
        // → win the strong slots on arcSim, lose the bridge race on domainSim.
        const strongIds: Id<"career_guides">[] = [];
        for (let i = 0; i < 3; i++) {
          const guideId = await ctx.db.insert(
            "career_guides",
            guideSeedWithStage(`strong-${i}`, `Strong ${i}`, "manager"),
          );
          await ctx.db.insert("career_guide_embeddings", {
            guideId,
            wholeVector: [1, 0, 0, 0],
            arcVector: [1, 0, 0, 0],
            currentStateVector: [1, 0, 0, 0],
            domainVector: [0, 1, 0, 0],
            dimensions: 4,
            model: "test",
            generatedAt: Date.now(),
          });
          strongIds.push(guideId);
        }

        // 3 "Bridge i" guides:
        //   arcVector    = [0.6, 0.8, 0, 0] → arcSim = 0.6 (above floor)
        //   domainVector = [0,0,1,0]        → domainSim = 1.0
        // Stage = "manager" → linear lane.
        // → top-2 by domainSim once strong picks are excluded.
        const bridgeIds: Id<"career_guides">[] = [];
        for (let i = 0; i < 3; i++) {
          const guideId = await ctx.db.insert(
            "career_guides",
            guideSeedWithStage(`bridge-${i}`, `Bridge ${i}`, "manager"),
          );
          await ctx.db.insert("career_guide_embeddings", {
            guideId,
            wholeVector: [1, 0, 0, 0],
            arcVector: [0.6, 0.8, 0, 0],
            currentStateVector: [1, 0, 0, 0],
            domainVector: [0, 0, 1, 0],
            dimensions: 4,
            model: "test",
            generatedAt: Date.now(),
          });
          bridgeIds.push(guideId);
        }

        // Filler candidates without stage → fall through to transformational
        // lane (compareStages returns "unknown"); they don't pollute linear.
        for (let i = 0; i < 24; i++) {
          const guideId = await ctx.db.insert(
            "career_guides",
            guideSeed(`filler-${i}`, `Filler ${i}`),
          );
          await ctx.db.insert("career_guide_embeddings", {
            guideId,
            wholeVector: [1, 0, 0, 0],
            arcVector: [1, 1, 0, 0], // arcSim ≈ 0.707 (above floor)
            currentStateVector: [0.5, 0.866, 0, 0], // currentStateSim ≈ 0.5
            domainVector: [0, 1, 0, 0],
            dimensions: 4,
            model: "test",
            generatedAt: Date.now(),
          });
        }

        return { userId, profileId, embeddingId, strongIds, bridgeIds };
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

    const linearLane = snapshot!.lanes.find((l) => l.kind === "linear");
    expect(linearLane).toBeDefined();

    const strongCards = linearLane!.cards.filter(
      (c) => c.slotKind === "strong",
    );
    const bridgeCards = linearLane!.cards.filter(
      (c) => c.slotKind === "bridge",
    );

    expect(strongCards).toHaveLength(3);
    expect(bridgeCards).toHaveLength(2);

    // Strong cards are the 3 "Strong i" guides (in any order).
    expect(strongCards.map((c) => c.guideId).sort()).toEqual(
      [...strongIds].sort(),
    );

    // Bridge cards are 2 of the 3 "Bridge i" guides; none are strong picks.
    for (const c of bridgeCards) {
      expect(bridgeIds).toContain(c.guideId);
      expect(strongIds).not.toContain(c.guideId);
    }
  });
});

describe("discover.generateSnapshot — Step 7 (extras pool)", () => {
  it("includes up to 14 extras per lane beyond the curated 6", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-extras-test",
        email: "extras@example.com",
      });
      const profileId = await ctx.db.insert("profiles", profileSeed(userId));
      await ctx.db.insert(
        "profile_enrichments",
        enrichmentSeed({ profileId, userId, careerStage: "mid-career" }),
      );
      const embeddingId = await ctx.db.insert("profile_embeddings", {
        profileId,
        userId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        arcSourceText: "I want to write things people remember",
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });

      // 100 candidates all stage="manager" (forward of user's mid-career)
      // → all land in the linear lane. Each has a slightly varied arcVector
      // so its arcSim is unique and above the floor (worst-case ~0.994 for
      // i=99). Curated 6 (3 strong + 2 bridge + 1 aspirational) + 14 extras
      // (capped at LANE_BUDGET.EXTRA_MAX) = 20-card linear lane; the
      // remaining 80 candidates are dropped at curation (no slot left).
      for (let i = 0; i < 100; i++) {
        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeedWithStage(`extras-${i}`, `Extras ${i}`, "manager"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1 - i * 0.001, i * 0.001, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });
      }

      return { userId, profileId, embeddingId };
    });

    // Stub the rerank seam so the aspirational pick is deterministic and
    // doesn't touch the network. Picking index 0 of whatever it gets.
    (globalThis as any).__testRerank__ = async (args: {
      query: string;
      documents: string[];
      topN: number;
    }) => {
      if (args.documents.length === 0) return [];
      return [{ index: 0, relevanceScore: 0.9 }];
    };
    // Stub the reasons LLM seam so we don't touch the network. Returns a
    // simple keyed-by-guideId map; Step 8 wires reasons onto every card.
    (globalThis as any).__testReasonsLLM__ = async (args: {
      arcSourceText: string;
      pairs: Array<{ guideId: string }>;
    }) => {
      const map = new Map<string, string>();
      for (const p of args.pairs) {
        map.set(p.guideId, `reason for ${p.guideId}`);
      }
      return map;
    };

    try {
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

      const linearLane = snapshot!.lanes.find((l) => l.kind === "linear");
      expect(linearLane).toBeDefined();

      // Lane total cap (curated 6 + up to 14 extras = 20).
      expect(linearLane!.cards.length).toBeLessThanOrEqual(20);

      const extras = linearLane!.cards.filter((c) => c.slotKind === "extra");
      // Cap on extras alone.
      expect(extras.length).toBeLessThanOrEqual(14);
      // Proof that we actually filled extras (we seeded 100 candidates and
      // top 20% = 20 land in linear → after 6 curated there are 14 left,
      // exactly hitting the EXTRA_MAX cap).
      expect(extras.length).toBeGreaterThan(0);
      expect(extras.length).toBe(14);

      // Extras carry a non-empty why-match reason from the stubbed LLM.
      for (const card of extras) {
        expect(card.slotKind).toBe("extra");
        expect(card.whyMatchReason.length).toBeGreaterThan(0);
        expect(card.whyMatchReason).not.toBe("(stub)");
      }

      // Extras are ordered by arcScore desc (highest-arc first).
      for (let i = 1; i < extras.length; i++) {
        expect(extras[i - 1].arcScore).toBeGreaterThanOrEqual(
          extras[i].arcScore,
        );
      }

      // Other lanes still respect the EXTRA_MAX cap on their extras pools.
      // Under stage-based bucketing they're empty here (all seeded guides
      // are stage="manager", forward of the user's mid-career) but the cap
      // assertion holds vacuously.
      const adjacent = snapshot!.lanes.find((l) => l.kind === "adjacent");
      const earlier = snapshot!.lanes.find((l) => l.kind === "earlier");
      const transformational = snapshot!.lanes.find(
        (l) => l.kind === "transformational",
      );
      const adjacentExtras = (adjacent?.cards ?? []).filter(
        (c) => c.slotKind === "extra",
      );
      const earlierExtras = (earlier?.cards ?? []).filter(
        (c) => c.slotKind === "extra",
      );
      const transformationalExtras = (transformational?.cards ?? []).filter(
        (c) => c.slotKind === "extra",
      );
      expect(adjacentExtras.length).toBeLessThanOrEqual(14);
      expect(earlierExtras.length).toBeLessThanOrEqual(14);
      expect(transformationalExtras.length).toBeLessThanOrEqual(14);
    } finally {
      delete (globalThis as any).__testRerank__;
      delete (globalThis as any).__testReasonsLLM__;
    }
  });
});

describe("discover.generateSnapshot — Step 8 (why-match reasons)", () => {
  it("populates whyMatchReason from cache hits without calling the LLM", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, guideId } = await t.run(
      async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-reasons-cache",
          email: "reasons-cache@example.com",
        });
        const profileId = await ctx.db.insert("profiles", profileSeed(userId));
        const embeddingId = await ctx.db.insert("profile_embeddings", {
          profileId,
          userId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          arcSourceText: "I want to lead a small team",
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeed("cached-reason", "Cached reason guide"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        // Pre-seed a cached reason for this (user, guide, embedding) tuple.
        await ctx.db.insert("discover_match_reasons", {
          userId,
          guideId,
          profileEmbeddingId: embeddingId,
          reason: "CACHED reason text",
          generatedAt: Date.now(),
        });

        return { userId, profileId, embeddingId, guideId };
      },
    );

    let llmCalls = 0;
    (globalThis as any).__testReasonsLLM__ = async (args: {
      arcSourceText: string;
      pairs: Array<{ guideId: string }>;
    }) => {
      llmCalls += 1;
      const map = new Map<string, string>();
      for (const p of args.pairs) map.set(p.guideId, "LIVE reason text");
      return map;
    };

    try {
      await t.action(internal.discover.generateSnapshot, {
        userId,
        profileId,
        expectedProfileEmbeddingId: embeddingId,
        forceFreshReasons: false,
      });

      const snapshot = await t.run(async (ctx) => {
        return await ctx.db
          .query("discover_canvases")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique();
      });
      expect(snapshot).not.toBeNull();
      const card = snapshot!.lanes
        .flatMap((l) => l.cards)
        .find((c) => c.guideId === guideId);
      expect(card).toBeDefined();
      expect(card!.whyMatchReason).toBe("CACHED reason text");
      expect(llmCalls).toBe(0);
    } finally {
      delete (globalThis as any).__testReasonsLLM__;
    }
  });

  it("batches uncached pairs into a single LLM call", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, guideIds } = await t.run(
      async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-reasons-batch",
          email: "reasons-batch@example.com",
        });
        const profileId = await ctx.db.insert("profiles", profileSeed(userId));
        const embeddingId = await ctx.db.insert("profile_embeddings", {
          profileId,
          userId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          arcSourceText: "I want to ship beautiful tools",
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        const guideIds: Id<"career_guides">[] = [];
        for (let i = 0; i < 4; i++) {
          const id = await ctx.db.insert(
            "career_guides",
            guideSeed(`batch-${i}`, `Batch ${i}`),
          );
          await ctx.db.insert("career_guide_embeddings", {
            guideId: id,
            wholeVector: [1, 0, 0, 0],
            arcVector: [1 - i * 0.01, i * 0.01, 0, 0],
            currentStateVector: [1, 0, 0, 0],
            domainVector: [1, 0, 0, 0],
            dimensions: 4,
            model: "test",
            generatedAt: Date.now(),
          });
          guideIds.push(id);
        }

        return { userId, profileId, embeddingId, guideIds };
      },
    );

    let callCount = 0;
    let lastPairCount = 0;
    (globalThis as any).__testReasonsLLM__ = async (args: {
      arcSourceText: string;
      pairs: Array<{ guideId: string }>;
    }) => {
      callCount += 1;
      lastPairCount = args.pairs.length;
      const map = new Map<string, string>();
      for (const p of args.pairs) {
        map.set(p.guideId, `batched reason for ${p.guideId}`);
      }
      return map;
    };
    // Step 6c needs rerank stubbed too so the aspirational pick is determinstic.
    (globalThis as any).__testRerank__ = async (args: {
      query: string;
      documents: string[];
      topN: number;
    }) => {
      if (args.documents.length === 0) return [];
      return [{ index: 0, relevanceScore: 0.9 }];
    };

    try {
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

      const allCards = snapshot!.lanes.flatMap((l) => l.cards);
      // All 4 seeded guides should be on the canvas.
      const cardGuideIds = allCards.map((c) => c.guideId);
      for (const id of guideIds) expect(cardGuideIds).toContain(id);

      // Exactly one batched LLM call, covering every uncached card.
      expect(callCount).toBe(1);
      expect(lastPairCount).toBe(allCards.length);

      // Every card got a non-stub reason from the batched call.
      for (const card of allCards) {
        expect(card.whyMatchReason).toBe(
          `batched reason for ${card.guideId}`,
        );
      }

      // Reasons were persisted to the cache.
      const cached = await t.run(async (ctx) => {
        return await ctx.db
          .query("discover_match_reasons")
          .withIndex("by_user_and_guide", (q) => q.eq("userId", userId))
          .collect();
      });
      const cachedByGuide = new Map(cached.map((r) => [r.guideId, r.reason]));
      for (const card of allCards) {
        expect(cachedByGuide.get(card.guideId)).toBe(
          `batched reason for ${card.guideId}`,
        );
      }
    } finally {
      delete (globalThis as any).__testReasonsLLM__;
      delete (globalThis as any).__testRerank__;
    }
  });

  it("falls back to deterministic templates when the LLM throws", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, guideId } = await t.run(
      async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-reasons-fallback",
          email: "reasons-fallback@example.com",
        });
        const profileId = await ctx.db.insert("profiles", profileSeed(userId));
        const embeddingId = await ctx.db.insert("profile_embeddings", {
          profileId,
          userId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          arcSourceText: "I want a calmer life",
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeed("template-fallback", "Template fallback"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        return { userId, profileId, embeddingId, guideId };
      },
    );

    (globalThis as any).__testReasonsLLM__ = async () => {
      throw new Error("reasons-network-down");
    };

    try {
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
      const card = snapshot!.lanes
        .flatMap((l) => l.cards)
        .find((c) => c.guideId === guideId);
      expect(card).toBeDefined();
      expect(card!.whyMatchReason).not.toBe("(stub)");
      expect(card!.whyMatchReason.length).toBeGreaterThan(0);
    } finally {
      delete (globalThis as any).__testReasonsLLM__;
    }
  });
});

describe("discover.generateSnapshot — failure handling", () => {
  it("marks snapshot as failed and increments attempts on hard error", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-failure-handling",
        email: "fail@example.com",
      });
      const profileId = await ctx.db.insert("profiles", profileSeed(userId));
      // 4-dim profile embedding.
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

      // Force a dimension mismatch by inserting a 2-dim guide embedding.
      // cosineSim throws on mismatched dims → bubbles up out of Step 2.
      const brokenGuideId = await ctx.db.insert(
        "career_guides",
        guideSeed("broken", "Broken"),
      );
      await ctx.db.insert("career_guide_embeddings", {
        guideId: brokenGuideId,
        wholeVector: [1, 0],
        arcVector: [1, 0],
        currentStateVector: [1, 0],
        domainVector: [1, 0],
        dimensions: 2,
        model: "test",
        generatedAt: Date.now(),
      });

      // Pre-seed a "generating" snapshot row so _markSnapshotFailed has a row
      // to patch (mirrors what scheduleSnapshotRegeneration does in prod).
      await ctx.db.insert("discover_canvases", {
        userId,
        profileId,
        profileEmbeddingId: embeddingId,
        generatedAt: Date.now(),
        status: "generating",
        lanes: [],
        attempts: 0,
      });

      return { userId, profileId, embeddingId };
    });

    await expect(
      t.action(internal.discover.generateSnapshot, {
        userId,
        profileId,
        expectedProfileEmbeddingId: embeddingId,
        forceFreshReasons: true,
      }),
    ).rejects.toThrow();

    const snap = await t.run(async (ctx) => {
      return await ctx.db
        .query("discover_canvases")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
    });
    expect(snap?.status).toBe("failed");
    expect(snap?.attempts ?? 0).toBeGreaterThan(0);
    expect(snap?.failureReason).toBeTruthy();
  });
});

describe("discover reactions (saveGuide / dismissGuide / removeSave)", () => {
  it("saveGuide writes a saved row", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, guideId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      await ctx.db.insert("profiles", profileSeed(userId));
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("save-target", "Save target"),
      );
      return { userId, guideId };
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "u-test",
      email: "t@example.com",
    });
    await asUser.mutation(api.discover.saveGuide, { guideId });

    const reactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("discover_reactions")
        .withIndex("by_user_and_guide", (q) =>
          q.eq("userId", userId).eq("guideId", guideId),
        )
        .collect();
    });
    expect(reactions).toHaveLength(1);
    expect(reactions[0].reaction).toBe("saved");
  });

  it("saveGuide upserts (idempotent)", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, guideId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      await ctx.db.insert("profiles", profileSeed(userId));
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("save-idempotent", "Save idempotent"),
      );
      return { userId, guideId };
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "u-test",
      email: "t@example.com",
    });
    await asUser.mutation(api.discover.saveGuide, { guideId });
    await asUser.mutation(api.discover.saveGuide, { guideId });

    const reactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("discover_reactions")
        .withIndex("by_user_and_guide", (q) =>
          q.eq("userId", userId).eq("guideId", guideId),
        )
        .collect();
    });
    expect(reactions).toHaveLength(1);
    expect(reactions[0].reaction).toBe("saved");
  });

  it("dismissGuide writes a dismissed row AND refillAfterDismiss exists", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, guideId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      await ctx.db.insert("profiles", profileSeed(userId));
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("dismiss-target", "Dismiss target"),
      );
      return { userId, guideId };
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "u-test",
      email: "t@example.com",
    });
    await asUser.mutation(api.discover.dismissGuide, { guideId });

    const reactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("discover_reactions")
        .withIndex("by_user_and_guide", (q) =>
          q.eq("userId", userId).eq("guideId", guideId),
        )
        .collect();
    });
    expect(reactions).toHaveLength(1);
    expect(reactions[0].reaction).toBe("dismissed");

    // refillAfterDismiss is wired up — the internalAction reference exists
    // (so dismissGuide's `ctx.scheduler.runAfter` call typechecks). The
    // refill chain itself is exercised by the "discover refill (Task 3.2)"
    // describe block below.
    expect(internal.discover.refillAfterDismiss).toBeDefined();

    // Drain the queued `refillAfterDismiss` action so it doesn't leak into
    // a later test's event loop. With the action fully implemented (Task
    // 3.2), the leaked setTimeout fires after the test ends and triggers
    // `EnvironmentTeardownError` from vitest if not drained here.
    await new Promise((r) => setTimeout(r, 0));
    await t.finishInProgressScheduledFunctions();
  });

  it("dismissGuide also overwrites a previous saved reaction", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, guideId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      await ctx.db.insert("profiles", profileSeed(userId));
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("dismiss-overwrite", "Dismiss overwrite"),
      );
      return { userId, guideId };
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "u-test",
      email: "t@example.com",
    });
    await asUser.mutation(api.discover.saveGuide, { guideId });
    await asUser.mutation(api.discover.dismissGuide, { guideId });

    const reactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("discover_reactions")
        .withIndex("by_user_and_guide", (q) =>
          q.eq("userId", userId).eq("guideId", guideId),
        )
        .collect();
    });
    expect(reactions).toHaveLength(1);
    expect(reactions[0].reaction).toBe("dismissed");

    // Drain the queued `refillAfterDismiss` action so it doesn't leak into
    // a later test's event loop (see the same drain in the test above).
    await new Promise((r) => setTimeout(r, 0));
    await t.finishInProgressScheduledFunctions();
  });

  it("removeSave deletes a saved row", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, guideId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      await ctx.db.insert("profiles", profileSeed(userId));
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("remove-save", "Remove save"),
      );
      return { userId, guideId };
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "u-test",
      email: "t@example.com",
    });
    await asUser.mutation(api.discover.saveGuide, { guideId });
    await asUser.mutation(api.discover.removeSave, { guideId });

    const reactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("discover_reactions")
        .withIndex("by_user_and_guide", (q) =>
          q.eq("userId", userId).eq("guideId", guideId),
        )
        .collect();
    });
    expect(reactions).toHaveLength(0);
  });

  it("removeSave does NOT delete a dismissed row", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, guideId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      await ctx.db.insert("profiles", profileSeed(userId));
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("remove-save-noop", "Remove save no-op"),
      );
      return { userId, guideId };
    });

    const asUser = t.withIdentity({
      tokenIdentifier: "u-test",
      email: "t@example.com",
    });
    await asUser.mutation(api.discover.dismissGuide, { guideId });
    await asUser.mutation(api.discover.removeSave, { guideId });

    const reactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("discover_reactions")
        .withIndex("by_user_and_guide", (q) =>
          q.eq("userId", userId).eq("guideId", guideId),
        )
        .collect();
    });
    expect(reactions).toHaveLength(1);
    expect(reactions[0].reaction).toBe("dismissed");

    // Drain the queued `refillAfterDismiss` action so it doesn't leak into
    // a later test's event loop (see the same drain in the dismissGuide
    // tests above).
    await new Promise((r) => setTimeout(r, 0));
    await t.finishInProgressScheduledFunctions();
  });
});

describe("discover refill (Task 3.2)", () => {
  it("refillAfterDismiss schedules a regen that rewrites the snapshot without the dismissed guide", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    // Seed user + profile + 4-dim profile embedding aligned so that all
    // candidates land in the linear lane (currentStateSim = 1.0). Provide
    // an arcSourceText so Step 6c (aspirational rerank) has a real query.
    const { userId, profileId, embeddingId, dismissId } = await t.run(
      async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-refill",
          email: "refill@example.com",
        });
        const profileId = await ctx.db.insert(
          "profiles",
          profileSeed(userId),
        );
        const embeddingId = await ctx.db.insert("profile_embeddings", {
          profileId,
          userId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          arcSourceText: "I want to ship beautiful tools",
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        // Three guides — A is the dismissal target, B/C remain. All linear
        // (currentStateSim = 1.0) so the dismissed slot is refillable from
        // within the same lane.
        const dismissId = await ctx.db.insert(
          "career_guides",
          guideSeed("refill-a", "A"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: dismissId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        const bId = await ctx.db.insert(
          "career_guides",
          guideSeed("refill-b", "B"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: bId,
          wholeVector: [0.95, 0.05, 0, 0],
          arcVector: [0.9, 0.1, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        const cId = await ctx.db.insert(
          "career_guides",
          guideSeed("refill-c", "C"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: cId,
          wholeVector: [0.9, 0.1, 0, 0],
          arcVector: [0.8, 0.2, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        return { userId, profileId, embeddingId, dismissId };
      },
    );

    // Stub both AI seams so the pipeline runs offline. Cleaned up in finally.
    (globalThis as any).__testReasonsLLM__ = async (args: {
      arcSourceText: string;
      pairs: Array<{ guideId: string }>;
    }) => {
      const map = new Map<string, string>();
      for (const p of args.pairs) map.set(p.guideId, "test reason");
      return map;
    };
    (globalThis as any).__testRerank__ = async (args: {
      query: string;
      documents: string[];
      topN: number;
    }) => {
      if (args.documents.length === 0) return [];
      return [{ index: 0, relevanceScore: 0.9 }];
    };

    try {
      // Step 1: initial snapshot — A should land in the linear lane.
      await t.action(internal.discover.generateSnapshot, {
        userId,
        profileId,
        expectedProfileEmbeddingId: embeddingId,
        forceFreshReasons: true,
      });

      const snapBefore = await t.run(async (ctx) =>
        ctx.db
          .query("discover_canvases")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique(),
      );
      expect(snapBefore).not.toBeNull();
      const idsBefore = snapBefore!.lanes.flatMap((l) =>
        l.cards.map((c) => c.guideId),
      );
      expect(idsBefore).toContain(dismissId);

      // Step 2: persist the dismissal as the authenticated user.
      await t
        .withIdentity({ tokenIdentifier: "u-refill", email: "refill@example.com" })
        .mutation(api.discover.dismissGuide, { guideId: dismissId });

      // Step 3: drive the refill chain manually. We don't rely on
      // `t.finishAllScheduledFunctions` to drain the
      // dismissGuide → refillAfterDismiss → scheduleSnapshotRegeneration →
      // generateSnapshot chain because `convex-test`'s drain helpers race
      // with multi-hop `runAfter(0)` chains in this codebase (concurrent
      // setTimeouts pumped by the drain loop corrupt the global tx state).
      // Instead, invoke each hop directly — `refillAfterDismiss` is the
      // unit under test; the rest is plumbing already covered by
      // `generateSnapshot`'s own tests.
      //
      // `refillAfterDismiss` schedules `scheduleSnapshotRegeneration` (a
      // mutation) via `ctx.scheduler.runAfter(0, ...)`. Yield + drain to
      // run that mutation, which itself schedules `generateSnapshot`.
      await t.action(internal.discover.refillAfterDismiss, {
        userId,
        guideId: dismissId,
      });
      await new Promise((r) => setTimeout(r, 0));
      await t.finishInProgressScheduledFunctions();

      // After the regen mutation runs, the canvas row is patched to
      // `status: "generating"` and a `generateSnapshot` action is queued.
      // Run that action directly — passing the live profile_embeddings id
      // so the concurrency abort in `_writeSnapshot` doesn't fire.
      const liveEmbedding = await t.run(async (ctx) =>
        ctx.db
          .query("profile_embeddings")
          .withIndex("by_profileId", (q) => q.eq("profileId", profileId))
          .unique(),
      );
      expect(liveEmbedding).not.toBeNull();
      await t.action(internal.discover.generateSnapshot, {
        userId,
        profileId,
        expectedProfileEmbeddingId: liveEmbedding!._id,
        forceFreshReasons: false,
      });

      const snap = await t.run(async (ctx) =>
        ctx.db
          .query("discover_canvases")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique(),
      );
      expect(snap).not.toBeNull();
      expect(snap!.status).toBe("ready");
      const ids = snap!.lanes.flatMap((l) =>
        l.cards.map((c) => c.guideId),
      );
      // Core assertion: the dismissed guide is gone from the regenerated
      // snapshot — the dismissal filter in Step 4 of `generateSnapshot`
      // dropped it. Other guides (B, C) remain.
      expect(ids).not.toContain(dismissId);
      expect(ids.length).toBeGreaterThan(0);
    } finally {
      delete (globalThis as any).__testReasonsLLM__;
      delete (globalThis as any).__testRerank__;
    }
  });
});

describe("discover queries (Task 3.3)", () => {
  it("getSnapshot returns the current user's snapshot with hydrated guide titles", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      const profileId = await ctx.db.insert("profiles", profileSeed(userId));
      const embeddingId = await ctx.db.insert("profile_embeddings", {
        profileId,
        userId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        arcSourceText: "I want to write things people remember",
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("hydrate-me", "Hydrate me"),
      );
      await ctx.db.insert("career_guide_embeddings", {
        guideId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });
      return { userId, profileId, embeddingId };
    });

    // Stub LLMs so generateSnapshot stays offline.
    (globalThis as any).__testReasonsLLM__ = async (args: {
      arcSourceText: string;
      pairs: Array<{ guideId: string }>;
    }) => {
      const map = new Map<string, string>();
      for (const p of args.pairs) map.set(p.guideId, "test reason");
      return map;
    };
    (globalThis as any).__testRerank__ = async () => [];

    try {
      await t.action(internal.discover.generateSnapshot, {
        userId,
        profileId,
        expectedProfileEmbeddingId: embeddingId,
        forceFreshReasons: true,
      });

      const out = await t
        .withIdentity({ tokenIdentifier: "u-test", email: "t@example.com" })
        .query(api.discover.getSnapshot, {});
      expect(out).not.toBeNull();
      expect(out!.status).toBe("ready");
      const allCards = out!.lanes.flatMap((l) => l.cards);
      expect(allCards.some((c) => c.title === "Hydrate me")).toBe(true);
    } finally {
      delete (globalThis as any).__testReasonsLLM__;
      delete (globalThis as any).__testRerank__;
    }
  });

  it("getSnapshot returns null when the user has no snapshot", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      await ctx.db.insert("profiles", profileSeed(userId));
    });

    const out = await t
      .withIdentity({ tokenIdentifier: "u-test", email: "t@example.com" })
      .query(api.discover.getSnapshot, {});
    expect(out).toBeNull();
  });

  it("querySavedGuides returns saved guides ordered by reaction date desc", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, aId, bId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      await ctx.db.insert("profiles", profileSeed(userId));
      const aId = await ctx.db.insert(
        "career_guides",
        guideSeed("a", "A"),
      );
      const bId = await ctx.db.insert(
        "career_guides",
        guideSeed("b", "B"),
      );
      await ctx.db.insert("discover_reactions", {
        userId,
        guideId: aId,
        reaction: "saved",
        reactedAt: 1,
      });
      await ctx.db.insert("discover_reactions", {
        userId,
        guideId: bId,
        reaction: "saved",
        reactedAt: 2,
      });
      return { userId, aId, bId };
    });

    const out = await t
      .withIdentity({ tokenIdentifier: "u-test", email: "t@example.com" })
      .query(api.discover.querySavedGuides, {});
    expect(out.map((x) => x.title)).toEqual(["B", "A"]);
    // Sanity: ids match the seed.
    expect(out.map((x) => x.guideId)).toEqual([bId, aId]);
    // Suppress unused-variable warning; userId is needed only as a seed
    // input above and intentionally not asserted on here.
    void userId;
  });

  it("querySavedGuides hydrates snapshot card metadata (lane, whyMatchReason, arcScore) when present", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, guideId } = await t.run(
      async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-test",
          email: "t@example.com",
        });
        const profileId = await ctx.db.insert("profiles", profileSeed(userId));
        await ctx.db.insert(
          "profile_enrichments",
          enrichmentSeed({ profileId, userId, careerStage: "mid-career" }),
        );
        const embeddingId = await ctx.db.insert("profile_embeddings", {
          profileId,
          userId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          arcSourceText: "I want to ship beautiful tools",
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });
        // Stage = "manager" (forward of mid-career) so the guide lands in
        // the linear lane — what the assertion below relies on.
        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeedWithStage("saved-snap", "Saved + In Snapshot", "manager"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });
        return { userId, profileId, embeddingId, guideId };
      },
    );

    (globalThis as any).__testReasonsLLM__ = async (args: {
      arcSourceText: string;
      pairs: Array<{ guideId: string }>;
    }) => {
      const map = new Map<string, string>();
      for (const p of args.pairs) map.set(p.guideId, "saved-reason");
      return map;
    };
    (globalThis as any).__testRerank__ = async () => [];

    try {
      await t.action(internal.discover.generateSnapshot, {
        userId,
        profileId,
        expectedProfileEmbeddingId: embeddingId,
        forceFreshReasons: true,
      });
      await t.run(async (ctx) => {
        await ctx.db.insert("discover_reactions", {
          userId,
          guideId,
          reaction: "saved",
          reactedAt: 1,
        });
      });
      const out = await t
        .withIdentity({ tokenIdentifier: "u-test", email: "t@example.com" })
        .query(api.discover.querySavedGuides, {});
      expect(out).toHaveLength(1);
      expect(out[0].lane).toBe("linear");
      expect(out[0].whyMatchReason).toBe("saved-reason");
      expect(out[0].arcScore).toBeGreaterThan(0);
    } finally {
      delete (globalThis as any).__testReasonsLLM__;
      delete (globalThis as any).__testRerank__;
    }
  });

  it("querySavedGuides returns saved-only (excludes dismissed)", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      await ctx.db.insert("profiles", profileSeed(userId));
      const aId = await ctx.db.insert(
        "career_guides",
        guideSeed("saved-only", "Saved"),
      );
      const bId = await ctx.db.insert(
        "career_guides",
        guideSeed("dismissed-only", "Dismissed"),
      );
      await ctx.db.insert("discover_reactions", {
        userId,
        guideId: aId,
        reaction: "saved",
        reactedAt: 1,
      });
      await ctx.db.insert("discover_reactions", {
        userId,
        guideId: bId,
        reaction: "dismissed",
        reactedAt: 2,
      });
    });

    const out = await t
      .withIdentity({ tokenIdentifier: "u-test", email: "t@example.com" })
      .query(api.discover.querySavedGuides, {});
    expect(out.map((x) => x.title)).toEqual(["Saved"]);
  });

  it("getSnapshot returns lanes: [] when snapshot status is failed (stale-lane guard)", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    // Manually insert a snapshot row in `failed` status with a previous
    // generation's lanes still populated. `_markSnapshotFailed` patches
    // `status`/`attempts`/`failureReason` only — it does NOT clear lanes —
    // so this shape is what the DB actually looks like after a regen
    // failure on a row that had previously generated successfully. The
    // guard in `getSnapshot` should suppress those stale lanes.
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      const profileId = await ctx.db.insert("profiles", profileSeed(userId));
      const profileEmbeddingId = await ctx.db.insert("profile_embeddings", {
        profileId,
        userId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        arcSourceText: "stale-lane test",
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });
      const staleGuideId = await ctx.db.insert(
        "career_guides",
        guideSeed("stale-card", "Stale card"),
      );
      await ctx.db.insert("discover_canvases", {
        userId,
        profileId,
        profileEmbeddingId,
        generatedAt: Date.now(),
        status: "failed",
        lanes: [
          {
            kind: "linear",
            cards: [
              {
                guideId: staleGuideId,
                slotKind: "strong",
                arcScore: 1,
                currentStateScore: 1,
                domainScore: 0,
                wholeScore: 0.7,
                whyMatchReason: "stale reason from prior generation",
              },
            ],
          },
        ],
        attempts: 1,
        failureReason: "test-error",
      });
    });

    const out = await t
      .withIdentity({ tokenIdentifier: "u-test", email: "t@example.com" })
      .query(api.discover.getSnapshot, {});
    expect(out).not.toBeNull();
    expect(out!.status).toBe("failed");
    expect(out!.failureReason).toBe("test-error");
    expect(out!.lanes).toEqual([]);
  });

  it("querySavedGuides returns null lane/whyMatchReason/arcScore when snapshot status is failed", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    // Insert a failed snapshot whose lanes still carry the saved guide as
    // a card (i.e. the previous successful generation included it). Without
    // the guard, querySavedGuides would surface that stale card metadata
    // on the saved row. With the guard, lane/whyMatchReason/arcScore stay
    // null because we don't trust `lanes` unless `status === "ready"`.
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      const profileId = await ctx.db.insert("profiles", profileSeed(userId));
      const profileEmbeddingId = await ctx.db.insert("profile_embeddings", {
        profileId,
        userId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        arcSourceText: "stale-lane saved test",
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("saved-stale", "Saved"),
      );
      await ctx.db.insert("discover_canvases", {
        userId,
        profileId,
        profileEmbeddingId,
        generatedAt: Date.now(),
        status: "failed",
        lanes: [
          {
            kind: "linear",
            cards: [
              {
                guideId,
                slotKind: "strong",
                arcScore: 1,
                currentStateScore: 1,
                domainScore: 0,
                wholeScore: 0.7,
                whyMatchReason: "stale reason from prior generation",
              },
            ],
          },
        ],
        attempts: 1,
        failureReason: "test-error",
      });
      await ctx.db.insert("discover_reactions", {
        userId,
        guideId,
        reaction: "saved",
        reactedAt: 1,
      });
    });

    const out = await t
      .withIdentity({ tokenIdentifier: "u-test", email: "t@example.com" })
      .query(api.discover.querySavedGuides, {});
    expect(out).toHaveLength(1);
    // Title still hydrates from the guide doc — that's correct.
    expect(out[0].title).toBe("Saved");
    // But snapshot card metadata is suppressed because snapshot is failed.
    expect(out[0].lane).toBeNull();
    expect(out[0].whyMatchReason).toBeNull();
    expect(out[0].arcScore).toBeNull();
  });
});

describe("discover.manualRefresh (Task 3.4)", () => {
  it("manualRefresh schedules a fresh-reasons regeneration", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    // Seed user + profile + profile embedding so
    // `scheduleSnapshotRegeneration` actually enqueues `generateSnapshot`
    // (it short-circuits when either profile or embedding is missing).
    // Also seed one guide + guide embedding so the pipeline has at least
    // one candidate to score; without any embeddings the snapshot ships
    // with empty lanes but still ends up `status: "ready"`.
    const { userId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-test",
        email: "t@example.com",
      });
      const profileId = await ctx.db.insert(
        "profiles",
        profileSeed(userId),
      );
      await ctx.db.insert("profile_embeddings", {
        profileId,
        userId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        arcSourceText: "manual refresh test",
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("manual-refresh-target", "Manual refresh target"),
      );
      await ctx.db.insert("career_guide_embeddings", {
        guideId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });
      return { userId };
    });

    // Stub LLMs since the chain runs through generateSnapshot.
    (globalThis as any).__testReasonsLLM__ = async (args: {
      pairs: Array<{ guideId: string }>;
    }) => {
      const m = new Map<string, string>();
      for (const p of args.pairs) m.set(p.guideId, "manual reason");
      return m;
    };
    (globalThis as any).__testRerank__ = async () => [];
    try {
      await t
        .withIdentity({ tokenIdentifier: "u-test", email: "t@example.com" })
        .mutation(api.discover.manualRefresh, {});
      // Drain the chain (manualRefresh → scheduleSnapshotRegeneration →
      // generateSnapshot). Per Task 3.2 lessons learned: each hop is
      // pending after its predecessor finishes, so
      // finishInProgressScheduledFunctions may bail early. Use the same
      // drain pattern as the dismissGuide tests.
      await new Promise((r) => setTimeout(r, 0));
      await t.finishInProgressScheduledFunctions();
      await new Promise((r) => setTimeout(r, 0));
      await t.finishInProgressScheduledFunctions();

      const snap = await t.run(async (ctx) =>
        ctx.db
          .query("discover_canvases")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique(),
      );
      // Core assertion: a `discover_canvases` row exists for the user.
      // `scheduleSnapshotRegeneration` writes this row synchronously
      // (status: "generating") before scheduling `generateSnapshot`, so
      // its presence proves `manualRefresh` correctly delegated to the
      // scheduler with valid args (right userId, valid dedupKey).
      //
      // The downstream `generateSnapshot` chain may end up in any of
      // "ready" / "generating" / "failed" depending on convex-test's
      // multi-hop scheduler racing — that plumbing is already exercised
      // by the Task 3.2 refill test which directly invokes each hop. The
      // unit under test here is the mutation itself.
      expect(snap).not.toBeNull();
    } finally {
      delete (globalThis as any).__testReasonsLLM__;
      delete (globalThis as any).__testRerank__;
    }
  });
});

describe("discover.fanOutGuideUpdate (Task 4.2)", () => {
  it("invalidates cached reasons + schedules regen for users whose snapshot contains the guide", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    // Seed: user + profile + profile_embedding + guide + guide_embedding
    // + a "ready" snapshot referencing the guide via discover_snapshot_guides
    // + a stale cached reason on discover_match_reasons.
    const { userId, guideId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "u-fanout",
        email: "fanout@example.com",
      });
      const profileId = await ctx.db.insert(
        "profiles",
        profileSeed(userId),
      );
      const profileEmbeddingId = await ctx.db.insert("profile_embeddings", {
        profileId,
        userId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        arcSourceText: "fanout test",
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("fanout-target", "Fanout target"),
      );
      await ctx.db.insert("career_guide_embeddings", {
        guideId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });
      const snapshotId = await ctx.db.insert("discover_canvases", {
        userId,
        profileId,
        profileEmbeddingId,
        generatedAt: Date.now(),
        status: "ready",
        lanes: [],
        attempts: 0,
      });
      await ctx.db.insert("discover_snapshot_guides", {
        snapshotId,
        userId,
        guideId,
      });
      await ctx.db.insert("discover_match_reasons", {
        userId,
        guideId,
        profileEmbeddingId,
        reason: "stale reason — should be invalidated",
        generatedAt: Date.now(),
      });
      return { userId, guideId };
    });

    // Stub LLMs for the regen chain (regen runs Step 8 even with no
    // candidates if the schedule fires; safer to stub).
    (globalThis as any).__testReasonsLLM__ = async (args: {
      pairs: Array<{ guideId: string }>;
    }) => {
      const m = new Map<string, string>();
      for (const p of args.pairs) m.set(p.guideId, "fresh reason");
      return m;
    };
    (globalThis as any).__testRerank__ = async () => [];
    try {
      await t.action(internal.discover.fanOutGuideUpdate, { guideId });

      // The cached reason MUST be gone (invalidation ran in the mutation
      // hop, before the regen schedule fires).
      const reasonsAfterInvalidate = await t.run(async (ctx) =>
        ctx.db
          .query("discover_match_reasons")
          .withIndex("by_user_and_guide", (q) =>
            q.eq("userId", userId).eq("guideId", guideId),
          )
          .collect(),
      );
      expect(reasonsAfterInvalidate).toHaveLength(0);

      // Drain the regen chain (fanOutGuideUpdate →
      // scheduleSnapshotRegeneration → generateSnapshot). Per Task 3.2
      // lessons learned, multi-hop schedule chains under convex-test need
      // tick + drain + tick + drain.
      await new Promise((r) => setTimeout(r, 0));
      await t.finishInProgressScheduledFunctions();
      await new Promise((r) => setTimeout(r, 0));
      await t.finishInProgressScheduledFunctions();

      // Core schedule assertion: the snapshot row was patched off "ready"
      // (either to "generating" mid-chain or onward) — proving
      // scheduleSnapshotRegeneration was actually invoked. The exact
      // terminal status depends on convex-test's scheduler racing; the
      // unit under test here is the fan-out wiring, not the downstream
      // regen pipeline (already covered by other Phase 2/3 tests).
      const snap = await t.run(async (ctx) =>
        ctx.db
          .query("discover_canvases")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique(),
      );
      expect(snap).not.toBeNull();
      expect(snap!.status).not.toBe("ready"); // Was "ready" before fan-out
    } finally {
      delete (globalThis as any).__testReasonsLLM__;
      delete (globalThis as any).__testRerank__;
    }
  });

  it("no-op when no users reference the guide", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    // Seed an orphan guide — no discover_snapshot_guides row references it.
    const { guideId } = await t.run(async (ctx) => {
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("orphan-guide", "Orphan guide"),
      );
      return { guideId };
    });

    // Should complete cleanly with nothing to do — no users, no reasons,
    // no snapshots created.
    await t.action(internal.discover.fanOutGuideUpdate, { guideId });

    const snaps = await t.run(async (ctx) =>
      ctx.db.query("discover_canvases").collect(),
    );
    expect(snaps).toHaveLength(0);

    const reasons = await t.run(async (ctx) =>
      ctx.db.query("discover_match_reasons").collect(),
    );
    expect(reasons).toHaveLength(0);
  });
});

describe("discover.sweepFailedSnapshots (Task 4.3)", () => {
  // Helper: seed user + profile + 4-dim profile_embedding for sweep tests.
  // The (profileId, profileEmbeddingId) FKs need to point at real upstream
  // rows so the downstream regen chain (scheduled by the sweep) doesn't
  // short-circuit on a missing-profile guard.
  async function seedUserProfileEmbedding(
    t: ReturnType<typeof convexTest>,
    tokenIdentifier: string,
  ) {
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier,
        email: `${tokenIdentifier}@example.com`,
      });
      const profileId = await ctx.db.insert("profiles", profileSeed(userId));
      const embeddingId = await ctx.db.insert("profile_embeddings", {
        profileId,
        userId,
        wholeVector: [1, 0, 0, 0],
        arcVector: [1, 0, 0, 0],
        currentStateVector: [1, 0, 0, 0],
        domainVector: [1, 0, 0, 0],
        arcSourceText: "sweep test",
        dimensions: 4,
        model: "test",
        generatedAt: Date.now(),
      });
      return { userId, profileId, embeddingId };
    });
  }

  // Witness for the sweep's downstream effect: count pending/in-flight/
  // completed runs of scheduleSnapshotRegeneration in the convex-test
  // `_scheduled_functions` system table. The sweep `runAfter(0, ...)`s into
  // this function for every eligible row. Asserting on the schedule rather
  // than the row status sidesteps convex-test's known multi-hop transaction
  // rollback race (action → scheduler → mutation → action → runMutation
  // sometimes blows up with "Transaction already committed"; the sweep's
  // own scheduling call is what we're verifying here, not the regen chain
  // it kicks off — the regen chain is exercised by other Phase 2/3 tests).
  async function countRegenSchedules(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const rows = await ctx.db.system.query("_scheduled_functions").collect();
      return rows.filter((r) =>
        r.name.includes("scheduleSnapshotRegeneration"),
      ).length;
    });
  }

  it("retries failed snapshots older than 24h that are below the attempts cap", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId } = await seedUserProfileEmbedding(
      t,
      "u-sweep-retry",
    );

    // Seed a failed snapshot >24h old with attempts < SNAPSHOT_MAX_ATTEMPTS.
    await t.run(async (ctx) =>
      ctx.db.insert("discover_canvases", {
        userId,
        profileId,
        profileEmbeddingId: embeddingId,
        generatedAt: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
        status: "failed",
        lanes: [],
        attempts: 1, // below SNAPSHOT_MAX_ATTEMPTS (3)
        failureReason: "previous attempt blew up",
      }),
    );

    expect(await countRegenSchedules(t)).toBe(0);
    await t.action(internal.discover.sweepFailedSnapshots, {});
    // The sweep's only direct effect is scheduling. Assert on the schedule
    // existence; do not drain the chain (the downstream regen would race
    // convex-test's transaction state — see helper comment above).
    expect(await countRegenSchedules(t)).toBe(1);
  });

  it("skips failed snapshots at or above the attempts cap", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId } = await seedUserProfileEmbedding(
      t,
      "u-sweep-capped",
    );

    await t.run(async (ctx) =>
      ctx.db.insert("discover_canvases", {
        userId,
        profileId,
        profileEmbeddingId: embeddingId,
        generatedAt: Date.now() - 25 * 60 * 60 * 1000,
        status: "failed",
        lanes: [],
        attempts: 3, // at SNAPSHOT_MAX_ATTEMPTS
        failureReason: "definitely broken",
      }),
    );

    await t.action(internal.discover.sweepFailedSnapshots, {});
    // No regen scheduled — sweep skipped the row because attempts cap hit.
    expect(await countRegenSchedules(t)).toBe(0);

    const snap = await t.run(async (ctx) =>
      ctx.db
        .query("discover_canvases")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(snap!.status).toBe("failed");
    expect(snap!.attempts).toBe(3);
  });

  it("skips failed snapshots within the 24h window (not yet stale)", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId } = await seedUserProfileEmbedding(
      t,
      "u-sweep-fresh",
    );

    await t.run(async (ctx) =>
      ctx.db.insert("discover_canvases", {
        userId,
        profileId,
        profileEmbeddingId: embeddingId,
        generatedAt: Date.now() - 1 * 60 * 60 * 1000, // 1h ago, < 24h
        status: "failed",
        lanes: [],
        attempts: 1,
        failureReason: "fresh failure",
      }),
    );

    await t.action(internal.discover.sweepFailedSnapshots, {});
    // No regen scheduled — sweep's _listOldFailed cutoff filtered the row out.
    expect(await countRegenSchedules(t)).toBe(0);

    const snap = await t.run(async (ctx) =>
      ctx.db
        .query("discover_canvases")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(snap!.status).toBe("failed");
  });
});

describe("users.deleteAccount cascade — discover tables", () => {
  it("removes all discover_* rows owned by the user being deleted", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, guideId } = await t.run(
      async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-cascade-test",
          email: "cascade@example.com",
        });
        const profileId = await ctx.db.insert(
          "profiles",
          profileSeed(userId),
        );
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
        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeed("cascade-guide", "Cascade guide"),
        );
        return { userId, profileId, embeddingId, guideId };
      },
    );

    // Seed all four discover tables for this user.
    await t.run(async (ctx) => {
      const snapshotId = await ctx.db.insert("discover_canvases", {
        userId,
        profileId,
        profileEmbeddingId: embeddingId,
        generatedAt: Date.now(),
        status: "ready",
        lanes: [],
        attempts: 0,
      });
      await ctx.db.insert("discover_snapshot_guides", {
        snapshotId,
        userId,
        guideId,
      });
      await ctx.db.insert("discover_reactions", {
        userId,
        guideId,
        reaction: "saved",
        reactedAt: Date.now(),
      });
      await ctx.db.insert("discover_match_reasons", {
        userId,
        guideId,
        profileEmbeddingId: embeddingId,
        reason: "test",
        generatedAt: Date.now(),
      });
    });

    // Sanity: the rows exist.
    const beforeCanvases = await t.run(async (ctx) =>
      ctx.db.query("discover_canvases").collect(),
    );
    const beforeJunction = await t.run(async (ctx) =>
      ctx.db.query("discover_snapshot_guides").collect(),
    );
    const beforeReactions = await t.run(async (ctx) =>
      ctx.db.query("discover_reactions").collect(),
    );
    const beforeReasons = await t.run(async (ctx) =>
      ctx.db.query("discover_match_reasons").collect(),
    );
    expect(beforeCanvases).toHaveLength(1);
    expect(beforeJunction).toHaveLength(1);
    expect(beforeReactions).toHaveLength(1);
    expect(beforeReasons).toHaveLength(1);

    // Delete account (data-only path — production goes through the
    // Clerk-aware action in usersAccount.ts; tests exercise cascade only).
    await t.mutation(internal.users.deleteByTokenIdentifierInternal, {
      tokenIdentifier: "u-cascade-test",
    });

    // All four tables should be empty.
    const afterCanvases = await t.run(async (ctx) =>
      ctx.db.query("discover_canvases").collect(),
    );
    const afterJunction = await t.run(async (ctx) =>
      ctx.db.query("discover_snapshot_guides").collect(),
    );
    const afterReactions = await t.run(async (ctx) =>
      ctx.db.query("discover_reactions").collect(),
    );
    const afterReasons = await t.run(async (ctx) =>
      ctx.db.query("discover_match_reasons").collect(),
    );
    expect(afterCanvases).toHaveLength(0);
    expect(afterJunction).toHaveLength(0);
    expect(afterReactions).toHaveLength(0);
    expect(afterReasons).toHaveLength(0);

    // The user row is gone too.
    const afterUsers = await t.run(async (ctx) =>
      ctx.db.query("users").collect(),
    );
    expect(afterUsers).toHaveLength(0);
  });

  it("does not affect other users' discover rows", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userB, guideId } = await t.run(async (ctx) => {
      // User A — will be deleted.
      const userA = await ctx.db.insert("users", {
        tokenIdentifier: "u-a",
        email: "a@b.co",
      });
      // User B — should remain untouched.
      const userB = await ctx.db.insert("users", {
        tokenIdentifier: "u-b",
        email: "b@c.co",
      });
      const guideId = await ctx.db.insert(
        "career_guides",
        guideSeed("shared", "Shared"),
      );

      // Seed reactions for both users.
      await ctx.db.insert("discover_reactions", {
        userId: userA,
        guideId,
        reaction: "saved",
        reactedAt: Date.now(),
      });
      await ctx.db.insert("discover_reactions", {
        userId: userB,
        guideId,
        reaction: "saved",
        reactedAt: Date.now(),
      });
      return { userA, userB, guideId };
    });

    // Delete account for user A (data-only cascade path).
    await t.mutation(internal.users.deleteByTokenIdentifierInternal, {
      tokenIdentifier: "u-a",
    });

    // User B's reaction should still exist.
    const remaining = await t.run(async (ctx) =>
      ctx.db.query("discover_reactions").collect(),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(userB);
    expect(remaining[0].guideId).toBe(guideId);
  });
});
