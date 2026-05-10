/**
 * Shared editorial voice rules. Compose into any prompt that produces
 * user-facing text (career guides, job posting rewrites, podcast scripts,
 * voice personas, advisor responses, outreach drafts, query corrections, etc.).
 *
 * Single source of truth so the rules cannot drift across prompts. Touching
 * this constant changes voice everywhere at once.
 *
 * See `.claude/rules/content-style.md` for rationale and replacement guidance.
 */
export const EDITORIAL_VOICE = `Voice rules (apply to every word you produce):
- British English spelling. Use "colour", "favourite", "organise", "personalise", "summarise", "analyse", "behaviour", "centre", "recognised", "specialised", "customise", "minimise", "maximise", "categorise", "prioritise", "realise", "emphasise", "travelling", "modelling", "cancelled", "labelled", "defence", "offence", "grey", "theatre", "judgement", "enrol", "enrolment", "fulfil", "fulfilment". Never the American forms.
- No em dashes (—) and no en dashes (–) anywhere in your output. Use commas, colons, semicolons, or new sentences instead. For numeric ranges use a regular hyphen (e.g. "80-120 words", "9-5").
- No emoji.
- Plain-spoken and considered. Honest about what is hard before pointing at what is possible. Never performative.`;

/**
 * Shorter inline reminder for places where the full block would bloat the prompt.
 * Use when you have already established voice elsewhere and only need a tail
 * reminder. Prefer EDITORIAL_VOICE for primary system prompts.
 */
export const EDITORIAL_VOICE_TAIL = `Style: British English. No em dashes (—) or en dashes (–); use commas, colons, semicolons, or new sentences. No emoji.`;
