import type { MutationCtx } from "../_generated/server";

export type RateLimitArgs = {
  key: string;
  max: number;
  windowMs: number;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

export const tryConsumeRateLimit = async (
  ctx: MutationCtx,
  { key, max, windowMs }: RateLimitArgs,
): Promise<RateLimitResult> => {
  const now = Date.now();
  const existing = await ctx.db
    .query("rate_limits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (!existing) {
    await ctx.db.insert("rate_limits", {
      key,
      count: 1,
      windowStartMs: now,
    });
    return { ok: true };
  }

  const windowEnd = existing.windowStartMs + windowMs;
  if (now >= windowEnd) {
    await ctx.db.patch(existing._id, { count: 1, windowStartMs: now });
    return { ok: true };
  }

  if (existing.count < max) {
    await ctx.db.patch(existing._id, { count: existing.count + 1 });
    return { ok: true };
  }

  return { ok: false, retryAfterMs: windowEnd - now };
};
