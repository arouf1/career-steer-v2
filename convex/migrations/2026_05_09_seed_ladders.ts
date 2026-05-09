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

const SEED_LADDERS: SeedLadder[] = [
  {
    slug: "product-management",
    name: "Product Management",
    family: "product",
    description:
      "Product strategy and execution from individual contributor through C-suite. Rungs: APM (rung 0, ic-entry), PM (1, ic-mid), Senior PM (2, ic-senior), Head of Product (3, head), Director of Product (4, director), VP Product (5, vp), CPO (6, c-suite).",
  },
  {
    slug: "software-engineering",
    name: "Software Engineering",
    family: "engineering",
    description:
      "IC and management track for software engineers. Rungs: Junior SWE (0, ic-entry), Software Engineer (1, ic-mid), Senior SWE (2, ic-senior), Staff/Principal SWE (3, ic-senior), Engineering Manager (4, manager), Head of Engineering (5, head), Director of Engineering (6, director), VP Engineering (7, vp), CTO (8, c-suite). Specialised IC tracks (Frontend, Backend, ML, Cloud, DevOps, SRE, Data, Mobile, Security) sit on this same ladder unless they have their own dedicated ladder.",
  },
  {
    slug: "design",
    name: "Design",
    family: "design",
    description:
      "Product, UX, and visual design IC and management track. Rungs: Junior Designer (0, ic-entry), Designer (1, ic-mid), Senior Designer (2, ic-senior), Staff/Principal Designer (3, ic-senior), Design Manager (4, manager), Head of Design (5, head), Director of Design (6, director), VP Design (7, vp), Chief Design Officer (8, c-suite).",
  },
  {
    slug: "data-science",
    name: "Data Science & Analytics",
    family: "data",
    description:
      "Data science, analytics, and ML practitioner track. Rungs: Data Analyst (0, ic-entry), Data Scientist (1, ic-mid), Senior Data Scientist (2, ic-senior), Staff/Principal Data Scientist (3, ic-senior), Data Science Manager (4, manager), Head of Data (5, head), Director of Data (6, director), VP Data (7, vp), Chief Data Officer (8, c-suite). NLP / Computer Vision / Bioinformatics specialists sit on this ladder.",
  },
  {
    slug: "marketing",
    name: "Marketing",
    family: "marketing",
    description:
      "Marketing IC and management track across brand, growth, content, performance, and lifecycle. Rungs: Marketing Coordinator (0, ic-entry), Marketing Manager IC (1, ic-mid), Senior Marketing Manager (2, ic-senior), Marketing Director on management track (4, manager when leading a small team), Head of Marketing (5, head), Director of Marketing (6, director), VP Marketing (7, vp), CMO (8, c-suite). Specialised IC sub-disciplines (Brand, Growth, Content, SEO, Email, Performance, Influencer) sit on this ladder.",
  },
  {
    slug: "sales",
    name: "Sales",
    family: "sales",
    description:
      "Sales IC and management track. Rungs: SDR/BDR (0, ic-entry), Account Executive (1, ic-mid), Senior AE / Enterprise AE (2, ic-senior), Sales Manager (3, manager), Head of Sales (4, head), Director of Sales (5, director), VP Sales (6, vp), Chief Revenue Officer (7, c-suite). Specialisations: Channel Sales, Account Management, Sales Engineering all sit here unless they have their own ladder.",
  },
  {
    slug: "finance",
    name: "Finance",
    family: "finance",
    description:
      "Corporate finance and FP&A track. Rungs: Financial Analyst (0, ic-entry), Senior Financial Analyst (1, ic-mid), Finance Manager (2, manager), Head of Finance (3, head), Director of Finance (4, director), VP Finance (5, vp), CFO (6, c-suite). Specialisations: Accounting (Tax Accountant, Internal Auditor, Treasury, Controller), Investment Banking (own ladder altitude lookup but family=finance), Equity Research.",
  },
  {
    slug: "legal",
    name: "Legal",
    family: "legal",
    description:
      "Legal IC and leadership track. Rungs: Paralegal (0, ic-entry), Attorney / Associate Counsel (1, ic-mid), Senior Counsel (2, ic-senior), Legal Manager (3, manager), Head of Legal (4, head), Director of Legal (5, director), VP Legal (6, vp), General Counsel / Chief Legal Officer (7, c-suite). Specialisations: Corporate Counsel, Compliance Officer, Privacy Officer, Regulatory Affairs.",
  },
  {
    slug: "operations",
    name: "Operations",
    family: "operations",
    description:
      "Business operations and supply-chain track. Rungs: Operations Coordinator (0, ic-entry), Operations Analyst (1, ic-mid), Operations Manager (2, manager), Head of Operations (3, head), Director of Operations (4, director), VP Operations (5, vp), COO (6, c-suite). Specialisations: Procurement, Logistics, Inventory Planning, Demand Planning, Warehouse, Transportation, Construction Project Management, Supply Chain.",
  },
  {
    slug: "people",
    name: "People & HR",
    family: "people",
    description:
      "HR, talent, and L&D track. Rungs: HR Coordinator (0, ic-entry), HR Generalist (1, ic-mid), Senior HR Business Partner (2, ic-senior), People Manager (3, manager), Head of People (4, head), Director of People (5, director), VP People (6, vp), CHRO / Chief People Officer (7, c-suite). This ladder is also the SECONDARY ladder for any people-managing role across other functions (Engineering Manager, Design Manager, Sales Manager, etc.) — they get a position here at the manager tier in addition to their functional ladder.",
  },
  {
    slug: "customer-success",
    name: "Customer Success",
    family: "customer-success",
    description:
      "Customer success / account management for retention and expansion. Rungs: CS Associate (0, ic-entry), Customer Success Manager (1, ic-mid), Senior CSM (2, ic-senior), CS Manager team-lead (3, manager), Head of CS (4, head), Director of CS (5, director), VP CS (6, vp), Chief Customer Officer (7, c-suite).",
  },
  {
    slug: "research",
    name: "Research & Academia",
    family: "research",
    description:
      "Academic and corporate R&D track. Rungs: Research Assistant (0, ic-entry), Researcher / Research Scientist (1, ic-mid), Senior Researcher (2, ic-senior), Principal Researcher (3, ic-senior), Research Manager (4, manager), Head of Research (5, head), Director of Research (6, director), VP Research (7, vp), Chief Scientist (8, c-suite). Specialisations: Materials Scientist, Biomedical Scientist, Marine Biologist, Microbiologist, Molecular Biologist, Immunologist, Epidemiologist, Zoologist, Professor (academic).",
  },
  {
    slug: "healthcare-clinical",
    name: "Healthcare (Clinical)",
    family: "healthcare",
    description:
      "Practising clinicians and allied health track. Rungs: Clinical Trial Coordinator (0, ic-entry), Practitioner — Nurse / Therapist / Pharmacist / Physician Assistant (1, ic-mid), Senior Practitioner (2, ic-senior), Clinical Lead (3, manager), Head of Clinical (4, head), Director of Clinical (5, director), Chief Medical Officer (6, c-suite). Specialisations: Cardiologist, Genetic Counselor, Medical Coder, Medical Lab Technician, Nurse Practitioner, Occupational Therapist, Physical Therapist, Radiologic Technologist, Registered Nurse, Speech-Language Pathologist.",
  },
  {
    slug: "education",
    name: "Education",
    family: "education",
    description:
      "K-12 and higher-education educator track. Rungs: Teaching Assistant (0, ic-entry), Teacher (1, ic-mid), Senior Teacher / Department Lead (2, ic-senior), Head of Department (3, manager), Principal / Headteacher (4, head), Director of Education (5, director), Superintendent / Provost (6, vp), Chancellor (7, c-suite). Specialisations: Primary School Teacher, High School Teacher, Special Education Teacher, School Counselor, Instructional Designer, Education Consultant, Environmental Educator.",
  },
  {
    slug: "trades",
    name: "Skilled Trades",
    family: "trades",
    description:
      "Skilled-trades practitioner track. Rungs: Apprentice (0, ic-entry), Journeyman / Tradesperson (1, ic-mid), Senior Tradesperson / Foreman (2, ic-senior), Site Supervisor (3, manager), Site Manager (4, head), Project Director (5, director). Specialisations: Carpenter, Drywall Finisher, Electrician, Plumber, Welder, HVAC Technician, Heavy Equipment Operator.",
  },
  {
    slug: "creative",
    name: "Creative (Writing, Music, Visual Art)",
    family: "creative",
    description:
      "Independent creative and creative-services track. Rungs: Junior Creative (0, ic-entry), Creative — Copywriter / Designer / Editor / Artist (1, ic-mid), Senior Creative (2, ic-senior), Lead Creative (3, ic-senior), Creative Manager (4, manager), Head of Creative (5, head), Creative Director (6, director), Chief Creative Officer (7, c-suite). Specialisations: Copywriter, Grant Writer, Journalist, Art Director, Motion Designer, Production Designer, Audio Engineer, Video Editor, Influencer.",
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
