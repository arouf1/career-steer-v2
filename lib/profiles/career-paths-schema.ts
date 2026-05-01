import { z } from "zod";

const Severity = z.enum(["low", "medium", "high"]);

const SkillGap = z.object({
  skill: z.string(),
  severity: Severity,
});

export const CareerPathKind = z.enum([
  "linear",
  "adjacent",
  "transformational",
]);

export const CareerPathCandidateSchema = z.object({
  kind: CareerPathKind,
  targetRoleTitle: z.string(),
  targetFunctionalArea: z.string(),
  targetIndustry: z.string().nullable(),
  targetLevel: z.string(),
  syntheticJd: z.string(),
  rationale: z.string(),
  requiredSkills: z.array(z.string()),
  skillGaps: z.array(SkillGap),
  effortMonths: z.number(),
  confidence: z.number(),
});

export const CareerPathsResponseSchema = z.object({
  candidates: z.array(CareerPathCandidateSchema),
});

export type CareerPathCandidate = z.infer<typeof CareerPathCandidateSchema>;
export type CareerPathsResponse = z.infer<typeof CareerPathsResponseSchema>;
