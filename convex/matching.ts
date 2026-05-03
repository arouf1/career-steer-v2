import { v } from "convex/values";
import { action, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { rerank } from "../lib/ai/providers";

const PeerLens = v.union(
  v.literal("mentor"),
  v.literal("mirror"),
  v.literal("bridge"),
  v.literal("cross-pollination"),
);

type PeerLens =
  | "mentor"
  | "mirror"
  | "bridge"
  | "cross-pollination";

const SEARCH_LIMIT = 50;
const RESULT_LIMIT_DEFAULT = 10;

const indexForLens = (
  lens: PeerLens,
): "by_arc" | "by_currentState" | "by_whole" | "by_domain" => {
  switch (lens) {
    case "mentor":
      return "by_arc";
    case "mirror":
      return "by_currentState";
    case "bridge":
      return "by_arc";
    case "cross-pollination":
      return "by_whole";
  }
};

const vectorForLens = (
  lens: PeerLens,
  embeddings: Doc<"profile_embeddings">,
): number[] => {
  switch (lens) {
    case "mentor":
      return embeddings.arcVector;
    case "mirror":
      return embeddings.currentStateVector;
    case "bridge":
      return embeddings.arcVector;
    case "cross-pollination":
      return embeddings.wholeVector;
  }
};

const rerankFraming = (
  lens: PeerLens,
  selfNarrative: string,
  selfArc: string,
): string => {
  switch (lens) {
    case "mentor":
      return `I'm looking for someone who has walked a similar path but is one step ahead of me, who could mentor me. About me: ${selfNarrative}\n${selfArc}`;
    case "mirror":
      return `I'm looking for a peer at my exact career stage doing similar work, for community and accountability. About me: ${selfNarrative}`;
    case "bridge":
      return `I'm looking for someone who has made the kind of career transition I'm considering. About my arc: ${selfArc}`;
    case "cross-pollination":
      return `I'm looking for someone at a similar career stage but with a complementary background — different function or industry — for fresh perspective. About me: ${selfNarrative}`;
  }
};

export const meWithEmbedding = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    user: Doc<"users">;
    profile: Doc<"profiles">;
    enrichment: Doc<"profile_enrichments">;
    embedding: Doc<"profile_embeddings">;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) return null;

    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    if (!enrichment || enrichment.status !== "ready") return null;

    const embedding = await ctx.db
      .query("profile_embeddings")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .unique();
    if (!embedding) return null;

    return { user, profile, enrichment, embedding };
  },
});

export type PeerMatchSummary = {
  userId: Id<"users">;
  profileId: Id<"profiles">;
  name: string | null;
  headline: string | null;
  narrativeSummary: string | null;
  careerStage: string | null;
  careerArchetype: string | null;
  recentRole: { title: string; company: string } | null;
  vectorScore: number;
  fitScore: number;
};

