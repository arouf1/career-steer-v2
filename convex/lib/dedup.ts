import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { normalizeTitle } from "./normalize";

export type LexicalMatch = {
  guideId: Id<"career_guides">;
  slug: string;
  title: string;
};

/**
 * Tier-1 dedup: exact case-insensitive title match.
 * Fast, free, and catches the common case where a user retypes a title
 * they've already seen. All other variants (acronyms, seniority,
 * synonyms) fall through to the tier-4 LLM dedup check.
 */
export const findGuideByExactTitle = async (
  ctx: QueryCtx,
  rawQuery: string,
): Promise<LexicalMatch | null> => {
  const titleNormalized = normalizeTitle(rawQuery);
  if (!titleNormalized) return null;

  const exact = await ctx.db
    .query("career_guides")
    .withIndex("by_title_normalized", (q) =>
      q.eq("titleNormalized", titleNormalized),
    )
    .first();
  if (!exact) return null;
  // Failed rows are retryable — fall through so _requestGeneration can reset them.
  if (exact.contentStatus === "failed") return null;

  return {
    guideId: exact._id,
    slug: exact.slug,
    title: exact.title,
  };
};

export type SearchCandidate = {
  slug: string;
  title: string;
};

/**
 * Top-N candidates from the title search index, used as input to the
 * tier-4 LLM dedup check.
 */
export const searchGuideCandidates = async (
  ctx: QueryCtx,
  rawQuery: string,
  limit: number,
): Promise<SearchCandidate[]> => {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];

  const hits: Doc<"career_guides">[] = await ctx.db
    .query("career_guides")
    .withSearchIndex("search_title", (q) => q.search("title", trimmed))
    .take(limit);

  return hits
    .filter((h) => h.contentStatus !== "failed")
    .map((h) => ({ slug: h.slug, title: h.title }));
};
