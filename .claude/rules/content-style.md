# Content style — read before editing UI copy or AI prompts

career-steer-v2 is B2C. Voice and spelling consistency is part of trust. Two non-negotiables:

1. **No em-dashes (—) or en-dashes (–) in user-facing content or in AI prompts.**
2. **British English spelling throughout.**

These apply to every surface a user reads: career guides, job posting rewrites, UI strings, toast messages, error messages, podcast scripts, voice personas, advisor chat, outreach drafts, schema descriptions that surface to users.

## Source of truth

The shared prompt constant is `lib/ai/prompts/voice.ts`:

```ts
import { EDITORIAL_VOICE } from "./voice";

const systemPrompt = `${EDITORIAL_VOICE}

...rest of prompt...`;
```

Every prompt that produces user-facing text composes in `EDITORIAL_VOICE`. Do not duplicate the rules inline; do not omit them.

## Why em-dashes are out

- They read as AI-generated. The whole product is "AI career coach"; the moment the prose looks LLM-y, trust drops.
- They are easy for the model to overuse and easy for us to forbid. Costless rule, big payoff.
- The replacement is almost always cleaner: a period (sentence break), a colon (X: explanation), a comma (parenthetical), or a semicolon (linked clauses). Numeric ranges use a regular hyphen.

## Why British English

- Project brand voice (PRODUCT.md). Already implemented in voice personas (`compassAdviser.ts`, `voiceAdviser.ts`) and most career-guide prompts.
- Consistency: a single user must never see "personalised" in one paragraph and "personalization" in the next.
- The spellings to use: colour, favourite, organise, organisation, behaviour, analyse, centre (the noun; CSS classes like `text-center` stay American because they are framework identifiers), specialise, personalise, customise, recognise, summarise, standardise, maximise, minimise, categorise, prioritise, realise, emphasise, travelling, modelling, cancelled, labelled, defence, offence, grey (in prose; Tailwind `gray-*` classes stay American), theatre, judgement, enrol, enrolment, fulfil, fulfilment.

## Exemptions (these stay American or unchanged)

- **Framework / library / CSS-class identifiers.** Tailwind utilities (`text-center`, `bg-gray-100`, `transition-colors`), Web Audio (`AnalyserNode`), npm package names, JavaScript APIs.
- **Convex schema field names already in production.** `personalization`, `customizations`, etc. are stored field names and API contracts; renaming requires a migration. New schema fields should use British English where possible without breaking existing data.
- **Test fixtures (`*.test.ts`).** Mocked LLM outputs are static reference values; changing them invalidates the test's intent. Touch only when the test itself is being rewritten.
- **Generated code (`convex/_generated/**`).** Never edit by hand.
- **Developer-only code comments.** Lower priority. Clean up in passing if it costs nothing; do not run a separate sweep.

## Replacement cheatsheet

When removing em-dashes:

| Pattern | Replacement |
|---|---|
| `"role — explanation"` (clause join with appositive) | `"role: explanation"` (colon) |
| `"X — Y"` joining two main clauses | `"X. Y"` (period; capitalise Y) or `"X; Y"` (semicolon) |
| `"thing — parenthetical aside — more"` | `"thing, parenthetical aside, more"` (commas) or split into two sentences |
| `"— Author"` attribution | `"- Author"` (regular hyphen) or restructure |
| `"80–120 words"` numeric range (en-dash) | `"80-120 words"` (regular hyphen) |
| `"Refresh queued — give it about thirty seconds."` | `"Refresh queued. Give it about thirty seconds."` |

If a replacement reads awkwardly, rewrite the sentence rather than forcing the substitution.

## Standing reminders

- **Use `EDITORIAL_VOICE`.** New AI prompts compose it in. Existing prompts that have inline voice rules should be migrated to use the constant when touched.
- **Audit lever.** `rg -- '—|–' app components lib/ai/prompts` should return only test fixtures, schema field comments, and generated code. Anything else is a regression.
- **British English in prompt instructions and examples too.** The model imitates what it reads. Do not write "summarize the candidate" in an instruction string and expect British output.

## When in doubt

Read the file aloud. If a colon, comma, semicolon, or sentence break would do the same job as the em-dash, use it. If British spelling looks wrong because the surrounding identifier is American (a Tailwind class, a schema field), keep the identifier as-is and use British in the prose around it.