export const expandCandidates = internalQuery({
  args: {
    profileIds: v.array(v.id("profiles")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      profile: Doc<"profiles">;
      enrichment: Doc<"profile_enrichments"> | null;
    }>
  > => {
    const out: Array<{
      profile: Doc<"profiles">;
      enrichment: Doc<"profile_enrichments"> | null;
    }> = [];
    for (const profileId of args.profileIds) {
      const profile = await ctx.db.get(profileId);
      if (!profile) continue;
      const enrichment = await ctx.db
        .query("profile_enrichments")
        .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
        .unique();
      out.push({ profile, enrichment });
    }
    return out;
  },
});

const candidateRerankDocument = (
  profile: Doc<"profiles">,
  enrichment: Doc<"profile_enrichments"> | null,
): string => {
  const lines: string[] = [];
  if (profile.headline) lines.push(profile.headline);
  if (enrichment?.narrativeSummary) lines.push(enrichment.narrativeSummary);
  if (enrichment?.careerStage) lines.push(`Stage: ${enrichment.careerStage}`);
  if (enrichment?.careerArchetype)
    lines.push(`Archetype: ${enrichment.careerArchetype}`);

  const recent = profile.experience[0];
  if (recent) lines.push(`Recent role: ${recent.title} @ ${recent.company}`);

  if (enrichment?.enrichedSkills) {
    const top = enrichment.enrichedSkills
      .filter(
        (s) =>
          s.proficiencySignal === "expert" || s.proficiencySignal === "proficient",
      )
      .slice(0, 10)
      .map((s) => s.canonical);
    if (top.length > 0) lines.push(`Strong in: ${top.join(", ")}`);
  }

  return lines.join("\n");
};

const buildSelfArcText = (e: Doc<"profile_enrichments">): string => {
  const parts: string[] = [];
  if (e.careerStage) parts.push(`stage: ${e.careerStage}`);
  if (e.careerArchetype) parts.push(`archetype: ${e.careerArchetype}`);
  if (e.pivots && e.pivots.length > 0) {
    parts.push(
      `pivots: ${e.pivots.map((p) => p.deltaDescription).join("; ")}`,
    );
  }
  return parts.join(" · ");
};

export const peerMatches = action({
  args: {
    lens: PeerLens,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PeerMatchSummary[]> => {
    const me = await ctx.runQuery(internal.matching.meWithEmbedding, {});
    if (!me) return [];

    const limit = Math.min(args.limit ?? RESULT_LIMIT_DEFAULT, 25);
    const lens = args.lens as PeerLens;
    const queryVector = vectorForLens(lens, me.embedding);

    const searchResults = await ctx.vectorSearch(
      "profile_embeddings",
      indexForLens(lens),
      {
        vector: queryVector,
        limit: SEARCH_LIMIT,
      },
    );

    const others = searchResults.filter(
      (r) => r._id !== me.embedding._id,
    );
    if (others.length === 0) return [];

    const otherEmbeddings = await ctx.runQuery(
      internal.matching.embeddingsByIds,
      { ids: others.map((o) => o._id) },
    );
    const profileIds = otherEmbeddings.map((e) => e.profileId);
    const expanded = await ctx.runQuery(
      internal.matching.expandCandidates,
      { profileIds },
    );

    if (expanded.length === 0) return [];

    const documents = expanded.map(({ profile, enrichment }) =>
      candidateRerankDocument(profile, enrichment),
    );

    const ranking = await rerank({
      query: rerankFraming(
        lens,
        me.enrichment.narrativeSummary ?? me.profile.headline ?? "",
        buildSelfArcText(me.enrichment),
      ),
      documents,
      topN: limit,
    });

    const vectorScoreById = new Map<Id<"profile_embeddings">, number>();
    for (const r of others) vectorScoreById.set(r._id, r._score);

    const summaries: PeerMatchSummary[] = [];
    for (const r of ranking) {
      const item = expanded[r.index];
      if (!item) continue;
      const matchingEmbeddingDoc = otherEmbeddings.find(
        (e) => e.profileId === item.profile._id,
      );
      const vectorScore = matchingEmbeddingDoc
        ? vectorScoreById.get(matchingEmbeddingDoc._id) ?? 0
        : 0;
      summaries.push({
        userId: item.profile.userId,
        profileId: item.profile._id,
        name: item.profile.name ?? null,
        headline: item.profile.headline ?? null,
        narrativeSummary: item.enrichment?.narrativeSummary ?? null,
        careerStage: item.enrichment?.careerStage ?? null,
        careerArchetype: item.enrichment?.careerArchetype ?? null,
        recentRole: item.profile.experience[0]
          ? {
              title: item.profile.experience[0].title,
              company: item.profile.experience[0].company,
            }
          : null,
        vectorScore,
        fitScore: r.relevanceScore,
      });
    }

    return summaries;
  },
});

export const embeddingsByIds = internalQuery({
  args: { ids: v.array(v.id("profile_embeddings")) },
  handler: async (ctx, args): Promise<Doc<"profile_embeddings">[]> => {
    const out: Doc<"profile_embeddings">[] = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc) out.push(doc);
    }
    return out;
  },
});

// ── Guides for you: user → career guide matching ────────────────────────────
//
// Mirrors `peerMatches` but matches a user's profile facet vector against
// the corresponding facet on `career_guide_embeddings`. Three lenses:
//   mirror   → currentState↔currentState ("guides for who I am now")
//   stretch  → arc↔arc                    ("guides for where I could go")
//   adjacent → domain↔domain              ("guides in my skill domain")
// vectorSearch top-50 → Cohere rerank with framing prompt → top-N.

const GuideLens = v.union(
  v.literal("mirror"),
  v.literal("stretch"),
  v.literal("adjacent"),
);

type GuideLens = "mirror" | "stretch" | "adjacent";

const GUIDE_SEARCH_LIMIT = 50;
const GUIDE_RESULT_LIMIT_DEFAULT = 8;
const GUIDE_RESULT_LIMIT_MAX = 24;
const GUIDE_OVERVIEW_SNIPPET_LENGTH = 240;

