import { v } from "convex/values";
import { generateText, Output } from "ai";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { chatModel } from "../lib/ai/providers";
import {
  LADDER_CLASSIFY_MODEL_ID,
  LadderAssignmentSchema,
  buildLadderAssignmentPrompt,
  type LadderAssignment,
  type LadderForPrompt,
} from "../lib/ai/prompts/career-ladders";
import {
  TIER_RANK,
  tierFromLegacyStage,
  type LegacyCareerStage,
  type Tier,
} from "./lib/ladders";

// Vocabulary mirrors `convex/lib/ladders.ts` and the schema validator at
// `convex/schema.ts:career_guide_ladder_positions.tier`. Kept inline as a
// validator union so internalQuery args can be validated at the boundary.
const tierValidator = v.union(
  v.literal("ic-entry"),
  v.literal("ic-mid"),
  v.literal("ic-senior"),
  v.literal("manager"),
  v.literal("head"),
  v.literal("director"),
  v.literal("vp"),
  v.literal("c-suite"),
);

// ── Ladder lookups ─────────────────────────────────────────────────────────

export const getLadderBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("career_ladders")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

export const listLaddersByFamily = internalQuery({
  args: {
    family: v.union(
      v.literal("product"),
      v.literal("engineering"),
      v.literal("design"),
      v.literal("data"),
      v.literal("marketing"),
      v.literal("sales"),
      v.literal("finance"),
      v.literal("legal"),
      v.literal("operations"),
      v.literal("people"),
      v.literal("customer-success"),
      v.literal("research"),
      v.literal("healthcare"),
      v.literal("education"),
      v.literal("trades"),
      v.literal("creative"),
      v.literal("other"),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("career_ladders")
      .withIndex("by_family", (q) => q.eq("family", args.family))
      .take(50);
  },
});

// All ladders. Used by the on-demand dedup classifier (Phase 2) to give the
// LLM the full set of candidate ladders for placement. Bounded to 200, far
// above the realistic ladder count (~20 today).
export const listAllLadders = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("career_ladders").take(200);
  },
});

// ── Position lookups ───────────────────────────────────────────────────────

export const getPositionsByGuide = internalQuery({
  args: { guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("career_guide_ladder_positions")
      .withIndex("by_guide", (q) => q.eq("guideId", args.guideId))
      .take(10);
  },
});

// All positions on a ladder, ordered by rung ascending. Bounded to 50, far
// above realistic rung count (~7 max per ladder).
export const listPositionsByLadder = internalQuery({
  args: { ladderId: v.id("career_ladders") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("career_guide_ladder_positions")
      .withIndex("by_ladder_rung", (q) => q.eq("ladderId", args.ladderId))
      .order("asc")
      .take(50);
  },
});

// Walk up a ladder from a given rung. Returns positions strictly above
// `fromRung`, ordered by rung ascending (closest first). Drives the discover
// canvas's Linear lane in Phase 3.
export const walkUp = internalQuery({
  args: {
    ladderId: v.id("career_ladders"),
    fromRung: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("career_guide_ladder_positions")
      .withIndex("by_ladder_rung", (q) =>
        q.eq("ladderId", args.ladderId).gt("rung", args.fromRung),
      )
      .order("asc")
      .take(20);
  },
});

// Walk down a ladder from a given rung. Returns positions strictly below
// `fromRung`, ordered by rung descending (closest first). Drives the
// discover canvas's Earlier lane in Phase 3.
export const walkDown = internalQuery({
  args: {
    ladderId: v.id("career_ladders"),
    fromRung: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("career_guide_ladder_positions")
      .withIndex("by_ladder_rung", (q) =>
        q.eq("ladderId", args.ladderId).lt("rung", args.fromRung),
      )
      .order("desc")
      .take(20);
  },
});

