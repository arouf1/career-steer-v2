/**
 * Image prompt builder for career-guide hero illustrations.
 * Ported verbatim from career-steer v1 to preserve the visual series.
 * The prompt drives Gemini 2.5 Flash (image preview) via OpenRouter and
 * is paired with a base64 reference image (see imageReference.ts) so every
 * generated illustration matches the same style.
 */
export function constructImagePrompt({
  title,
  description,
}: {
  title: string;
  description: string;
}): string {
  return `
Create an editorial illustration for the career of "${title}".

Role context: "${description}"

CRITICAL — the objects in this illustration MUST be recognisable tools, equipment, and artefacts
that someone working as a "${title}" would actually use day-to-day. Think about what sits on their
desk, what software they use, what materials they handle, what environment they work in.
For example: a marketing manager might have campaign dashboards, megaphones, analytics charts;
a software engineer might have code editors, terminal windows, circuit boards, API diagrams.
The viewer should look at this image and immediately understand what career it represents.

Style direction:
- Contemporary editorial illustration, clean and modern
- The objects should be REAL and RECOGNISABLE (not random geometric shapes) but rendered in a stylised, illustrative way
- Flat colour blocks with smooth finishes
- Muted, warm colour palette: burnt orange, deep teal, cream, olive, dusty rose, warm brown
- Strong use of negative space and deliberate, balanced composition
- No photorealism — everything should feel hand-illustrated and polished

Composition:
- Arrange 3–5 career-specific objects in a still-life composition — tools of the trade for a ${title}
- Objects should be arranged at interesting angles and scales, some overlapping, creating visual depth
- Use bold colour planes as backgrounds (split backgrounds, geometric backdrops)
- Include subtle line work or annotations that give it a diagrammatic, educational quality
- The overall feel should be like a thoughtful poster — the viewer should think "that's a ${title}'s world"

Do NOT include any people, faces, or human figures. Focus purely on objects and tools.
Do NOT include any text, logos, or wordmarks.
Create this in a 16:9 aspect ratio.
  `.trim();
}