const guideIndexForLens = (
  lens: GuideLens,
): "by_currentState" | "by_arc" | "by_domain" => {
  switch (lens) {
    case "mirror":
      return "by_currentState";
    case "stretch":
      return "by_arc";
    case "adjacent":
      return "by_domain";
  }
};

const userVectorForGuideLens = (
  lens: GuideLens,
  embeddings: Doc<"profile_embeddings">,
): number[] => {
  switch (lens) {
    case "mirror":
      return embeddings.currentStateVector;
    case "stretch":
      return embeddings.arcVector;
    case "adjacent":
      return embeddings.domainVector;
  }
};

const guideRerankFraming = (
  lens: GuideLens,
  selfNarrative: string,
  selfArc: string,
): string => {
  switch (lens) {
    case "mirror":
      return `Recommend career guides relevant to who I am right now and the work I'm doing today. About me: ${selfNarrative}`;
    case "stretch":
      return `Recommend career guides for roles I could grow into next, given my trajectory. About my arc: ${selfArc}`;
    case "adjacent":
      return `Recommend career guides for roles that share my skill domain — adjacent functions or industries that build on what I already do. About me: ${selfNarrative}`;
  }
};

export type GuideMatchSummary = {
  slug: string;
  title: string;
  illustrationUrl: string | null;
  overviewSnippet: string;
  vectorScore: number;
  fitScore: number;
};

const guideRerankDocument = (g: {
  title: string;
  overview: string;
  whyConsider: string;
  typicalSkills: string[];
}): string => {
  const lines: string[] = [g.title];
  if (g.overview) lines.push(g.overview);
  if (g.whyConsider) lines.push(`Why: ${g.whyConsider}`);
  if (g.typicalSkills.length > 0)
    lines.push(`Skills: ${g.typicalSkills.slice(0, 12).join(", ")}`);
  return lines.join("\n");
};

export const _expandGuideCandidates = internalQuery({
  args: { embeddingIds: v.array(v.id("career_guide_embeddings")) },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      embeddingId: Id<"career_guide_embeddings">;
      slug: string;
      title: string;
      overview: string;
      whyConsider: string;
      typicalSkills: string[];
      illustrationStorageId: Id<"_storage"> | null;
    }>
  > => {
    const out: Array<{
      embeddingId: Id<"career_guide_embeddings">;
      slug: string;
      title: string;
      overview: string;
      whyConsider: string;
      typicalSkills: string[];
      illustrationStorageId: Id<"_storage"> | null;
    }> = [];
    for (const id of args.embeddingIds) {
      const embedding = await ctx.db.get(id);
      if (!embedding) continue;
      const guide = await ctx.db.get(embedding.guideId);
      if (!guide || guide.contentStatus !== "complete" || !guide.content)
        continue;
      out.push({
        embeddingId: id,
        slug: guide.slug,
        title: guide.title,
        overview: guide.content.overview,
        whyConsider: guide.content.whyConsider,
        typicalSkills: guide.content.typicalSkills,
        illustrationStorageId: guide.illustrationStorageId ?? null,
      });
    }
    return out;
  },
});

