import {
  query,
  mutation,
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { generateText, Output } from "ai";
import { chatModel, rerank } from "../lib/ai/providers";
import {
  PEOPLE_EXTRACT_MODEL_ID,
  PersonProfileSchema,
  buildPeopleExtractionSystemPrompt,
  buildPeopleExtractionUserPrompt,
} from "../lib/ai/prompts/outreach";
import { exaSearchLinkedIn } from "../lib/server/exa";
import { tryConsumeRateLimit } from "./lib/rateLimit";

// ── Tunables ────────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SEARCH_NUM_RESULTS = 10;
const LLM_TIMEOUT_MS = 45_000;
// A run row in `running` older than this is considered dead and re-runnable.
const RUN_FRESHNESS_MS = 90_000;
const LINKEDIN_PROFILE_RE = /^https:\/\/([\w-]+\.)?linkedin\.com\/in\//i;

// ── Helpers ─────────────────────────────────────────────────────────────────

const resolveAuthedUser = async (
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
};

// What the UI sees per person — strips internal cost / query metadata.
type PublicKeyPerson = {
  _id: Id<"key_people">;
  name: string;
  headline: string;
  linkedinUrl: string;
  imageUrl?: string;
  profileSummary: string;
  currentRole: string;
  currentCompany: string;
  relevanceReason: string;
  createdAt: number;
};

const toPublicKeyPerson = (row: Doc<"key_people">): PublicKeyPerson => ({
  _id: row._id,
  name: row.name,
  headline: row.headline,
  linkedinUrl: row.linkedinUrl,
  imageUrl: row.imageUrl,
  profileSummary: row.profileSummary,
  currentRole: row.currentRole,
  currentCompany: row.currentCompany,
  relevanceReason: row.relevanceReason,
  createdAt: row.createdAt,
});

// ── Public query: list people for a guide (auth-gated) ─────────────────────

export const listForGuide = query({
  args: { guideId: v.id("career_guides") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    state: "anonymous" | "idle" | "running" | "ready" | "failed";
    error?: string;
    people: PublicKeyPerson[];
  }> => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { state: "anonymous", people: [] };

    const rows = await ctx.db
      .query("key_people")
      .withIndex("by_guide_user_created", (q) =>
        q.eq("guideId", args.guideId).eq("userId", user._id),
      )
      .order("desc")
      .collect();

    const run = await ctx.db
      .query("key_people_runs")
      .withIndex("by_guide_user", (q) =>
        q.eq("guideId", args.guideId).eq("userId", user._id),
      )
      .unique();

    const people = rows.map(toPublicKeyPerson);

    // Treat a stale "running" row (>90s old) as dead so the UI offers a
    // retry instead of spinning forever.
    if (run?.status === "running") {
      if (Date.now() - run.startedAt < RUN_FRESHNESS_MS) {
        return { state: "running", people };
      }
    }

    if (run?.status === "failed") {
      return { state: "failed", error: run.error, people };
    }

    if (people.length > 0) return { state: "ready", people };
    return { state: "idle", people: [] };
  },
});

// ── Public mutation: trigger search ────────────────────────────────────────

export const triggerSearch = mutation({
  args: { guideId: v.id("career_guides") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; state: "scheduled" | "noop" }
    | { ok: false; reason: "anonymous" | "rate-limited"; retryAfterMs?: number }
  > => {
    const user = await resolveAuthedUser(ctx);
    if (!user) return { ok: false, reason: "anonymous" };

    const guide = await ctx.db.get(args.guideId);
    if (!guide) throw new Error("Guide not found");

    const existingRun = await ctx.db
      .query("key_people_runs")
      .withIndex("by_guide_user", (q) =>
        q.eq("guideId", args.guideId).eq("userId", user._id),
      )
      .unique();

    // A fresh in-flight run wins — do not double-schedule.
    if (
      existingRun?.status === "running" &&
      Date.now() - existingRun.startedAt < RUN_FRESHNESS_MS
    ) {
      return { ok: true, state: "noop" };
    }

    const rateLimitKey = `keyPeople_${user._id}`;
    const limit = await tryConsumeRateLimit(ctx, {
      key: rateLimitKey,
      max: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!limit.ok) {
      return {
        ok: false,
        reason: "rate-limited",
        retryAfterMs: limit.retryAfterMs,
      };
    }

    if (existingRun) {
      await ctx.db.patch(existingRun._id, {
        status: "running",
        startedAt: Date.now(),
        finishedAt: undefined,
        error: undefined,
      });
    } else {
      await ctx.db.insert("key_people_runs", {
        guideId: args.guideId,
        userId: user._id,
        status: "running",
        startedAt: Date.now(),
      });
    }

    await ctx.scheduler.runAfter(0, internal.people._runSearch, {
      guideId: args.guideId,
      userId: user._id,
    });

    return { ok: true, state: "scheduled" };
  },
});

// ── Internal: read inputs needed to run the search ─────────────────────────

export const _readSearchInputs = internalQuery({
  args: { userId: v.id("users"), guideId: v.id("career_guides") },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const enrichment = await ctx.db
      .query("profile_enrichments")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    return {
      guide: {
        _id: guide._id,
        title: guide.title,
      },
      profileSummary:
        enrichment?.narrativeSummary ?? profile?.summary ?? null,
    };
  },
});

