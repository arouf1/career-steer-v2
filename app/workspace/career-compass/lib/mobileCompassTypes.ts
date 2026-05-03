// Shared types for the mobile Career Compass surface. Kept separate from the
// geometry helpers so client components can import only what they need.
import type { Id } from "@/convex/_generated/dataModel";

export type CompassLane =
  | "linear"
  | "adjacent"
  | "earlier"
  | "transformational";

export type CompassSlot = "strong" | "bridge" | "aspirational" | "extra";

export type CompassCard = {
  guideId: Id<"career_guides">;
  title: string;
  slug: string;
  slotKind: CompassSlot;
  whyMatchReason: string;
  arcScore: number;
  overview: string;
  typicalSkills: string[];
  lane: CompassLane;
};
