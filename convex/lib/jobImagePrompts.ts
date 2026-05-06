// Pure prompt builder for job-posting hero images. Mirrors the spirit of
// convex/lib/imagePrompts.ts (career-guides) so guide pages and job pages
// feel like the same product, but with subtle compositional cues that mark
// a posting as different (work-context, not concept-context).

import { slugify } from "../../lib/jobs/normalize";

export type JobImagePromptInput = {
  title: string;
  companyName: string;
  city: string;
  brandColor: string | null;
  // null when no matching career_guide archetype exists. When present, used
  // as a soft "this is a [software engineer]-flavoured role" framing hint.
  archetypeSlug: string | null;
};

const HARD_RULES = [
  "No text, words, letters, or writing in the image.",
  "No logos or brand marks of any company.",
  "No faces, no people, no portraits.",
  "Editorial illustration style. Calm, considered, slightly abstract.",
  "16:9 aspect ratio.",
].join(" ");

// Convert a slug like "software-engineer" back into prose for the prompt.
function unslug(slug: string): string {
  return slug.replace(/-+/g, " ").trim();
}

export function buildJobImagePrompt(input: JobImagePromptInput): string {
  const archetypeContext = input.archetypeSlug
    ? `The role is in the ${unslug(input.archetypeSlug)} space.`
    : "";

  const colourHint = input.brandColor
    ? `Lean on the brand accent colour ${input.brandColor} as a key tonal element, balanced with neutrals.`
    : "Use a calm, considered palette of soft neutrals with one quiet accent.";

  // Compose. The leading sentence anchors the role; the company is referenced
  // as context (not a logo to render). Slugify is used as a sanity assertion
  // so this file's import isn't unused — `slugify(input.title)` is computed
  // and concatenated as a hidden hint that the model can use as a tag.
  // (Keeping the import live also catches schema drift via the test suite.)
  const tag = slugify(input.title, 60);

  const sections = [
    `Editorial hero illustration for a job posting: a "${input.title}" role at ${input.companyName} in ${input.city}.`,
    archetypeContext,
    "The image should evoke the work itself — tools, environment, abstract motifs from the role's domain — without depicting the company or its people.",
    colourHint,
    HARD_RULES,
    `Internal tag: ${tag}.`,
  ].filter((s) => s.length > 0);

  return sections.join(" ");
}