export const _existingUrlsForUser = internalQuery({
  args: {
    userId: v.id("users"),
    urls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.urls.length === 0) return [];
    const found: string[] = [];
    for (const url of args.urls) {
      const row = await ctx.db
        .query("key_people")
        .withIndex("by_user_url", (q) =>
          q.eq("userId", args.userId).eq("linkedinUrl", url),
        )
        .first();
      if (row) found.push(url);
    }
    return found;
  },
});

// ── Internal: persist results + flip run status ───────────────────────────

export const _saveResults = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    userId: v.id("users"),
    searchQuery: v.string(),
    perPersonCostCents: v.number(),
    people: v.array(
      v.object({
        name: v.string(),
        headline: v.string(),
        linkedinUrl: v.string(),
        imageUrl: v.optional(v.string()),
        profileSummary: v.string(),
        currentRole: v.string(),
        currentCompany: v.string(),
        relevanceReason: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const p of args.people) {
      const dup = await ctx.db
        .query("key_people")
        .withIndex("by_user_url", (q) =>
          q.eq("userId", args.userId).eq("linkedinUrl", p.linkedinUrl),
        )
        .first();
      if (dup) continue;
      await ctx.db.insert("key_people", {
        guideId: args.guideId,
        userId: args.userId,
        name: p.name,
        headline: p.headline,
        linkedinUrl: p.linkedinUrl,
        imageUrl: p.imageUrl,
        profileSummary: p.profileSummary,
        currentRole: p.currentRole,
        currentCompany: p.currentCompany,
        relevanceReason: p.relevanceReason,
        searchQuery: args.searchQuery,
        costCents: args.perPersonCostCents,
        createdAt: Date.now(),
      });
    }
  },
});

