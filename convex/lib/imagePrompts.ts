/**
 * Image prompt builder for career-guide illustrations.
 *
 * Every slot renders in the same editorial flat-illustration style -
 * clean colour planes, hard edges, diagrammatic line work, no
 * photorealism, no painterly washes. The hero is a tools-of-the-trade
 * still life; the section slots rotate composition + figure-presence to
 * give the series variety while keeping a single visual identity. The
 * shared palette + 16:9 + reference image carry cohesion across the set.
 */

export type SectionSlot =
  | "day-to-day"
  | "outlook"
  | "learning-path"
  | "risks";

export type ImageSlot = "hero" | SectionSlot;

export const SECTION_SLOTS: ReadonlyArray<SectionSlot> = [
  "day-to-day",
  "outlook",
  "learning-path",
  "risks",
];

// Universal, applied to every slot.
const SHARED_PALETTE_AND_TEXT = `
Palette and notation:
- Muted, warm colour palette: burnt orange, deep teal, cream, olive, dusty rose, warm brown
- Diagrammatic notation IS permitted: mathematical symbols, equation fragments, chart axes, scientific glyphs, abstract annotation marks, line work. These add authenticity and educational character.
- DO NOT include any English words, brand names, logos, readable signage, captions, or proper nouns. No legible labels like the career name, "Risk", "Pro", product names, or made-up brand text.
- If the model cannot tell whether something would render as English text, omit it.
`.trim();

// Default rendering, subtly anime / Japanese editorial illustration.
// NOT pure flat blocks (which tips into Western cartoon look) and NOT
// painterly Ghibli washes, sits between, with subtle texture and gentle
// volume. This is what produces the "ever so slightly anime" feel the
// hero and other section illustrations already have.
const DEFAULT_RENDERING = `
Rendering style, contemporary editorial illustration with a subtly anime feel:
- Aim for contemporary editorial Japanese illustration aesthetic, manga editorial spread / anime background painting feel. NOT Western animated TV cartoon style. NOT painterly watercolor. NOT 3D-rendered. NOT photorealism.
- Objects are REAL and RECOGNISABLE, rendered with gentle volume and SUBTLE internal shading. NOT pure flat colour blocks, the surfaces should have a quiet sense of light and form, like a paper-grain or pencil-shaded illustration
- Soft, hand-drawn outlines where present, OR no outlines at all. NEVER thick bold black outlines around objects or figures. If outlines appear, they should be coloured, soft pencil-like, or barely-there, never the heavy uniform black-line treatment of Western animated TV shows
- Muted, slightly desaturated warm palette, keep colours low-key and earthy. Never punchy, never cartoon-saturated.
- Bold colour planes as backgrounds (split backgrounds, geometric backdrops) but rendered with subtle texture or grain rather than glossy flat fills
- Subtle line work or diagrammatic annotations are encouraged for educational quality
- Strong negative space, deliberate balanced composition; hand-illustrated and polished
- Anti-pattern check: if the result looks like an American animated TV show with thick black outlines and bright saturated colours, it is wrong. The aesthetic target is quiet, observed, slightly anime-influenced editorial illustration.
`.trim();

// Default figure rules, used when a slot allows figures and doesn't
// override. Anime-editorial figure rendering, NOT Western-cartoon and
// NOT photorealistic.
const DEFAULT_FIGURE_RULES = `
Figure rules, soft anime-editorial figure:
- Render the figure in the same subtly anime / Japanese editorial illustration style as the rest of the scene, gentle volume, soft internal shading, soft / no outlines
- Hair, skin, and clothing rendered as soft colour shapes with quiet internal shading. NOT pure flat blocks; NOT cartoon-bright; NOT photorealistic
- ABSOLUTELY NO thick black outlines around the figure. No bright saturated cartoon-character colours.
- Show figures only from behind, as silhouettes, or in three-quarter from behind. NEVER a front-facing or near-front portrait
- Faces are not visible (back of head only, or face turned fully away). No facial features, no detailed eyes/nose/mouth
- Maximum 30% of frame width. Figures are part of the scene, not its subject, the objects and environment carry equal weight
- If a figure cannot be rendered without thick outlines or cartoon-saturation, OMIT the figure and imply human presence through objects only
`.trim();

const SHARED_HARD_RULES = `Create this in a 16:9 aspect ratio.`;

