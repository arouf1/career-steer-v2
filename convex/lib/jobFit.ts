import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type ProfileAndJobVectors = {
  profileVector: number[];
  jobVectors: Array<{
    jobPostingId: Id<"job_postings">;
    vector: number[];
  }>;
};

export async function loadProfileAndJobVectors(
  ctx: QueryCtx,
  tokenIdentifier: string,
  jobPostingIds: ReadonlyArray<Id<"job_postings">>,
): Promise<ProfileAndJobVectors | null> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .unique();
  if (!user) return null;

  const profileEmbedding = await ctx.db
    .query("profile_embeddings")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .unique();
  if (!profileEmbedding) return null;

  const jobVectors: ProfileAndJobVectors["jobVectors"] = [];
  for (const jobPostingId of jobPostingIds) {
    const e = await ctx.db
      .query("job_posting_embeddings")
      .withIndex("by_jobPostingId", (q) => q.eq("jobPostingId", jobPostingId))
      .unique();
    if (e) {
      jobVectors.push({ jobPostingId, vector: e.wholeVector });
    }
  }

  return { profileVector: profileEmbedding.wholeVector, jobVectors };
}
