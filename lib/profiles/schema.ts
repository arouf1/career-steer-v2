import { z } from "zod";

const ExperienceEntry = z.strictObject({
  title: z.string().min(1),
  company: z.string().min(1),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

const EducationEntry = z.strictObject({
  school: z.string().min(1),
  degree: z.string().nullable().optional(),
  field: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const ProfileSchema = z.strictObject({
  name: z.string().nullable(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  location: z.string().nullable(),
  experience: z.array(ExperienceEntry),
  education: z.array(EducationEntry),
  skills: z.array(z.string()),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ExperienceEntry = z.infer<typeof ExperienceEntry>;
export type EducationEntry = z.infer<typeof EducationEntry>;