export const _markRun = internalMutation({
  args: {
    guideId: v.id("career_guides"),
    userId: v.id("users"),
    outcome: v.union(
      v.object({ kind: v.literal("complete") }),
      v.object({ kind: v.literal("failed"), error: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("key_people_runs")
      .withIndex("by_guide_user", (q) =>
        q.eq("guideId", args.guideId).eq("userId", args.userId),
      )
      .unique();
    if (!run) return;
    if (args.outcome.kind === "complete") {
      await ctx.db.patch(run._id, {
        status: "complete",
        finishedAt: Date.now(),
        error: undefined,
      });
    } else {
      await ctx.db.patch(run._id, {
        status: "failed",
        finishedAt: Date.now(),
        error: args.outcome.error.slice(0, 500),
      });
    }
  },
});

// ── Internal action: actually run the search ──────────────────────────────

export const _runSearch = internalAction({
  args: {
    guideId: v.id("career_guides"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<void> => {
    try {
      const inputs = await ctx.runQuery(internal.people._readSearchInputs, {
        userId: args.userId,
        guideId: args.guideId,
      });
      if (!inputs) {
        await ctx.runMutation(internal.people._markRun, {
          guideId: args.guideId,
          userId: args.userId,
          outcome: { kind: "failed", error: "Guide not found" },
        });
        return;
      }
      const { guide, profileSummary } = inputs;

      const query = `${guide.title} professionals currently working LinkedIn`;

      const exaController = new AbortController();
      const exaTimer = setTimeout(
        () => exaController.abort(),
        LLM_TIMEOUT_MS,
      );
      let exaResults: Awaited<ReturnType<typeof exaSearchLinkedIn>>;
      try {
        exaResults = await exaSearchLinkedIn(query, {
          numResults: SEARCH_NUM_RESULTS,
          signal: exaController.signal,
        });
      } finally {
        clearTimeout(exaTimer);
      }

      // Filter to actual /in/ profiles — search results occasionally
      // surface company pages or articles even with includeDomains.
      const profileResults = exaResults.results.filter((r) =>
        LINKEDIN_PROFILE_RE.test(r.url),
      );
      if (profileResults.length === 0) {
        await ctx.runMutation(internal.people._markRun, {
          guideId: args.guideId,
          userId: args.userId,
          outcome: {
            kind: "failed",
            error:
              "Couldn't find anyone obvious for this role yet. Try again in a moment.",
          },
        });
        return;
      }

      // Dedup against existing rows for this user (cross-guide).
      const dupes = await ctx.runQuery(internal.people._existingUrlsForUser, {
        userId: args.userId,
        urls: profileResults.map((r) => r.url),
      });
      const dupeSet = new Set(dupes);
      const fresh = profileResults.filter((r) => !dupeSet.has(r.url));
      if (fresh.length === 0) {
        // Already have results for this user — surface them by marking run
        // complete; listForGuide will return the existing rows from
        // by_guide_user_created (if they're for this guide). If they're for
        // a different guide, the user sees an empty list + retry — acceptable.
        await ctx.runMutation(internal.people._markRun, {
          guideId: args.guideId,
          userId: args.userId,
          outcome: { kind: "complete" },
        });
        return;
      }

      // Structured extraction with a fast model.
      const extractController = new AbortController();
      const extractTimer = setTimeout(
        () => extractController.abort(),
        LLM_TIMEOUT_MS,
      );
      let parsed: { people: ReturnType<typeof PersonProfileSchema.parse>["people"] };
      try {
        const { output } = await generateText({
          model: chatModel(PEOPLE_EXTRACT_MODEL_ID, { zdr: true }),
          output: Output.object({ schema: PersonProfileSchema }),
          system: buildPeopleExtractionSystemPrompt(profileSummary),
          prompt: buildPeopleExtractionUserPrompt({
            guideTitle: guide.title,
            profiles: fresh.map((r) => ({
              url: r.url,
              title: r.title,
              text: r.text,
            })),
          }),
          abortSignal: extractController.signal,
        });
        parsed = output;
      } finally {
        clearTimeout(extractTimer);
      }

      if (!parsed.people || parsed.people.length === 0) {
        await ctx.runMutation(internal.people._markRun, {
          guideId: args.guideId,
          userId: args.userId,
          outcome: {
            kind: "failed",
            error: "Could not parse profile data from search results.",
          },
        });
        return;
      }

      // Align by index (the prompt asks for one entry per profile, in order).
      // Truncate to the shorter of the two arrays in case the model dropped
      // a profile.
      const aligned = parsed.people
        .slice(0, fresh.length)
        .map((p, i) => ({
          ...p,
          linkedinUrl: fresh[i]?.url ?? "",
          imageUrl: fresh[i]?.imageUrl,
        }))
        .filter((p) => p.linkedinUrl);

      // Optional rerank against the user's profile summary.
      let ordered = aligned;
      if (profileSummary && aligned.length > 1) {
        try {
          const documents = aligned.map(
            (p) =>
              `${p.name}. ${p.currentRole} at ${p.currentCompany}. ${p.profileSummary}`,
          );
          const ranked = await rerank({
            query: profileSummary,
            documents,
            topN: documents.length,
          });
          if (ranked.length > 0) {
            ordered = ranked.map((r) => aligned[r.index]).filter(Boolean);
          }
        } catch (err) {
          // Rerank is a nice-to-have; surface ordering failures in logs but
          // do not block the user's results.
          console.warn("people._runSearch:rerank_failed", {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const totalCostCents = exaResults.costCents;
      const perPerson = ordered.length
        ? Math.round((totalCostCents / ordered.length) * 100) / 100
        : 0;

      await ctx.runMutation(internal.people._saveResults, {
        guideId: args.guideId,
        userId: args.userId,
        searchQuery: query,
        perPersonCostCents: perPerson,
        people: ordered.map((p) => ({
          name: p.name,
          headline: p.headline,
          linkedinUrl: p.linkedinUrl,
          imageUrl: p.imageUrl,
          profileSummary: p.profileSummary,
          currentRole: p.currentRole,
          currentCompany: p.currentCompany,
          relevanceReason: p.relevanceReason,
        })),
      });

      await ctx.runMutation(internal.people._markRun, {
        guideId: args.guideId,
        userId: args.userId,
        outcome: { kind: "complete" },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown search error";
      console.error("people._runSearch:failed", {
        userId: args.userId,
        guideId: args.guideId,
        message,
      });
      await ctx.runMutation(internal.people._markRun, {
        guideId: args.guideId,
        userId: args.userId,
        outcome: { kind: "failed", error: message },
      });
    }
  },
});
