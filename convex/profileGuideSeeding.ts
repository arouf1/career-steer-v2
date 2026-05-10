import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { expandTitleAbbreviations } from "./lib/titleAbbreviations";

const MAX_JOBS_PER_SEED = 10;
const MIN_CONFIDENCE = 0.3;

// Sort order: most-recent first. A missing endDate is treated as "current"
// and sorts to the very top. Within the same endDate, newer startDate wins.
type ExperienceEntry = {
  title: string;
  company: string;
  startDate?: string;
  endDate?: string;
  description?: string;
};

const sortByRecency = (jobs: readonly ExperienceEntry[]): ExperienceEntry[] =>
  [...jobs].sort((a, b) => {
    const aKey = a.endDate ?? "9999-99";
    const bKey = b.endDate ?? "9999-99";
    if (aKey !== bKey) return bKey.localeCompare(aKey);
    return (b.startDate ?? "").localeCompare(a.startDate ?? "");
  });

// Deterministic equality token for the canonical-title set. We do not need
// a cryptographic hash, just an unambiguous string that changes iff the set
// changes. Sort first so order doesn't affect equality.
const checksumOf = (canonicalTitles: readonly string[]): string =>
  [...canonicalTitles].sort().join("|");

export const _loadProfileForSeeding = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const _markSeeded = internalMutation({
  args: {
    profileId: v.id("profiles"),
    checksum: v.string(),
    seededSlugs: v.array(v.string()),
  },
  handler: async (ctx, { profileId, checksum, seededSlugs }) => {
    await ctx.db.patch(profileId, {
      guidesSeededAt: Date.now(),
      guidesSeedChecksum: checksum,
      seedingGuideSlugs: seededSlugs,
    });
  },
});

export const seedGuidesFromProfile = internalAction({
  args: { userId: v.id("users") },
  handler: async (
    ctx,
    { userId },
  ): Promise<{ seededSlugs: string[]; skipped: boolean }> => {
    const profile = await ctx.runQuery(
      internal.profileGuideSeeding._loadProfileForSeeding,
      { userId },
    );
    if (!profile) return { seededSlugs: [], skipped: true };

    const recent = sortByRecency(profile.experience).slice(
      0,
      MAX_JOBS_PER_SEED,
    );

    // Pass 1: dedupe by deterministic prefilter (cheap layer-1 dedup).
    const seenPrefilter = new Set<string>();
    const uniqueRawTitles: string[] = [];
    for (const job of recent) {
      if (!job.title) continue;
      const key = expandTitleAbbreviations(job.title);
      if (!key) continue;
      if (seenPrefilter.has(key)) continue;
      seenPrefilter.add(key);
      uniqueRawTitles.push(job.title);
    }

    if (uniqueRawTitles.length === 0) {
      return { seededSlugs: [], skipped: true };
    }

    // Canonicalize each unique prefilter, cache hits return instantly,
    // misses share the cache for future profiles. Run in parallel; bounded
    // implicitly by MAX_JOBS_PER_SEED.
    const canonicalResults = await Promise.all(
      uniqueRawTitles.map((rawTitle) =>
        ctx.runAction(
          internal.titleCanonicalization.getOrCreateCanonical,
          { rawTitle },
        ),
      ),
    );

    // Pass 2: dedupe by canonical title. The LLM may map two different
    // prefilters to the same canonical (e.g. "lead engineer" and "engineering
    // lead"), so we coalesce again here. Skip low-confidence canonicalizations.
    const seenCanonical = new Map<string, string>();
    for (const r of canonicalResults) {
      if (r.confidence < MIN_CONFIDENCE) continue;
      seenCanonical.set(r.canonicalTitle.toLowerCase(), r.canonicalTitle);
    }

    const canonicalTitles = Array.from(seenCanonical.values());
    const checksum = checksumOf(canonicalTitles);

    // Idempotency: same canonical-title set as last seed → no-op.
    if (profile.guidesSeedChecksum === checksum) {
      return {
        seededSlugs: profile.seedingGuideSlugs ?? [],
        skipped: true,
      };
    }

    if (canonicalTitles.length === 0) {
      return { seededSlugs: [], skipped: true };
    }

    // Layer-3 row dedup happens inside _requestGenerationForSeeding via the
    // existing slug-OCC pattern. Concurrent fan-outs across users with
    // overlapping canonicals resolve to one career_guides row.
    const generationResults = await Promise.all(
      canonicalTitles.map((title) =>
        ctx.runMutation(
          internal.careerGuides._requestGenerationForSeeding,
          { title, userId },
        ),
      ),
    );

    const seededSlugs = generationResults
      .filter((r): r is { slug: string } => "slug" in r)
      .map((r) => r.slug);

    await ctx.runMutation(internal.profileGuideSeeding._markSeeded, {
      profileId: profile._id,
      checksum,
      seededSlugs,
    });

    return { seededSlugs, skipped: false };
  },
});
