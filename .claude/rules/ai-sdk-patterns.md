---
name: AI SDK patterns (career-steer-v2)
description: Read before editing AI features. AI SDK v6, OpenRouter via the gateway pattern, Exa for retrieval, stream where the UX benefits.
appliesTo: app/api/chat/**, app/api/ai/**, lib/ai/**, lib/server/ai/**
---

# AI SDK patterns — read before editing AI features

## Source of truth

- **Vercel AI SDK is the abstraction.** All LLM calls go through `ai` (and `@ai-sdk/*` provider packages). No direct OpenAI / Anthropic SDK usage.
- **OpenRouter is the provider.** Configured via the AI SDK + AI Gateway pattern — single API key, model fallback, observability. Do not hard-code provider-specific URLs.
- **Exa is the retrieval layer.** All web search / company / role lookups go through Exa. No raw `fetch` to job boards or scraped sources.

## Critical: docs first

Training-data knowledge of the AI SDK is **stale**. v6 changed return shapes and introduced new helpers. **Before writing any AI code, invoke `vercel-plugin:ai-sdk` or read https://sdk.vercel.ai/docs.** Do not pattern-match from memory.

## Non-negotiables

- **Stream where the user is waiting.** Coaching chat, resume review feedback, interview-prep responses → `streamText` with progressive UI. Background or batch jobs (resume parsing, embedding, scoring) → `generateText` / `generateObject`, no streaming.
- **`generateObject` for structured output.** When the LLM is producing JSON the app will parse — match scores, skill taxonomies, structured plans — use `generateObject` with a Zod schema. Never `JSON.parse` an LLM string response and hope.
- **Tool calls only when the tool actually exists.** No "imaginary" tools defined just for prompting. Each tool has a real implementation; the model can call it.
- **System prompts live in code, not in env vars.** `lib/ai/prompts/*.ts`. Versioned with the code that uses them.
- **Token budgets per surface.** Coaching chat: cap at 4k input tokens (truncate long histories with summarization). Resume review: cap at 8k input. Embeddings: per-document, no batching across users.
- **Cost guardrails.** Server-side rate limit per user per AI surface (use Convex to count). Display "thinking…" UI but kill any single request > 30s.

## Standing reminders

- **Tracing.** AI Gateway gives you observability — use it. Log model, latency, token count, and final outcome to the dashboard, not to ad-hoc Convex tables.
- **Privacy.** Resume content / chat history are sensitive. Don't pass to a model with logging unless the user opted in. OpenRouter / Vercel AI Gateway support zero-data-retention modes — use them.
- **Versions.** `npm view ai version`, `npm view @ai-sdk/openai version`, `npm view exa-js version` before installing. The AI SDK ships frequently.

## When in doubt

Invoke `vercel-plugin:ai-sdk` for SDK questions, `vercel-plugin:ai-gateway` for routing/fallback, or `vercel-plugin:ai-architect` for architectural decisions (agent vs. workflow vs. simple completion).