// Resolve a user profile to a ladder position. Drives the Career Compass
// lane bucketing in Phase 3.
//
// Strategy:
//   1. Find the user's primary ladder via `seedingGuideSlugs[0]`, the slug
//      of the canonical guide for one of their past/current roles. The
//      seeded guide's `career_guide_ladder_positions` row identifies which
//      ladder they sit on.
//   2. Determine the user's tier from `profile_enrichments.careerStage`
//      (mapped to the new tier vocabulary via tierFromLegacyStage).
//   3. Determine the user's rung within that ladder by finding any existing
//      guide on the ladder at the matching tier. If no guide on this ladder
//      has the user's tier yet (catalog gap), fall back to the seeded
//      guide's own rung.
//
// Returns null when the profile isn't on a known ladder, the discover
// pipeline then falls back to today's embedding-based bucketing.
export const getPositionByProfile = internalQuery({
  args: { profileId: v.id("profiles") },
  returns: v.union(
    v.null(),
    v.object({
      ladderId: v.id("career_ladders"),
      ladderSlug: v.string(),
      rung: v.number(),
      tier: tierValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile) return null;

    const seededSlugs = profile.seedingGuideSlugs ?? [];
    if (seededSlugs.length === 0) return null;

    // Find the first seeded slug whose guide has a ladder position. Most
    // profiles have one slug today; some have two (multiple roles seeded).
    let seededPosition: Doc<"career_guide_ladder_positions"> | null = null;
    let seededLadder: Doc<"career_ladders"> | null = null;
    for (const slug of seededSlugs) {
      const guide = await ctx.db
        .query("career_guides")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!guide) continue;
      const pos = await ctx.db
        .query("career_guide_ladder_positions")
        .withIndex("by_guide", (q) => q.eq("guideId", guide._id))
        .first();
      if (!pos) continue;
      seededPosition = pos;
      seededLadder = await ctx.db.get(pos.ladderId);
      break;
    }
    if (!seededPosition || !seededLadder) return null;

    // Determine the user's tier from their enrichment, falling back to the
    // seeded guide's tier if the enrichment is missing.
    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .first();
    const userTier: Tier =
      tierFromLegacyStage(
        enrichment?.careerStage as LegacyCareerStage | undefined,
      ) ?? seededPosition.tier;

    // Find the rung on this ladder that matches the user's tier. If none
    // exists yet (catalog gap on this ladder for this tier), fall back to
    // the seeded guide's rung, the bucketer will then walk up/down
    // relative to that rung, accepting that the user is reading a slightly
    // off altitude until a guide is created at their actual rung.
    const allPositionsOnLadder = await ctx.db
      .query("career_guide_ladder_positions")
      .withIndex("by_ladder_tier", (q) =>
        q.eq("ladderId", seededLadder._id).eq("tier", userTier),
      )
      .first();

    const userRung = allPositionsOnLadder
      ? allPositionsOnLadder.rung
      : seededPosition.rung;

    return {
      ladderId: seededLadder._id,
      ladderSlug: seededLadder.slug,
      rung: userRung,
      tier: userTier,
    };
  },
});

// ── Public queries (UI surfaces) ───────────────────────────────────────────

// Catalog-wide ladder context for the listing page (`/career-guides/`).
// Returns BOTH the ladder catalogue (so the page can render section
// headers + an anchor strip) AND a flat map of guideSlug → primary
// position (so each card can show its tier chip without the client
// having to walk N rows of join data).
//
// "Primary position" here means: the position with the lowest rung number
// on the ladder where the guide first appears. For X-Manager titles that
// sit on two ladders, we surface the position from the FUNCTIONAL ladder
// (engineering, product, etc.) rather than the People-Management ladder -
// the people-mgmt ladder is cross-cutting and would clutter every section.
// Heuristic: pick the position whose ladder family is NOT "people"; if
// none, take the first position by rung.
export const listLadderContextForCatalog = query({
  args: {},
  returns: v.object({
    ladders: v.array(
      v.object({
        slug: v.string(),
        name: v.string(),
        family: v.string(),
        description: v.string(),
      }),
    ),
    primaryPositions: v.array(
      v.object({
        guideSlug: v.string(),
        ladderSlug: v.string(),
        ladderName: v.string(),
        rung: v.number(),
        tier: tierValidator,
      }),
    ),
  }),
  handler: async (ctx) => {
    const ladders = await ctx.db.query("career_ladders").take(200);
    const ladderById = new Map(ladders.map((l) => [l._id as string, l]));

    // Walk all positions once. Group by guideId to pick the primary.
    const positions = await ctx.db
      .query("career_guide_ladder_positions")
      .take(2000);
    const byGuide = new Map<
      string,
      {
        ladderId: Id<"career_ladders">;
        ladderSlug: string;
        ladderName: string;
        rung: number;
        tier: Tier;
        family: string;
      }[]
    >();
    for (const pos of positions) {
      const ladder = ladderById.get(pos.ladderId as string);
      if (!ladder) continue;
      const list = byGuide.get(pos.guideId as string) ?? [];
      list.push({
        ladderId: pos.ladderId,
        ladderSlug: ladder.slug,
        ladderName: ladder.name,
        rung: pos.rung,
        tier: pos.tier,
        family: ladder.family,
      });
      byGuide.set(pos.guideId as string, list);
    }

    // Resolve guideId → guide.slug in one batched lookup.
    const guideIdsArr = Array.from(byGuide.keys()) as Id<"career_guides">[];
    const guides = await Promise.all(
      guideIdsArr.map((id) => ctx.db.get(id)),
    );
    const slugByGuideId = new Map<string, string>();
    for (const g of guides) {
      if (g) slugByGuideId.set(g._id as string, g.slug);
    }

    const primaryPositions: {
      guideSlug: string;
      ladderSlug: string;
      ladderName: string;
      rung: number;
      tier: Tier;
    }[] = [];
    for (const [guideId, list] of byGuide.entries()) {
      const guideSlug = slugByGuideId.get(guideId);
      if (!guideSlug) continue;
      // Prefer non-"people" family; fall back to lowest rung.
      const sorted = [...list].sort((a, b) => {
        if (a.family !== b.family) {
          if (a.family === "people") return 1;
          if (b.family === "people") return -1;
        }
        return a.rung - b.rung;
      });
      const primary = sorted[0];
      primaryPositions.push({
        guideSlug,
        ladderSlug: primary.ladderSlug,
        ladderName: primary.ladderName,
        rung: primary.rung,
        tier: primary.tier,
      });
    }

    return {
      ladders: ladders.map((l) => ({
        slug: l.slug,
        name: l.name,
        family: l.family,
        description: l.description,
      })),
      primaryPositions,
    };
  },
});

