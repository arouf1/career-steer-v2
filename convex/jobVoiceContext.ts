/**
 * Pure helpers for the per-job-posting voice assistant ("Talk through this
 * role"). Mirrors voiceCallContext.ts (per-guide) and compassVoiceContext.ts
 *, no Convex APIs imported, unit-testable, called from convex/jobVoice.ts
 * after the loader has pulled the necessary documents through ctx.db.
 */

import type { Doc } from "./_generated/dataModel";
// The per-guide profile snapshot builder is the right shape for jobs too -
// candidate name, narrative, top skills, motivations, work-style. Re-export
// so jobVoiceNode.ts only has one helper module to import from.
export { buildProfileSnapshotForVoice } from "./voiceCallContext";

const MAX_CITATIONS_FOR_PROMPT = 10;

// ── Job snapshot ──────────────────────────────────────────────────────────

export type JobSnapshotForVoice = {
  title: string;
  companyName: string;
  location: string;
  workFromHome: boolean;
  schedule?: string;
  postedAt?: string;
  salary?: string;
  hasApplyLink: boolean;
  // Enriched prose. Each field may be empty if the rewrite hasn't landed
  // yet, but the loader gates on contentStatus === "complete" so by the
  // time this is built, the fields are populated.
  overview: string;
  theRole: string;
  whatStandsOut: string[];
  idealCandidate: string;
  compSummary: string | null;
};

export function buildJobSnapshotForVoice(args: {
  posting: Doc<"job_postings">;
  company: Doc<"companies">;
}): JobSnapshotForVoice | null {
  const { posting, company } = args;
  if (!posting.content) return null;
  const ext = posting.detectedExtensions;
  return {
    title: posting.title,
    companyName: company.nameRaw,
    location: posting.location,
    workFromHome: ext?.workFromHome ?? false,
    schedule: ext?.schedule,
    postedAt: ext?.postedAt,
    salary: ext?.salary,
    hasApplyLink: posting.applyLink != null && posting.isActive !== false,
    overview: posting.content.overview,
    theRole: posting.content.theRole,
    whatStandsOut: posting.content.whatStandsOut,
    idealCandidate: posting.content.idealCandidate,
    compSummary: posting.content.compSummary,
  };
}

// ── Company context ───────────────────────────────────────────────────────

export type CompanyContextForVoice = {
  name: string;
  domain: string | null;
  brandColor: string | null;
  // Per-company research. null if not yet run, "pending" / "generating" /
  // "failed", or "complete" with prose. The prompt builder reads these to
  // either ground claims or warn the model that research is still loading.
  researchStatus: "missing" | "pending" | "generating" | "failed" | "complete";
  culture: string | null;
  financials: string | null;
  // Per-(company, role-archetype) research. Same status semantics as above.
  // "missing" when the posting has no roleArchetypeSlug, the page can't
  // synthesise role-specific research without a canonical role anchor.
  roleResearchStatus:
    | "missing"
    | "pending"
    | "generating"
    | "failed"
    | "complete";
  interview: string | null;
  compensation: string | null;
};

export function buildCompanyContextForVoice(args: {
  company: Doc<"companies">;
  companyResearch: Doc<"company_research"> | null;
  companyRoleResearch: Doc<"company_role_research"> | null;
  hasRoleArchetype: boolean;
}): CompanyContextForVoice {
  const { company, companyResearch, companyRoleResearch, hasRoleArchetype } =
    args;

  const researchStatus: CompanyContextForVoice["researchStatus"] =
    companyResearch == null ? "missing" : companyResearch.status;

  const roleResearchStatus: CompanyContextForVoice["roleResearchStatus"] =
    !hasRoleArchetype
      ? "missing"
      : companyRoleResearch == null
        ? "missing"
        : companyRoleResearch.status;

  return {
    name: company.nameRaw,
    domain: company.domain ?? null,
    brandColor: company.brandColor ?? null,
    researchStatus,
    culture:
      companyResearch?.status === "complete" ? (companyResearch.culture ?? null) : null,
    financials:
      companyResearch?.status === "complete"
        ? (companyResearch.financials ?? null)
        : null,
    roleResearchStatus,
    interview:
      companyRoleResearch?.status === "complete"
        ? (companyRoleResearch.interview ?? null)
        : null,
    compensation:
      companyRoleResearch?.status === "complete"
        ? (companyRoleResearch.compensation ?? null)
        : null,
  };
}

// ── Fit narrative (cosine sim across 4 facets) ────────────────────────────

export type FitNarrativeForVoice = {
  // Each facet score is cosine similarity in [-1, 1]; the embedding model
  // outputs unit-normalised vectors so this is a straight dot product.
  // Historically the values land in roughly [0.4, 0.95] for any pair; the
  // adviser uses the *relative* shape (which facet is high vs low) more than
  // the absolute number, so the prompt translates them to a qualitative
  // headline.
  wholeScore: number;
  arcScore: number;
  currentStateScore: number;
  domainScore: number;
  // Pre-computed anchors the adviser can drop into the conversation without
  // having to read a number aloud. Examples:
  //   "current-state strong", they can do this work tomorrow
  //   "arc lower than current-state", sideways move rather than stepping up
  //   "domain weak", would need a real reskilling effort
  headline: string;
  anchorPoints: string[];
};

