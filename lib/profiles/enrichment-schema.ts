import { z } from "zod";

const FunctionalArea = z.enum([
  "engineering",
  "product",
  "design",
  "data",
  "sales",
  "marketing",
  "ops",
  "finance",
  "legal",
  "hr",
  "research",
  "exec",
  "other",
]);

const Archetype = z.enum([
  "founder",
  "builder",
  "scaler",
  "fixer",
  "integrator",
  "specialist",
  "generalist",
]);

const CareerStage = z.enum([
  "early-career",
  "mid-career",
  "senior-IC",
  "manager",
  "director",
  "exec",
  "transitioning",
]);

const CompanySize = z.enum([
  "solo",
  "startup-seed",
  "startup-growth",
  "scale-up",
  "enterprise",
  "unknown",
]);

const Motivation = z.enum([
  "impact",
  "growth",
  "craft",
  "autonomy",
  "financial",
  "mission",
  "mastery",
]);

const SkillCategory = z.enum([
  "technical",
  "leadership",
  "domain",
  "soft",
  "language",
  "tool",
]);

const ProficiencySignal = z.enum([
  "exposure",
  "working",
  "proficient",
  "expert",
]);

const RemoteSignal = z.enum([
  "onsite",
  "hybrid",
  "remote-friendly",
  "remote-only",
  "unknown",
]);

const CareerVelocity = z.enum(["slow", "steady", "fast", "very-fast"]);

const DegreeLevel = z.enum([
  "none",
  "certificate",
  "associate",
  "bachelor",
  "master",
  "mba",
  "phd",
  "other",
]);

const InstitutionType = z.enum([
  "university",
  "bootcamp",
  "online-platform",
  "k12",
  "other",
]);

const QuantifiedAchievement = z.object({
  verb: z.string(),
  metric: z.string().nullable(),
  delta: z.string().nullable(),
  scope: z.string().nullable(),
  evidenceQuote: z.string(),
});

const SeniorityLevel = z.object({
  track: z.enum(["ic", "manager", "exec"]),
  band: z.number(),
});

const EnrichedExperience = z.object({
  isoStart: z.string().nullable(),
  isoEnd: z.string().nullable(),
  isCurrent: z.boolean(),
  tenureMonths: z.number().nullable(),
  functionalArea: FunctionalArea,
  subFunction: z.string().nullable(),
  seniorityLevel: SeniorityLevel,
  industry: z.string().nullable(),
  companySizeSignal: CompanySize,
  roleArchetype: Archetype.nullable(),
  quantifiedAchievements: z.array(QuantifiedAchievement),
  scopeSignals: z.object({
    teamSizeLed: z.number().nullable(),
    budgetSignal: z.string().nullable(),
    geography: z.array(z.string()).nullable(),
  }),
  toolsUsed: z.array(z.string()),
  domainExpertise: z.array(z.string()),
});

const EnrichedSkill = z.object({
  raw: z.string(),
  canonical: z.string(),
  category: SkillCategory,
  yearsOfExperience: z.number().nullable(),
  lastUsedYear: z.number().nullable(),
  proficiencySignal: ProficiencySignal,
});

const EnrichedEducation = z.object({
  isoStart: z.string().nullable(),
  isoEnd: z.string().nullable(),
  degreeLevel: DegreeLevel,
  fieldNormalized: z.string().nullable(),
  institutionType: InstitutionType,
});

const Pivot = z.object({
  year: z.number().nullable(),
  kind: z.enum(["role", "function", "industry"]),
  deltaDescription: z.string(),
});

const MotivationEntry = z.object({
  kind: Motivation,
  evidenceQuote: z.string(),
});

const WorkStyleSignals = z.object({
  collaboration: z.enum(["ic", "hybrid", "team-lead"]),
  pace: z.enum(["deliberate", "fast"]),
  scope: z.enum(["depth", "breadth"]),
});

const TenureStats = z.object({
  avgMonths: z.number(),
  longestMonths: z.number(),
  shortestMonths: z.number(),
});

const CareerGap = z.object({
  startIso: z.string().nullable(),
  endIso: z.string().nullable(),
  durationMonths: z.number(),
  inferredReason: z.string().nullable(),
});

const GeographicMobility = z.object({
  cities: z.array(z.string()),
  countries: z.array(z.string()),
  remoteSignal: RemoteSignal,
});

export const ProfileEnrichmentSchema = z.object({
  careerStage: CareerStage.nullable(),
  careerArchetype: Archetype.nullable(),
  narrativeSummary: z.string().nullable(),
  motivations: z.array(MotivationEntry),
  workStyleSignals: WorkStyleSignals.nullable(),
  pivots: z.array(Pivot),

  enrichedExperience: z.array(EnrichedExperience),
  enrichedSkills: z.array(EnrichedSkill),
  enrichedEducation: z.array(EnrichedEducation),

  totalYearsExperience: z.number().nullable(),
  careerVelocity: CareerVelocity.nullable(),
  tenureStats: TenureStats.nullable(),
  careerGaps: z.array(CareerGap),
  geographicMobility: GeographicMobility.nullable(),
  languagesSpoken: z.array(z.string()),

  confidenceFlags: z.array(z.string()),
});

export type ProfileEnrichment = z.infer<typeof ProfileEnrichmentSchema>;
export type EnrichedExperienceEntry = z.infer<typeof EnrichedExperience>;
export type EnrichedSkillEntry = z.infer<typeof EnrichedSkill>;
export type EnrichedEducationEntry = z.infer<typeof EnrichedEducation>;
