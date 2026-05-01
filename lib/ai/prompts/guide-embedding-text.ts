// Mirrors lib/ai/prompts/embedding-text.ts but for the guide side. A guide
// gets four facet vectors so a user's profile facet can be matched directly
// against the corresponding guide facet (currentState↔currentState for
// "guides for who I am now", arc↔arc for "where I could go", etc.).
//
// Token budget per facet: Gemini Embedding 2 caps input at 8192 tokens.
// We aim for ≤6000 characters per facet so any single facet text stays well
// inside the limit even if every character is its own token.

const FACET_CHAR_BUDGET = 6000;

export type GuideRegion = {
  salary: {
    entry: string;
    mid: string;
    senior: string;
    note?: string;
  };
  careerOutlook: string;
  learningPath: string[];
  relatedRoles: string[];
};

export type GuideContent = {
  overview: string;
  typicalSkills: string[];
  dayToDay: string;
  riskFactors: string[];
  whyConsider: string;
  regional: {
    us: GuideRegion;
    uk: GuideRegion;
  };
};

export type GuideEmbeddingTexts = {
  whole: string;
  arc: string;
  currentState: string;
  domain: string;
};

const truncate = (text: string): string =>
  text.length <= FACET_CHAR_BUDGET ? text : text.slice(0, FACET_CHAR_BUDGET);

const joinNonEmpty = (parts: string[]): string =>
  parts.filter((p) => p.length > 0).join("\n\n");

const formatRegionOutlook = (label: string, region: GuideRegion): string => {
  const lines = [
    `${label} salary: ${region.salary.entry} → ${region.salary.mid} → ${region.salary.senior}`,
    `${label} outlook: ${region.careerOutlook}`,
  ];
  return lines.join("\n");
};

const buildWhole = (title: string, content: GuideContent): string => {
  const parts: string[] = [
    `Career: ${title}`,
    content.overview,
    `What the work looks like:\n${content.dayToDay}`,
    `Why someone considers this:\n${content.whyConsider}`,
    formatRegionOutlook("US", content.regional.us),
    formatRegionOutlook("UK", content.regional.uk),
  ];
  if (content.typicalSkills.length > 0) {
    parts.push(`Typical skills: ${content.typicalSkills.join(", ")}`);
  }
  if (content.riskFactors.length > 0) {
    parts.push(
      `Risks and tradeoffs:\n${content.riskFactors.map((r) => `• ${r}`).join("\n")}`,
    );
  }
  return truncate(joinNonEmpty(parts));
};

const buildArc = (title: string, content: GuideContent): string => {
  const usPath = content.regional.us.learningPath;
  const ukPath = content.regional.uk.learningPath;
  const related = Array.from(
    new Set([
      ...content.regional.us.relatedRoles,
      ...content.regional.uk.relatedRoles,
    ]),
  );

  const parts: string[] = [
    `Career trajectory for: ${title}`,
    `Salary arc (US): ${content.regional.us.salary.entry} → ${content.regional.us.salary.mid} → ${content.regional.us.salary.senior}`,
    `Salary arc (UK): ${content.regional.uk.salary.entry} → ${content.regional.uk.salary.mid} → ${content.regional.uk.salary.senior}`,
  ];
  if (usPath.length > 0) {
    parts.push(`Learning path (US):\n${usPath.map((s) => `• ${s}`).join("\n")}`);
  }
  if (ukPath.length > 0) {
    parts.push(`Learning path (UK):\n${ukPath.map((s) => `• ${s}`).join("\n")}`);
  }
  if (related.length > 0) {
    parts.push(`Adjacent and successor roles: ${related.join(", ")}`);
  }
  return truncate(joinNonEmpty(parts));
};

const buildCurrentState = (title: string, content: GuideContent): string => {
  const earlySteps = content.regional.us.learningPath.slice(0, 2);
  const parts: string[] = [
    `Day-to-day for someone currently in or entering: ${title}`,
    content.dayToDay,
    `Entry salary (US): ${content.regional.us.salary.entry}`,
    `Entry salary (UK): ${content.regional.uk.salary.entry}`,
  ];
  if (earlySteps.length > 0) {
    parts.push(
      `First steps in this career:\n${earlySteps.map((s) => `• ${s}`).join("\n")}`,
    );
  }
  if (content.typicalSkills.length > 0) {
    parts.push(
      `Skills relied on day-to-day: ${content.typicalSkills.slice(0, 12).join(", ")}`,
    );
  }
  return truncate(joinNonEmpty(parts));
};

const buildDomain = (title: string, content: GuideContent): string => {
  const related = Array.from(
    new Set([
      ...content.regional.us.relatedRoles,
      ...content.regional.uk.relatedRoles,
    ]),
  );
  const parts: string[] = [`Domain and skills for: ${title}`];
  if (content.typicalSkills.length > 0) {
    parts.push(`Skills: ${content.typicalSkills.join(", ")}`);
  }
  if (related.length > 0) {
    parts.push(`Skill-overlapping roles: ${related.join(", ")}`);
  }
  // Day-to-day reveals tooling/methods even when not in typicalSkills.
  parts.push(content.dayToDay);
  return truncate(joinNonEmpty(parts));
};

export const buildGuideEmbeddingTexts = (
  title: string,
  content: GuideContent,
): GuideEmbeddingTexts => ({
  whole: buildWhole(title, content),
  arc: buildArc(title, content),
  currentState: buildCurrentState(title, content),
  domain: buildDomain(title, content),
});
