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

  it("buckets candidates into linear / adjacent / transformational by currentStateSim", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });

    const { userId, profileId, embeddingId, linearId, adjacentId, transId } =
      await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier: "u-lane-test",
          email: "lane@example.com",
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

        // Linear: high currentStateSim (1.0 ≥ 0.7).
        const linearId = await ctx.db.insert(
          "career_guides",
          guideSeed("linear-a", "Linear A"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: linearId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [1, 0, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        // Adjacent: ~0.5 currentStateSim (≥ 0.45 and < 0.7).
        const adjacentId = await ctx.db.insert(
          "career_guides",
          guideSeed("adjacent-a", "Adjacent A"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: adjacentId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [0.5, 0.866, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        // Transformational: orthogonal currentState (0 < 0.45).
        const transId = await ctx.db.insert(
          "career_guides",
          guideSeed("trans-a", "Transformational A"),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId: transId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1, 0, 0, 0],
          currentStateVector: [0, 1, 0, 0],
          domainVector: [1, 0, 0, 0],
          dimensions: 4,
          model: "test",
          generatedAt: Date.now(),
        });

        return {
          userId,
          profileId,
          embeddingId,
          linearId,
          adjacentId,
          transId,
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

    expect(lanes.linear).toEqual([linearId]);
    expect(lanes.adjacent).toEqual([adjacentId]);
    expect(lanes.transformational).toEqual([transId]);
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
      // Profile facets — currentStateVector aligned so all candidates land
      // in linear; arcVector aligned so arcSim drives strong picks.
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

      // 3 strong picks: arcSim = 1.0, domainSim = 0.0.
      const strongIds: Id<"career_guides">[] = [];
      for (let i = 0; i < 3; i++) {
        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeed(`strong-${i}`, `Strong ${i}`),
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

      // 2 bridge picks: arcSim = 0.6, domainSim = 1.0.
      const bridgeIds: Id<"career_guides">[] = [];
      for (let i = 0; i < 2; i++) {
        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeed(`bridge-${i}`, `Bridge ${i}`),
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
      const aspirationalId = await ctx.db.insert(
        "career_guides",
        guideSeed("rerank-wins", "Rerank wins"),
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
        guideSeed("rerank-loses", "Rerank loses"),
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

        // 3 strong + 2 bridge as before, plus 2 aspirational candidates.
        for (let i = 0; i < 3; i++) {
          const guideId = await ctx.db.insert(
            "career_guides",
            guideSeed(`strong-${i}`, `Strong ${i}`),
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
            guideSeed(`bridge-${i}`, `Bridge ${i}`),
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
            guideSeed(`fallback-${i}`, `Fallback ${i}`),
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
        // Profile facets:
        //   arcVector            = [1,0,0,0]
        //   currentStateVector   = [1,0,0,0] (so all candidates land in linear)
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
        //   arcVector          = [1,0,0,0]      → arcSim = 1.0
        //   currentStateVector = [1,0,0,0]      → currentStateSim = 1.0 (linear)
        //   domainVector       = [0,1,0,0]      → domainSim = 0.0
        // → win the strong slots on arcSim, lose the bridge race on domainSim.
        const strongIds: Id<"career_guides">[] = [];
        for (let i = 0; i < 3; i++) {
          const guideId = await ctx.db.insert(
            "career_guides",
            guideSeed(`strong-${i}`, `Strong ${i}`),
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
        //   arcVector          = [0.6, 0.8, 0, 0] → arcSim = 0.6 (above floor)
        //   currentStateVector = [1,0,0,0]        → currentStateSim = 1.0 (linear)
        //   domainVector       = [0,0,1,0]        → domainSim = 1.0
        // → top-2 by domainSim once strong picks are excluded.
        const bridgeIds: Id<"career_guides">[] = [];
        for (let i = 0; i < 3; i++) {
          const guideId = await ctx.db.insert(
            "career_guides",
            guideSeed(`bridge-${i}`, `Bridge ${i}`),
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
      // Profile facets — currentStateVector aligned to [1,0,0,0] so all
      // candidates land in linear; arcVector aligned so each candidate's
      // arcSim is just its first component.
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

      // 25 linear-lane candidates with slightly varied arcVectors so each has
      // a unique arcSim above the floor (worst-case ~0.953 for i=24).
      for (let i = 0; i < 25; i++) {
        const guideId = await ctx.db.insert(
          "career_guides",
          guideSeed(`extras-${i}`, `Extras ${i}`),
        );
        await ctx.db.insert("career_guide_embeddings", {
          guideId,
          wholeVector: [1, 0, 0, 0],
          arcVector: [1 - i * 0.01, i * 0.01, 0, 0],
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
      // Proof that we actually filled extras (we seeded 25 candidates, so
      // after 6 curated there are 19 left → expect the cap of 14).
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

      // Adjacent + transformational lanes have no candidates in this seed.
      const adjacent = snapshot!.lanes.find((l) => l.kind === "adjacent");
      const transformational = snapshot!.lanes.find(
        (l) => l.kind === "transformational",
      );
      expect(adjacent?.cards ?? []).toHaveLength(0);
      expect(transformational?.cards ?? []).toHaveLength(0);
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
