---
name: AI SDK patterns (career-steer-v2)
description: Read before editing AI features. AI SDK v6, OpenRouter as the unified provider for chat + embeddings + rerank, Exa for retrieval, stream where the UX benefits.
appliesTo: app/api/chat/**, app/api/ai/**, lib/ai/**, lib/server/ai/**, convex/**
---

# AI SDK patterns — read before editing AI features

## Source of truth

- **Vercel AI SDK is the abstraction for chat.** All LLM completion calls go through `ai` + `@openrouter/ai-sdk-provider`. No direct OpenAI / Anthropic SDK usage.
- **OpenRouter is the unified provider for *all three* AI surfaces in this project: chat, embeddings, and rerank.** Single API key (`OPENROUTER_API_KEY`), single billing surface, single observability dashboard. Do not add `@ai-sdk/google`, `@ai-sdk/cohere`, `cohere-ai`, or other direct-provider SDKs for these surfaces.
- **Exa is the retrieval layer.** All web search / company / role lookups go through Exa. No raw `fetch` to job boards or scraped sources.

## Use the central helpers

`lib/ai/providers.ts` exposes three helpers — use these, do not re-roll the API calls:

- `chatModel(modelId, { zdr })` — returns an OpenRouter chat model for `generateText`/`streamText`. ZDR (`provider: { zdr: true }`) on by default.
- `embed(input, opts)` and `embedBatch(inputs, opts)` — POST to `https://openrouter.ai/api/v1/embeddings`. Default model `google/gemini-embedding-2-preview`, default `output_dimensionality: 1536` (MRL-truncated). Each input has an optional `taskHint` (e.g. `"retrieval document"`, `"retrieval query"`) which is prefixed onto the text.
- `rerank({ query, documents, topN })` — POST to `https://openrouter.ai/api/v1/rerank`. Default model `cohere/rerank-4-pro`. Returns `Array<{ index, relevanceScore, document }>`.

### Why raw fetch for embeddings and rerank instead of AI SDK primitives

- **Embeddings:** `@openrouter/ai-sdk-provider` does expose `.textEmbeddingModel()` and that works with the SDK's `embed()` / `embedMany()`, but its `OpenRouterEmbeddingSettings` type does not expose `output_dimensionality` or task hints. Raw fetch lets us pass MRL truncation and Gemini-2 task instructions cleanly. The shape matches the OpenRouter-published API exactly, so it stays portable if we ever swap.
- **Rerank:** AI SDK v6 has a `rerank()` primitive but it requires a provider that exposes `.reranking()`. OpenRouter's provider does not. Raw fetch to OpenRouter's `/rerank` endpoint with `model: "cohere/rerank-4-pro"` body is the canonical path.

## Critical: docs first

Training-data knowledge of the AI SDK is **stale**. v6 changed return shapes, deprecated `generateObject`/`streamObject` in favour of `generateText`/`streamText` with `output: Output.object({ schema })`, and added `rerank()`. **Before writing any AI code, invoke `vercel-plugin:ai-sdk` or read `node_modules/ai/docs/`.** Do not pattern-match from memory.

## Non-negotiables

- **Stream where the user is waiting.** Coaching chat, resume review feedback, interview-prep responses → `streamText` with progressive UI. Background or batch jobs (resume parsing, profile enrichment, embedding, career-path generation) → `generateText` with `Output.object({ schema })`, no streaming.
- **Structured output via `Output.object({ schema })`.** When the LLM is producing JSON the app will parse — extracted profiles, enrichment payloads, candidate next-roles — use `generateText` + `Output.object` with a Zod schema. `generateObject` is deprecated in v6. Never `JSON.parse` an LLM string response and hope.
- **Tool calls only when the tool actually exists.** No "imaginary" tools defined just for prompting. Each tool has a real implementation; the model can call it.
- **System prompts live in code, not in env vars.** `lib/ai/prompts/*.ts`. Versioned with the code that uses them.
- **Token budgets per surface.** Coaching chat: cap at 4k input tokens (truncate long histories with summarization). Resume review / enrichment: cap at 60k characters. Embeddings: per-string, no batching across users.
- **Cost guardrails.** Server-side rate limit per user per AI surface (use Convex to count). Display "thinking…" UI but kill any single request via `AbortController` after 60-90s depending on surface.

## Standing reminders

- **ZDR by default.** `chatModel()` enables `provider: { zdr: true }` by default. Don't disable unless you have a specific reason.
- **Privacy.** Resume content / chat history are sensitive. The default ZDR routing handles this; never log raw resume text or chat history to Convex tables or external dashboards.
- **Versions.** `npm view ai version`, `npm view @openrouter/ai-sdk-provider version`, `npm view exa-js version` before installing. The AI SDK ships frequently.

## TTS is the one explicit exception

Podcast audio for career guides is generated via Google's Gemini 3.1 Flash TTS through the `@google/genai` SDK directly, using `GEMINI_API_KEY`. OpenRouter does not expose a TTS surface, so a fourth modality cannot be funnelled through the same provider. Helper code lives in `convex/podcastsTts.ts` (Node runtime, `"use node"` directive) and `lib/podcast/`. Do **not** extend this exception to chat, embeddings, or rerank — those stay on OpenRouter so the rule remains "OpenRouter for everything except TTS, which is Gemini direct."

## When in doubt

Invoke `vercel-plugin:ai-sdk` for SDK questions, or `vercel-plugin:ai-architect` for architectural decisions (agent vs. workflow vs. simple completion). **Do not** invoke `vercel-plugin:ai-gateway` — that is Vercel's gateway product, not OpenRouter; this project uses OpenRouter exclusively.
