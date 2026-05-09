// One-shot: insert the initial career ladder catalog. Idempotent — re-running
// skips ladders whose `slug` already exists. Subsequent ladder additions
// should be done by adding a new entry below and re-running this migration.
//
// Invoke once with no args:
//   npx convex run --no-push 'migrations/2026_05_09_seed_ladders:seedLadders' '{}'
//
// Empty ladders are useless until the backfill action
// (`migrations/2026_05_09_backfill_guide_ladder_positions:backfill`) places
// the existing 140 guides onto them. Run the seed first, then the backfill.
//
// The `description` field encodes the canonical rung layout per ladder so
// the LLM classifier in the backfill action has a strong prior for which
// title belongs at which rung. We deliberately do NOT pre-create rungs as
// rows in `career_guide_ladder_positions` — positions are created by the
// backfill (and on-demand generation later) once a guide actually exists.

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

type SeedLadder = {
  slug: string;
  name: string;
  family:
    | "product"
    | "engineering"
    | "design"
    | "data"
    | "marketing"
    | "sales"
    | "finance"
    | "legal"
    | "operations"
    | "people"
    | "customer-success"
    | "research"
    | "healthcare"
    | "education"
    | "trades"
    | "creative"
    | "other";
  description: string;
};

// Editorial, user-facing descriptions. Single sentence each — these surface
// directly in the catalogue's "By ladder" section headers and in the guide
// page's breadcrumb context. The LLM ladder classifier no longer needs the
// rung-by-rung encoding here because it gets that information at runtime
// from `occupiedRungs` in `_loadLaddersForPrompt` / `_listLaddersForLookup`.
const SEED_LADDERS: SeedLadder[] = [
  {
    slug: "product-management",
    name: "Product Management",
    family: "product",
    description:
      "Shaping what gets built and why, from a first product to leading the whole product organisation.",
  },
  {
    slug: "software-engineering",
    name: "Software Engineering",
    family: "engineering",
    description:
      "Designing, writing, and shipping the systems that make a product real, on the IC craft track or the people-leadership one.",
  },
  {
    slug: "design",
    name: "Design",
    family: "design",
    description:
      "Product, interaction, and visual craft, from a first design role to setting taste across an entire company.",
  },
  {
    slug: "data-science",
    name: "Data Science & Analytics",
    family: "data",
    description:
      "Turning data into decisions, models, and product features, from analyst through to Chief Data Officer.",
  },
  {
    slug: "marketing",
    name: "Marketing",
    family: "marketing",
    description:
      "Brand, growth, content, performance, and lifecycle work, from coordinator through to Chief Marketing Officer.",
  },
  {
    slug: "sales",
    name: "Sales",
    family: "sales",
    description:
      "Revenue and customer acquisition, from outbound prospecting through to leading a global sales organisation.",
  },
  {
    slug: "finance",
    name: "Finance",
    family: "finance",
    description:
      "Planning, accounting, and capital, from analyst through to Chief Financial Officer.",
  },
  {
    slug: "legal",
    name: "Legal",
    family: "legal",
    description:
      "Counsel, compliance, and risk, from paralegal through to general counsel.",
  },
  {
    slug: "operations",
    name: "Operations",
    family: "operations",
    description:
      "Logistics, supply chain, procurement, and the systems that keep a business running, from coordinator through to COO.",
  },
  {
    slug: "people",
    name: "People & HR",
    family: "people",
    description:
      "Hiring, growing, and supporting the people who do the work, from coordinator through to Chief People Officer.",
  },
  {
    slug: "customer-success",
    name: "Customer Success",
    family: "customer-success",
    description:
      "Keeping customers winning after the sale, from frontline associate through to chief customer officer.",
  },
  {
    slug: "research",
    name: "Research & Academia",
    family: "research",
    description:
      "Original research in industry and the university, from research assistant through to chief scientist or full professor.",
  },
  {
    slug: "healthcare-clinical",
    name: "Healthcare (Clinical)",
    family: "healthcare",
    description:
      "Practising clinicians and allied health professionals, from coordinator through to chief medical officer.",
  },
  {
    slug: "education",
    name: "Education",
    family: "education",
    description:
      "Teaching and educational leadership, from teaching assistant through to school leadership and beyond.",
  },
  {
    slug: "trades",
    name: "Skilled Trades",
    family: "trades",
    description:
      "Hands-on craft, from apprenticeship through to running multi-site projects.",
  },
  {
    slug: "creative",
    name: "Creative",
    family: "creative",
    description:
      "Writing, design, music, and visual art as a vocation, from junior creative through to chief creative officer.",
  },
];

export const seedLadders = internalMutation({
  args: {},
  returns: v.object({
    inserted: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    let inserted = 0;
    let skipped = 0;
    const now = Date.now();

    for (const seed of SEED_LADDERS) {
      const existing = await ctx.db
        .query("career_ladders")
        .withIndex("by_slug", (q) => q.eq("slug", seed.slug))
        .unique();

      if (existing) {
        skipped++;
        continue;
      }

      await ctx.db.insert("career_ladders", {
        slug: seed.slug,
        name: seed.name,
        family: seed.family,
        description: seed.description,
        createdAt: now,
      });
      inserted++;
    }

    return { inserted, skipped };
  },
});

// Patch existing rows' editorial fields (name, description) to match the
// current SEED_LADDERS constant. Used after rewriting copy — original seed
// descriptions encoded the rung map for the LLM classifier and leaked to
// the catalogue UI. This is idempotent and safe to re-run any time the
// editorial copy changes.
//
// Invoke with no args:
//   npx convex run --no-push 'migrations/2026_05_09_seed_ladders:refreshLadderCopy' '{}'
export const refreshLadderCopy = internalMutation({
  args: {},
  returns: v.object({
    patched: v.number(),
    skipped: v.number(),
    notFound: v.number(),
  }),
  handler: async (ctx) => {
    let patched = 0;
    let skipped = 0;
    let notFound = 0;

    for (const seed of SEED_LADDERS) {
      const existing = await ctx.db
        .query("career_ladders")
        .withIndex("by_slug", (q) => q.eq("slug", seed.slug))
        .unique();
      if (!existing) {
        notFound++;
        continue;
      }
      if (
        existing.name === seed.name &&
        existing.description === seed.description
      ) {
        skipped++;
        continue;
      }
      await ctx.db.patch(existing._id, {
        name: seed.name,
        description: seed.description,
      });
      patched++;
    }

    return { patched, skipped, notFound };
  },
});
