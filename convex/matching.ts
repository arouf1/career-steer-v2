import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
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