type Vec = ReadonlyArray<number>;

function cosineSim(a: Vec, b: Vec): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

export function buildFitNarrativeForVoice(args: {
  jobEmbeddings: Doc<"job_posting_embeddings"> | null;
  profileEmbeddings: Doc<"profile_embeddings"> | null;
}): FitNarrativeForVoice | null {
  const { jobEmbeddings, profileEmbeddings } = args;
  if (!jobEmbeddings || !profileEmbeddings) return null;

  const wholeScore = cosineSim(
    profileEmbeddings.wholeVector,
    jobEmbeddings.wholeVector,
  );
  const arcScore = cosineSim(
    profileEmbeddings.arcVector,
    jobEmbeddings.arcVector,
  );
  const currentStateScore = cosineSim(
    profileEmbeddings.currentStateVector,
    jobEmbeddings.currentStateVector,
  );
  const domainScore = cosineSim(
    profileEmbeddings.domainVector,
    jobEmbeddings.domainVector,
  );

  const anchorPoints: string[] = [];
  const STRONG = 0.78;
  const WEAK = 0.6;

  if (currentStateScore >= STRONG) {
    anchorPoints.push("Their current-state fit is strong, they can do this work today.");
  } else if (currentStateScore < WEAK) {
    anchorPoints.push("Their current-state fit is weak, significant ramp-up needed.");
  }

  if (arcScore >= STRONG) {
    anchorPoints.push("This role is on the arc they've been building toward.");
  } else if (arcScore < WEAK) {
    anchorPoints.push("This role sits off their stated trajectory, worth checking why it appeals.");
  }

  if (currentStateScore - arcScore >= 0.1) {
    anchorPoints.push("Sideways move: they could do the work tomorrow, but it's not stepping up.");
  } else if (arcScore - currentStateScore >= 0.1) {
    anchorPoints.push("Stretch role: aligned with where they're headed but they'll need to grow into it.");
  }

  if (domainScore < WEAK) {
    anchorPoints.push("Domain overlap is light, probable real reskilling effort.");
  } else if (domainScore >= STRONG) {
    anchorPoints.push("Their technical domain matches well.");
  }

  let headline: string;
  if (wholeScore >= STRONG) {
    headline = "Strong overall fit";
  } else if (wholeScore >= WEAK) {
    headline = "Worth-exploring fit, some gaps";
  } else {
    headline = "Stretch fit, significant gaps";
  }

  return {
    wholeScore,
    arcScore,
    currentStateScore,
    domainScore,
    headline,
    anchorPoints,
  };
}

// ── Citations ─────────────────────────────────────────────────────────────

type Citation = {
  url: string;
  title: string;
  publisher?: string;
  fetchedAt: number;
};

type AggregatedCitation = {
  url: string;
  title: string;
  publisher?: string;
  sectionPath: string;
};

/**
 * Flatten citations from companyResearch (culture/financials), companyRole-
 * Research (interview/compensation), and the linked career_guide (typical
 * skills, day-to-day, etc.) into one deduplicated list. Same shape as
 * aggregateGuideCitations, recency-sorted, capped at MAX_CITATIONS_FOR_PROMPT.
 */
export function aggregateJobCitations(args: {
  companyResearch: Doc<"company_research"> | null;
  companyRoleResearch: Doc<"company_role_research"> | null;
  linkedGuide: Doc<"career_guides"> | null;
}): AggregatedCitation[] {
  const seen = new Map<string, AggregatedCitation & { fetchedAt: number }>();

  const addOne = (c: Citation | undefined, sectionPath: string): void => {
    if (!c?.url) return;
    const existing = seen.get(c.url);
    if (!existing || c.fetchedAt > existing.fetchedAt) {
      seen.set(c.url, {
        url: c.url,
        title: c.title,
        publisher: c.publisher,
        sectionPath,
        fetchedAt: c.fetchedAt,
      });
    }
  };

  const cr = args.companyResearch;
  if (cr?.citations) {
    for (const [field, list] of Object.entries(cr.citations)) {
      for (const c of list) addOne(c, `company.${field}`);
    }
  }

  const crr = args.companyRoleResearch;
  if (crr?.citations) {
    for (const [field, list] of Object.entries(crr.citations)) {
      for (const c of list) addOne(c, `role.${field}`);
    }
  }

  const guide = args.linkedGuide;
  if (guide?.citations) {
    for (const [path, list] of Object.entries(guide.citations)) {
      for (const c of list) addOne(c, `guide.${guide.slug}::${path}`);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
    .slice(0, MAX_CITATIONS_FOR_PROMPT)
    .map(({ fetchedAt: _f, ...rest }) => rest);
}
