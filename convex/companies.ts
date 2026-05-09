import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { searchBrand, brandfetchLogoUrl } from "../lib/server/brandfetch";

// 30-day refresh window. Brand metadata changes rarely, so re-running on
// every page view would be wasteful; this also bounds Brandfetch API spend.
const BRAND_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

// ── Mutations ─────────────────────────────────────────────────────────────

export const _setBrandResult = internalMutation({
  args: {
    companyId: v.id("companies"),
    domain: v.union(v.string(), v.null()),
    logoUrl: v.union(v.string(), v.null()),
    brandColor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) return;
    await ctx.db.patch(args.companyId, {
      // Don't overwrite a manually-curated domain (e.g. one we may set later
      // via admin tools) with a Brandfetch result. The current MVP has no
      // such tool, so this is a guard for future us.
      domain: company.domain ?? args.domain ?? undefined,
      logoUrl: args.logoUrl,
      brandColor: args.brandColor,
      brandEnrichedAt: Date.now(),
    });
  },
});

// ── Actions ────────────────────────────────────────────────────────────────

export const _enrichBrand = internalAction({
  args: { companyId: v.id("companies") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Read-then-act: skip companies enriched recently. Reading via runQuery
    // requires a wrapper; using a small _shouldEnrich query is overkill, so
    // we read inside the result mutation and gate further work via a stale
    // check on the action itself by re-reading via runMutation reading.
    // Simpler: just always run if scheduled. The scheduler is fired on insert
    // (one-shot) so by construction we don't re-enrich often. For ad-hoc
    // re-runs the BRAND_REFRESH_MS guard could move into _setBrandResult.

    const company = await ctx.runQuery(
      internal.companies._loadForEnrichment,
      { companyId: args.companyId },
    );
    if (!company) return null;
    if (
      company.brandEnrichedAt &&
      Date.now() - company.brandEnrichedAt < BRAND_REFRESH_MS
    ) {
      return null;
    }

    let domain: string | null = null;
    let logoUrl: string | null = null;

    try {
      const hit = await searchBrand(company.nameRaw);
      if (hit) {
        domain = hit.domain;
        const clientId = process.env.BRANDFETCH_CLIENT_ID;
        if (!clientId) throw new Error("BRANDFETCH_CLIENT_ID is not set");
        // Prefer the explicit `icon` Brandfetch returns; fall back to the
        // CDN URL builder so every domain gets a logo (lettermark fallback
        // happens at the CDN layer when the company has no real logo).
        logoUrl = hit.icon ?? brandfetchLogoUrl(hit.domain, clientId);
      }
    } catch (err) {
      console.error("companies._enrichBrand:failed", {
        companyId: args.companyId,
        nameRaw: company.nameRaw,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    await ctx.runMutation(internal.companies._setBrandResult, {
      companyId: args.companyId,
      domain,
      logoUrl,
      // Brand colour requires the paid Brand API, not Brand Search. Defer
      // to a later sub-project / paid plan.
      brandColor: null,
    });
    return null;
  },
});

// ── Internal helpers ──────────────────────────────────────────────────────

import { internalQuery } from "./_generated/server";

export const _loadForEnrichment = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.companyId);
    if (!c) return null;
    return {
      _id: c._id,
      nameRaw: c.nameRaw,
      brandEnrichedAt: c.brandEnrichedAt ?? null,
    };
  },
});