// Per-slug ladder context for an individual guide page. Powers the
// breadcrumb (full rung sequence with neighbour titles), the
// What's-next/Earlier-chapter footer pair, and the Same-altitude/different-
// paths peer strip.
export const getGuideLadderContext = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const guide = await ctx.db
      .query("career_guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!guide) return null;

    const positions = await ctx.db
      .query("career_guide_ladder_positions")
      .withIndex("by_guide", (q) => q.eq("guideId", guide._id))
      .take(5);
    if (positions.length === 0) return null;

    const ladderResults = await Promise.all(
      positions.map(async (pos) => {
        const ladder = await ctx.db.get(pos.ladderId);
        if (!ladder) return null;

        // All rungs on this ladder, ordered by rung asc. May contain
        // multiple guides per rung; we group by rung and pick the first
        // guide on each (alphabetical by title for determinism).
        const rungPositions = await ctx.db
          .query("career_guide_ladder_positions")
          .withIndex("by_ladder_rung", (q) => q.eq("ladderId", ladder._id))
          .order("asc")
          .take(50);

        const byRung = new Map<
          number,
          {
            tier: Tier;
            guides: { slug: string; title: string }[];
          }
        >();
        for (const rp of rungPositions) {
          const g = await ctx.db.get(rp.guideId);
          if (!g) continue;
          const entry = byRung.get(rp.rung);
          if (entry) {
            entry.guides.push({ slug: g.slug, title: g.title });
          } else {
            byRung.set(rp.rung, {
              tier: rp.tier,
              guides: [{ slug: g.slug, title: g.title }],
            });
          }
        }
        const rungs = Array.from(byRung.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([rung, { tier, guides }]) => ({
            rung,
            tier,
            // Deterministic guide order within a rung, alphabetical by
            // title, with the current guide first if it sits at this rung.
            guides: guides.sort((a, b) => {
              if (a.slug === guide.slug) return -1;
              if (b.slug === guide.slug) return 1;
              return a.title.localeCompare(b.title);
            }),
          }));

        return {
          ladderSlug: ladder.slug,
          ladderName: ladder.name,
          ladderFamily: ladder.family,
          ladderDescription: ladder.description,
          currentRung: pos.rung,
          currentTier: pos.tier,
          rungs,
        };
      }),
    );

    const ladders = ladderResults.filter(
      (r): r is NonNullable<typeof r> => r !== null,
    );
    if (ladders.length === 0) return null;

    // Primary ladder: the FUNCTIONAL one (not "people"). If both are
    // functional or both are people, take the one that appears first
    // (positions order = insertion order, which mirrors backfill primary).
    const primary =
      ladders.find((l) => l.ladderFamily !== "people") ?? ladders[0];
    const secondary = ladders.find((l) => l !== primary) ?? null;

    // Same-tier peers on OTHER ladders. Scan the by_tier index, exclude
    // our ladders, exclude the current guide. Peers are ranked by family
    // proximity to the source ladder so a Product Manager doesn't see
    // Marine Biologist as a "peer", same tier alone is too coarse.
    const peerPositions = await ctx.db
      .query("career_guide_ladder_positions")
      .withIndex("by_tier", (q) => q.eq("tier", primary.currentTier))
      .take(200);
    const ourLadderIds = new Set(positions.map((p) => p.ladderId as string));

    // Resolve each peer position to ladder + guide once.
    type PeerCandidate = {
      slug: string;
      title: string;
      family: string;
    };
    const candidates: PeerCandidate[] = [];
    const seenPeers = new Set<string>();
    for (const pp of peerPositions) {
      if (ourLadderIds.has(pp.ladderId as string)) continue;
      if (pp.guideId === guide._id) continue;
      const g = await ctx.db.get(pp.guideId);
      if (!g) continue;
      if (seenPeers.has(g.slug)) continue;
      const ladder = await ctx.db.get(pp.ladderId);
      if (!ladder) continue;
      seenPeers.add(g.slug);
      candidates.push({
        slug: g.slug,
        title: g.title,
        family: ladder.family,
      });
    }

    // Family proximity rank: 0 = same broad cluster, 1 = adjacent cluster,
    // 2 = far. Source ladder family decides which cluster the user sits in.
    const CLUSTERS: Record<string, string[]> = {
      tech: ["product", "engineering", "design", "data"],
      gtm: ["marketing", "sales", "customer-success"],
      corp: ["finance", "legal", "operations", "people"],
      domain: ["research", "healthcare", "education", "trades", "creative"],
    };
    const clusterOf = (family: string): string => {
      for (const [name, families] of Object.entries(CLUSTERS)) {
        if (families.includes(family)) return name;
      }
      return "other";
    };
    const sourceCluster = clusterOf(primary.ladderFamily);
    const proximity = (peerFamily: string): number => {
      if (peerFamily === primary.ladderFamily) return 0;
      if (clusterOf(peerFamily) === sourceCluster) return 1;
      return 2;
    };

    const peers = candidates
      .sort((a, b) => {
        const pa = proximity(a.family);
        const pb = proximity(b.family);
        if (pa !== pb) return pa - pb;
        return a.title.localeCompare(b.title);
      })
      .slice(0, 6)
      .map(({ slug, title }) => ({ slug, title }));

    // Footer pair: previous and next rung relative to primary.currentRung.
    // Skip rungs that the current guide also sits on (so a guide at rung 3
    // doesn't link back to itself if rung 3 holds multiple guides).
    let earlier: { slug: string; title: string; tier: Tier } | null = null;
    let next: { slug: string; title: string; tier: Tier } | null = null;
    for (let i = primary.rungs.length - 1; i >= 0; i--) {
      const r = primary.rungs[i];
      if (r.rung >= primary.currentRung) continue;
      const candidate = r.guides.find((g) => g.slug !== guide.slug);
      if (candidate) {
        earlier = { slug: candidate.slug, title: candidate.title, tier: r.tier };
        break;
      }
    }
    for (const r of primary.rungs) {
      if (r.rung <= primary.currentRung) continue;
      const candidate = r.guides.find((g) => g.slug !== guide.slug);
      if (candidate) {
        next = { slug: candidate.slug, title: candidate.title, tier: r.tier };
        break;
      }
    }

    return {
      primary,
      secondary,
      earlier,
      next,
      peers,
    };
  },
});