export const guidesForMe = action({
  args: {
    lens: v.optional(GuideLens),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<GuideMatchSummary[]> => {
    const me = await ctx.runQuery(internal.matching.meWithEmbedding, {});
    if (!me) return [];

    const lens = (args.lens ?? "mirror") as GuideLens;
    const limit = Math.min(
      args.limit ?? GUIDE_RESULT_LIMIT_DEFAULT,
      GUIDE_RESULT_LIMIT_MAX,
    );

    const queryVector = userVectorForGuideLens(lens, me.embedding);
    const searchResults = await ctx.vectorSearch(
      "career_guide_embeddings",
      guideIndexForLens(lens),
      { vector: queryVector, limit: GUIDE_SEARCH_LIMIT },
    );
    if (searchResults.length === 0) return [];

    const expanded = await ctx.runQuery(
      internal.matching._expandGuideCandidates,
      { embeddingIds: searchResults.map((r) => r._id) },
    );
    if (expanded.length === 0) return [];

    const documents = expanded.map(guideRerankDocument);

    const ranking = await rerank({
      query: guideRerankFraming(
        lens,
        me.enrichment.narrativeSummary ?? me.profile.headline ?? "",
        buildSelfArcText(me.enrichment),
      ),
      documents,
      topN: Math.min(limit, expanded.length),
    });

    const scoreById = new Map<Id<"career_guide_embeddings">, number>();
    for (const r of searchResults) scoreById.set(r._id, r._score);

    const out: GuideMatchSummary[] = [];
    for (const r of ranking) {
      const item = expanded[r.index];
      if (!item) continue;
      const url = item.illustrationStorageId
        ? await ctx.storage.getUrl(item.illustrationStorageId)
        : null;
      const snippet =
        item.overview.length > GUIDE_OVERVIEW_SNIPPET_LENGTH
          ? `${item.overview.slice(0, GUIDE_OVERVIEW_SNIPPET_LENGTH).trimEnd()}…`
          : item.overview;
      out.push({
        slug: item.slug,
        title: item.title,
        illustrationUrl: url,
        overviewSnippet: snippet,
        vectorScore: scoreById.get(item.embeddingId) ?? 0,
        fitScore: r.relevanceScore,
      });
    }
    return out;
  },
});

// ─── Snapshot-backed guides for profile page ────────────────────────────
//
// `guidesForMeFromSnapshot` projects the user's `discover_canvases` row
// onto the four Career Compass lanes — same source of truth, same
// lane keys, same labels surfaced in the canvas (`DiscoverCanvas.tsx`'s
// `LANE_META`). We read the precomputed lanes rather than running a
// second, divergent ranker.
//
// Status is surfaced explicitly so the UI can render a "Calibrate your
// Compass" CTA when the snapshot is missing/generating/failed instead of
// silently showing nothing. Auth follows the speculative-read pattern
// from `discover.getSnapshot` (return "missing" rather than throw, so
// the JWT race on first render doesn't surface as an uncaught error).

// Profile-page tease: show three cards per lane; the fourth grid slot
// is a CTA to the full Career Compass canvas.
const PROFILE_LANE_LIMIT = 3;

export type ProfileGuideCard = {
  slug: string;
  title: string;
  illustrationUrl: string | null;
  overviewSnippet: string;
  whyMatchReason: string;
};

export type GuidesFromSnapshot = {
  status: "missing" | "generating" | "ready" | "failed";
  lanes: {
    linear: ProfileGuideCard[];
    adjacent: ProfileGuideCard[];
    earlier: ProfileGuideCard[];
    transformational: ProfileGuideCard[];
  };
  failureReason: string | null;
};

export const guidesForMeFromSnapshot = query({
  args: {},
  handler: async (ctx): Promise<GuidesFromSnapshot> => {
    const empty = {
      linear: [] as ProfileGuideCard[],
      adjacent: [] as ProfileGuideCard[],
      earlier: [] as ProfileGuideCard[],
      transformational: [] as ProfileGuideCard[],
    };
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      return { status: "missing", lanes: empty, failureReason: null };
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user)
      return { status: "missing", lanes: empty, failureReason: null };
    const snap = await ctx.db
      .query("discover_canvases")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!snap)
      return { status: "missing", lanes: empty, failureReason: null };
    if (snap.status !== "ready") {
      return {
        status: snap.status,
        lanes: empty,
        failureReason: snap.failureReason ?? null,
      };
    }

    const lanesByKind = new Map(snap.lanes.map((l) => [l.kind, l.cards]));

    const hydrate = async (
      cards: Array<{
        guideId: Id<"career_guides">;
        whyMatchReason: string;
      }>,
    ): Promise<ProfileGuideCard[]> => {
      const limited = cards.slice(0, PROFILE_LANE_LIMIT);
      return Promise.all(
        limited.map(async (c) => {
          const g = await ctx.db.get(c.guideId);
          const overview = g?.content?.overview ?? "";
          const snippet =
            overview.length > GUIDE_OVERVIEW_SNIPPET_LENGTH
              ? `${overview.slice(0, GUIDE_OVERVIEW_SNIPPET_LENGTH).trimEnd()}…`
              : overview;
          const url = g?.illustrationStorageId
            ? await ctx.storage.getUrl(g.illustrationStorageId)
            : null;
          return {
            slug: g?.slug ?? "",
            title: g?.title ?? "(missing)",
            illustrationUrl: url,
            overviewSnippet: snippet,
            whyMatchReason: c.whyMatchReason,
          };
        }),
      );
    };

    const [linear, adjacent, earlier, transformational] = await Promise.all([
      hydrate(lanesByKind.get("linear") ?? []),
      hydrate(lanesByKind.get("adjacent") ?? []),
      hydrate(lanesByKind.get("earlier") ?? []),
      hydrate(lanesByKind.get("transformational") ?? []),
    ]);

    return {
      status: "ready",
      lanes: { linear, adjacent, earlier, transformational },
      failureReason: null,
    };
  },
});