function compositionFor(slot: ImageSlot, title: string): {
  composition: string;
  allowsFigures: boolean;
  noFigureLine: string | null;
  renderingOverride?: string;
  figureRulesOverride?: string;
} {
  switch (slot) {
    case "hero":
      return {
        composition: `
Composition, tools of the trade:
- Arrange 3-5 career-specific objects in a still-life composition, what sits on a ${title}'s desk, what software they use, what materials they handle
- Objects at interesting angles and scales, some overlapping, creating visual depth
- The overall feel should be like a thoughtful poster, the viewer should think "that's a ${title}'s world"
        `.trim(),
        allowsFigures: false,
        noFigureLine:
          "Do NOT include any people, faces, or human figures. Focus purely on objects and tools.",
      };

    case "day-to-day":
      return {
        composition: `
Composition, a working scene mid-shift:
- A ${title}'s actual working environment caught mid-task, the desk, bench, lab, studio, or wherever the work really happens
- Anchor the composition with 3-4 in-use objects rendered in the same subtly-anime editorial style as the rest of the series: an open notebook with annotation marks, a tool or instrument set down mid-use, a half-drunk drink, papers or a screen showing diagrammatic content
- Use bold colour planes for the room or surface, split backgrounds, geometric backdrops in the warm earth palette (a wall as one colour plane, a desk as another, a window as a third)
- Optional: a window showing simplified outdoor shapes (rooftops as soft colour blocks, trees as gentle shapes, a distant chart-like skyline)
- Place ONE figure within the scene per the figure rules below, over-the-shoulder or three-quarter from behind, NEVER front-facing
- The image MUST sit at home next to the hero illustration, same palette, same subtle texture and gentle shading, same soft (not bold) outline treatment. If it ends up looking like a Western animated TV cartoon (bold black outlines, saturated colours), it is WRONG.
        `.trim(),
        allowsFigures: true,
        noFigureLine: null,
      };

    case "outlook":
      return {
        composition: `
Composition, a forward-looking metaphor:
- Compose a forward-looking scene: a horizon line splitting the frame, a compass laid open, a telescope on a stand, a chart shape rising into the background as a colour plane
- Include 3-4 supporting objects relevant to a ${title}'s field that hint at where the work is heading (a folder labelled by shape only, an instrument pointed forward, a stack of upward-trending bars formed from colour blocks)
- Place ONE small stylised figure looking outward toward the horizon, silhouette only, no detail, no larger than 20% of the frame
- The figure is a graphic mark, not a portrait
        `.trim(),
        allowsFigures: true,
        noFigureLine: null,
      };

    case "learning-path":
      return {
        composition: `
Composition, a sparse, diagrammatic path:
- Compose a SINGLE curving path made of colour planes that crosses the frame from lower-left to upper-right. The path is the structural spine of the image.
- Place EXACTLY 3 staged objects along the path, no more, no fewer:
  - One early-stage object (smaller, near the start of the path), a beginner's tool of the trade for a ${title}
  - One mid-stage object (medium, mid-path), a working tool of an established ${title}
  - One mastery-stage object (largest, near the end), a tool or artefact only a senior/expert ${title} would handle
- Each of the 3 objects MUST be specific to a ${title}'s actual learning journey. Do not fall back on generic books, glasses, certificates, or office props unless those genuinely belong to a ${title}'s craft.
- Generous negative space between stages. The path and its three objects are the ENTIRE composition, do not pack other props into the empty areas.
- Optional: subtle line marks or arrow flourishes connecting the stages, in the same flat illustration style.
        `.trim(),
        allowsFigures: false,
        noFigureLine:
          "Do NOT include any people, faces, or human figures. The path and its three staged objects are the entire composition.",
      };

    case "risks":
      return {
        composition: `
Composition, a weighing or measuring still life:
- Compose a weighing/measuring scene: a brass scale with mismatched pans, an hourglass mid-fall, a fork in a road built from colour planes, an unsteady stack of objects, a balance about to tip
- Include 2-3 ${title}-specific objects that hint at the trade-offs of the work
- Use a quieter, more restrained version of the palette, less burnt orange, more olive and warm brown
- The composition should feel measured and deliberate, not alarming
        `.trim(),
        allowsFigures: false,
        noFigureLine:
          "Do NOT include any people, faces, or human figures. The objects do the work.",
      };
  }
}

export function constructImagePrompt({
  title,
  description,
  slot = "hero",
}: {
  title: string;
  description: string;
  slot?: ImageSlot;
}): string {
  const {
    composition,
    allowsFigures,
    noFigureLine,
    renderingOverride,
    figureRulesOverride,
  } = compositionFor(slot, title);

  const intro =
    slot === "hero"
      ? `Create an editorial illustration for the career of "${title}".`
      : `Create an editorial illustration for the "${slot}" section of a career guide on "${title}". This is part of a flat-illustration series, it must read as the same visual world as the hero illustration for this guide, with the same crisp colour planes and flat rendering style.`;

  const rendering = renderingOverride ?? DEFAULT_RENDERING;
  const figureBlock = allowsFigures
    ? (figureRulesOverride ?? DEFAULT_FIGURE_RULES)
    : (noFigureLine ?? "");

  return [
    intro,
    "",
    `Role context: "${description}"`,
    "",
    "CRITICAL, the objects in this illustration MUST be recognisable tools, equipment, and artefacts that someone working as a \"" +
      title +
      "\" would actually use day-to-day. The viewer should look at this image and immediately understand what career it represents.",
    "",
    SHARED_PALETTE_AND_TEXT,
    "",
    rendering,
    "",
    composition,
    "",
    figureBlock,
    "",
    SHARED_HARD_RULES,
  ]
    .filter((s) => s.length > 0)
    .join("\n")
    .trim();
}