// Batched position lookup for the discover snapshot pipeline. Returns a map
// from guideId → all positions for that guide. One round-trip instead of N.
export const _readPositionsForGuides = internalQuery({
  args: { guideIds: v.array(v.id("career_guides")) },
  returns: v.array(
    v.object({
      guideId: v.id("career_guides"),
      positions: v.array(
        v.object({
          ladderId: v.id("career_ladders"),
          rung: v.number(),
          tier: tierValidator,
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    return await Promise.all(
      args.guideIds.map(async (guideId) => {
        const positions = await ctx.db
          .query("career_guide_ladder_positions")
          .withIndex("by_guide", (q) => q.eq("guideId", guideId))
          .take(10);
        return {
          guideId,
          positions: positions.map((p) => ({
            ladderId: p.ladderId,
            rung: p.rung,
            tier: p.tier,
          })),
        };
      }),
    );
  },
});

// All ladders + their occupied rungs, formatted for the on-demand dedup
// prompt (`buildLadderLookupPrompt`). Mirrors the migration's
// `_loadLaddersForPrompt`, kept in this canonical file because the
// on-demand path is hot, while the migration helper is one-shot. Two
// lookups for the same shape is acceptable; consolidating would force the
// migration to import from this file, which is fine but adds a coupling.
export const _listLaddersForLookup = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      slug: v.string(),
      name: v.string(),
      family: v.string(),
      description: v.string(),
      occupiedRungs: v.array(
        v.object({
          rung: v.number(),
          tier: v.string(),
          guides: v.array(
            v.object({ title: v.string(), slug: v.string() }),
          ),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const ladders = await ctx.db.query("career_ladders").take(200);
    const out: LadderForPrompt[] = [];
    for (const ladder of ladders) {
      const positions = await ctx.db
        .query("career_guide_ladder_positions")
        .withIndex("by_ladder_rung", (q) => q.eq("ladderId", ladder._id))
        .order("asc")
        .take(50);

      const byRung = new Map<
        number,
        { tier: string; guides: { title: string; slug: string }[] }
      >();
      for (const pos of positions) {
        const guide = await ctx.db.get(pos.guideId);
        if (!guide) continue;
        const entry = byRung.get(pos.rung);
        if (entry) {
          entry.guides.push({ title: guide.title, slug: guide.slug });
        } else {
          byRung.set(pos.rung, {
            tier: pos.tier,
            guides: [{ title: guide.title, slug: guide.slug }],
          });
        }
      }

      const occupiedRungs: LadderForPrompt["occupiedRungs"] = [];
      for (const [rung, { tier, guides }] of byRung.entries()) {
        occupiedRungs.push({ rung, tier, guides });
      }

      out.push({
        slug: ladder.slug,
        name: ladder.name,
        family: ladder.family,
        description: ladder.description,
        occupiedRungs,
      });
    }
    return out;
  },
});

// All positions at a given tier on OTHER ladders. Drives the discover
// canvas's Adjacent lane in Phase 3, for a Senior PM (Product ladder,
// `ic-senior` tier), this returns Senior Engineering Manager, Senior
// Designer, Senior Data Scientist, etc. (peers on other ladders at the same
// altitude).
export const peersAtTier = internalQuery({
  args: {
    tier: tierValidator,
    excludeLadderId: v.id("career_ladders"),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("career_guide_ladder_positions")
      .withIndex("by_tier", (q) => q.eq("tier", args.tier))
      .take(100);
    return all.filter((p) => p.ladderId !== args.excludeLadderId);
  },
});

// ── Auto-classifier: every guide gets categorised after content lands ───
//
// Hooked from `_updateContentGrounded` and `_updateContentDeferred` in
// careerGuides.ts so the post-content moment is the single guarantee point:
// once a guide has content, it has a ladder placement (or a review-queue
// entry). This closes the orphan gap left by the seeding / cron / Tier-4
// fallback creation paths, which never set `ladderAttachment` themselves.
//
// Idempotent: skips guides that already have ≥1 position so the at-creation
// Tier-2 attachment from `requestGuideFromSearch` stays authoritative when
// it fired. The mutation re-checks inside the transaction as belt-and-
// braces, but the race window is essentially nil (Tier-2 runs at creation
// time, this runs after content lands ~30-60s later).
//
// Confidence policy (low-confidence → review queue):
//   primary.confidence = high|medium → row in `career_guide_ladder_positions`
//   primary.confidence = low         → row in `career_guide_ladder_review`
// Hallucinated ladder slugs always go to review with reason prefixed.
//
// Cost: one Gemini Flash classify per new guide, ~$0.0003 each. Negligible.

const _placementValidator = v.object({
  slug: v.string(),
  rung: v.number(),
  tier: tierValidator,
  confidence: v.union(
    v.literal("high"),
    v.literal("medium"),
    v.literal("low"),
  ),
});

export const _writeAutoAssignment = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    primary: _placementValidator,
    secondary: v.union(v.null(), _placementValidator),
    reasoning: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Defensive re-check: if Tier-2 (on-demand) attachment landed between
    // the action's idempotency check and now, bail so the at-creation
    // placement stays authoritative.
    const existing = await ctx.db
      .query("career_guide_ladder_positions")
      .withIndex("by_guide", (q) => q.eq("guideId", args.guideId))
      .first();
    if (existing) return null;

    const writeOne = async (
      placement: typeof args.primary,
    ): Promise<void> => {
      const ladder = await ctx.db
        .query("career_ladders")
        .withIndex("by_slug", (q) => q.eq("slug", placement.slug))
        .unique();

      if (!ladder) {
        await ctx.db.insert("career_guide_ladder_review", {
          guideId: args.guideId,
          proposedLadderSlug: placement.slug,
          proposedRung: placement.rung,
          proposedTier: placement.tier,
          confidence: "low",
          reasoning: `Hallucinated ladder slug: ${args.reasoning}`,
          queuedAt: now,
        });
        return;
      }

      if (placement.confidence === "low") {
        await ctx.db.insert("career_guide_ladder_review", {
          guideId: args.guideId,
          proposedLadderSlug: placement.slug,
          proposedRung: placement.rung,
          proposedTier: placement.tier,
          confidence: "low",
          reasoning: args.reasoning,
          queuedAt: now,
        });
        return;
      }

      // assignedBy reuses "backfill-llm" rather than introducing a new
      // enum variant; semantics match (LLM placement outside the on-demand
      // search path) and avoiding a schema widen keeps this change a pure
      // append. Add a "post-content-llm" variant via convex-migration-helper
      // if/when ops needs to distinguish the two surfaces.
      await ctx.db.insert("career_guide_ladder_positions", {
        ladderId: ladder._id,
        guideId: args.guideId,
        rung: placement.rung,
        tier: placement.tier,
        assignedAt: now,
        assignedBy: "backfill-llm",
      });
    };

    await writeOne(args.primary);
    if (args.secondary) await writeOne(args.secondary);
    return null;
  },
});

export const _classifyAndAttach = internalAction({
  args: { guideId: v.id("career_guides") },
  returns: v.union(
    v.object({
      classified: v.literal(true),
      primaryLadder: v.string(),
      secondaryLadder: v.union(v.string(), v.null()),
    }),
    v.object({ classified: v.literal(false), reason: v.string() }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | {
        classified: true;
        primaryLadder: string;
        secondaryLadder: string | null;
      }
    | { classified: false; reason: string }
  > => {
    // Skip if already attached (covers Tier-2 at-creation attachment and
    // any earlier classifier run from a content-regen retry).
    const existing: Array<Doc<"career_guide_ladder_positions">> =
      await ctx.runQuery(internal.careerLadders.getPositionsByGuide, {
        guideId: args.guideId,
      });
    if (existing.length > 0) {
      return { classified: false as const, reason: "already_attached" };
    }

    const guide = await ctx.runQuery(internal.careerGuides._getById, {
      guideId: args.guideId,
    });
    if (!guide) {
      return { classified: false as const, reason: "guide_not_found" };
    }
    if (!guide.content) {
      return { classified: false as const, reason: "content_not_ready" };
    }

    const ladders: LadderForPrompt[] = await ctx.runQuery(
      internal.careerLadders._listLaddersForLookup,
      {},
    );
    if (ladders.length === 0) {
      return { classified: false as const, reason: "no_ladders" };
    }

    let assignment: LadderAssignment;
    try {
      const { output } = await generateText({
        model: chatModel(LADDER_CLASSIFY_MODEL_ID, { zdr: true }),
        output: Output.object({ schema: LadderAssignmentSchema }),
        prompt: buildLadderAssignmentPrompt({
          guideTitle: guide.title,
          guideOverview: guide.content.overview,
          guideTypicalCareerStage: guide.content.typicalCareerStage,
          ladders,
        }),
      });
      assignment = output;
    } catch (err) {
      console.error("classifyAndAttach: LLM failed", {
        guideId: args.guideId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { classified: false as const, reason: "llm_failed" };
    }

    await ctx.runMutation(internal.careerLadders._writeAutoAssignment, {
      guideId: args.guideId,
      primary: assignment.primaryLadder,
      secondary: assignment.secondaryLadder,
      reasoning: assignment.reasoning,
    });

    return {
      classified: true as const,
      primaryLadder: assignment.primaryLadder.slug,
      secondaryLadder: assignment.secondaryLadder?.slug ?? null,
    };
  },
});
