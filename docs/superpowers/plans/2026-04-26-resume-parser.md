# Resume Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship resume upload + AI parse → Convex `profiles` table, with edit/review UI, behind Clerk auth, in a single user-visible feature on `/profile`.

**Architecture:** Browser extracts text from PDF/DOCX (lazy-loaded `pdfjs-dist` + `mammoth`), sends to a Convex action. Action calls OpenRouter via `generateText({ output: Output.object({ schema }) })`, validates against a shared Zod `ProfileSchema`, upserts a single row per user keyed on `userId`. UI subscribes via `useQuery(api.profiles.current)` and offers an editable review pass before downstream features consume the profile.

**Tech Stack:** Next.js 16 (App Router) · Convex 1.36 · Clerk · Vercel AI SDK 6 + `@openrouter/ai-sdk-provider` · Zod 4 · `pdfjs-dist` + `mammoth` (browser text extraction) · `react-hook-form` + `@hookform/resolvers` (review form) · `convex-test` + `vitest` (integration tests).

**Spec:** [`docs/superpowers/specs/2026-04-26-resume-parser-design.md`](../specs/2026-04-26-resume-parser-design.md)

**PRODUCT.md / DESIGN.md** are the source of truth for voice and visual primitives.

---

## File structure

| File | Purpose | Status |
|---|---|---|
| `lib/profiles/schema.ts` | Shared Zod `ProfileSchema` + inferred `Profile` type. Used by Convex action (`Output.object`) and review form (validation). Pure, no client/server-only imports. | new |
| `lib/profiles/schema.test.ts` | Zod round-trip tests | new |
| `lib/client/extract-text.ts` | Browser-side text extraction wrappers (PDF via `pdfjs-dist`, DOCX via `mammoth`). Lazy-loaded by `UploadCard`. | new |
| `lib/client/extract-text.test.ts` | Extraction wrapper tests with mocked `File` inputs | new |
| `convex/schema.ts` | Add `profiles` table | modify |
| `convex/profiles.ts` | `current` query, `parseUpload` action, `update`/`markReviewed`/`clear` mutations, `upsert` internal mutation | new |
| `convex/profiles.test.ts` | Convex action integration tests with stubbed OpenRouter | new |
| `app/profile/page.tsx` | Profile route — upload card or profile view | new |
| `components/profile/UploadCard.tsx` | Drag-drop upload, validates + extracts + calls action | new |
| `components/profile/ProfileView.tsx` | Read-only structured display | new |
| `components/profile/ProfileEditForm.tsx` | Controlled form with `react-hook-form` + zod resolver | new |
| `components/profile/ReviewCallout.tsx` | "Here's what we noticed" callout, hidden after `reviewed === true` | new |
| `app/page.tsx` | Tiny copy update — drop "image screenshots" mention; LinkedIn placeholder stays | modify |
| `vitest.config.ts` | Test runner config | new |

---

## Pre-flight: branch + worktree (optional but recommended)

The repo currently has substantial uncommitted work (PRODUCT.md, DESIGN.md, home-page redesign). Before starting, decide whether to:

- **(a)** Commit current state on `main`, then implement directly on `main`.
- **(b)** Commit current state on `main`, branch off into a worktree (`git worktree add ../career-steer-v2-resume-parser feature/resume-parser`), implement there. Cleaner blast radius.

Option (a) is fine for solo work. Option (b) is safer if the user keeps experimenting in parallel.

---

## Task 1: Verify package versions and install new dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify latest published versions against the npm registry**

Run (single command — captures all of them):

```bash
for pkg in pdfjs-dist mammoth react-hook-form @hookform/resolvers vitest convex-test; do
  printf "%-30s %s\n" "$pkg" "$(npm view "$pkg" version)"
done
```

Expected: each prints a current version. Record the values; pin exactly when installing.

- [ ] **Step 2: Install runtime deps**

```bash
pnpm add pdfjs-dist@<latest> mammoth@<latest> react-hook-form@<latest> @hookform/resolvers@<latest>
```

Replace `<latest>` with the values printed in Step 1.

- [ ] **Step 3: Install dev deps**

```bash
pnpm add -D vitest@<latest> convex-test@<latest>
```

- [ ] **Step 4: Add test scripts to `package.json`**

In `package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(deps): add pdfjs-dist, mammoth, react-hook-form, vitest, convex-test"
```

---

## Task 2: Configure vitest

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 2: Verify vitest can run with no tests yet**

```bash
pnpm test
```

Expected: exits 0 with "No test files found, exiting with code 0" (or similar).

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "feat(test): add vitest config"
```

---

## Task 3: Run `/impeccable shape` to produce the UX brief

**Files:**
- Create: `docs/superpowers/shapes/resume-upload-+-review-flow.md` (whatever path the skill chooses)

- [ ] **Step 1: Run the shape command**

In the Claude Code prompt:

```
/impeccable shape resume-upload-+-review-flow
```

Follow the interactive prompts. The output is a brief that grounds component composition in `DESIGN.md`.

- [ ] **Step 2: Save and commit the brief**

The skill writes a markdown file. Verify it landed somewhere under `docs/` or project root. Commit:

```bash
git add docs/superpowers/shapes/  # or whatever path
git commit -m "docs(shape): UX brief for resume upload + review flow"
```

The downstream UI tasks (10-14) consult this brief.

---

## Task 4: `lib/profiles/schema.ts` — Zod ProfileSchema with tests

**Files:**
- Create: `lib/profiles/schema.ts`
- Create: `lib/profiles/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/profiles/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ProfileSchema, type Profile } from "./schema";

describe("ProfileSchema", () => {
  it("parses a fully populated profile", () => {
    const input: Profile = {
      name: "Aqil Rouf",
      headline: "Career coach",
      summary: "Builds AI tools.",
      location: "London, UK",
      experience: [{
        title: "Engineer",
        company: "Acme",
        startDate: "Jan 2022",
        endDate: null,
        description: "Built things.",
      }],
      education: [{
        school: "Oxford",
        degree: "BSc",
        field: "CS",
        startDate: "2014",
        endDate: "2018",
      }],
      skills: ["TypeScript", "Convex"],
    };
    expect(ProfileSchema.parse(input)).toEqual(input);
  });

  it("allows null/missing optional fields", () => {
    const input = {
      name: null,
      headline: null,
      summary: null,
      location: null,
      experience: [],
      education: [],
      skills: [],
    };
    expect(() => ProfileSchema.parse(input)).not.toThrow();
  });

  it("requires title and company on experience entries", () => {
    expect(() =>
      ProfileSchema.parse({
        name: null, headline: null, summary: null, location: null,
        experience: [{ title: "", company: "" }],
        education: [], skills: [],
      })
    ).toThrow();
  });

  it("rejects extra unknown fields", () => {
    expect(() =>
      ProfileSchema.parse({
        name: null, headline: null, summary: null, location: null,
        experience: [], education: [], skills: [],
        extra: "nope",
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test lib/profiles/schema.test.ts
```

Expected: FAIL — `ProfileSchema` not defined.

- [ ] **Step 3: Implement `lib/profiles/schema.ts`**

Create `lib/profiles/schema.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test lib/profiles/schema.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/profiles/
git commit -m "feat(profiles): zod ProfileSchema with round-trip tests"
```

---

## Task 5: Add `profiles` table to Convex schema

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Update `convex/schema.ts`**

Open `convex/schema.ts` and add `profiles` next to `users`:

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  profiles: defineTable({
    userId: v.id("users"),
    sourceFormat: v.union(v.literal("pdf"), v.literal("docx")),
    rawText: v.string(),
    parsedAt: v.number(),
    reviewed: v.boolean(),
    rateLimit: v.object({
      countInWindow: v.number(),
      windowStartedAt: v.number(),
    }),
    name: v.optional(v.string()),
    headline: v.optional(v.string()),
    summary: v.optional(v.string()),
    location: v.optional(v.string()),
    experience: v.array(v.object({
      title: v.string(),
      company: v.string(),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      description: v.optional(v.string()),
    })),
    education: v.array(v.object({
      school: v.string(),
      degree: v.optional(v.string()),
      field: v.optional(v.string()),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
    })),
    skills: v.array(v.string()),
  }).index("by_userId", ["userId"]),
});
```

- [ ] **Step 2: Push to Convex**

```bash
npx convex dev --once
```

Expected: "Convex functions ready!" with no schema errors.

- [ ] **Step 3: Verify table appears in dashboard**

Run:

```bash
npx convex dashboard
```

Confirm `profiles` table is visible (will be empty).

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): add profiles table"
```

---

## Task 6: Set OPENROUTER_API_KEY on Convex deployment

**Files:** none

- [ ] **Step 1: Read the local key without echoing it, set on Convex**

```bash
KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2-)
[ -z "$KEY" ] && { echo "OPENROUTER_API_KEY missing from .env.local"; exit 1; }
npx convex env set OPENROUTER_API_KEY "$KEY"
unset KEY
```

- [ ] **Step 2: Verify it's set (without echoing the value)**

```bash
npx convex env list | grep -c OPENROUTER_API_KEY
```

Expected: `1`

- [ ] **Step 3: No commit (env-only change)**

---

## Task 7: `convex/profiles.ts` — `current` query

**Files:**
- Create: `convex/profiles.ts`

- [ ] **Step 1: Implement `current` query**

Create `convex/profiles.ts`:

```ts
import { query } from "./_generated/server";

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return null;

    return await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
  },
});
```

- [ ] **Step 2: Push to Convex and verify it parses**

```bash
npx convex dev --once
```

Expected: "Convex functions ready!"

- [ ] **Step 3: Commit**

```bash
git add convex/profiles.ts
git commit -m "feat(profiles): add current() query"
```

---

## Task 8: `convex/profiles.ts` — `upsert` internal mutation

**Files:**
- Modify: `convex/profiles.ts`

- [ ] **Step 1: Add `upsert` internal mutation**

Append to `convex/profiles.ts`:

```ts
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const upsert = internalMutation({
  args: {
    userId: v.id("users"),
    sourceFormat: v.union(v.literal("pdf"), v.literal("docx")),
    rawText: v.string(),
    parsedAt: v.number(),
    rateLimit: v.object({
      countInWindow: v.number(),
      windowStartedAt: v.number(),
    }),
    name: v.optional(v.string()),
    headline: v.optional(v.string()),
    summary: v.optional(v.string()),
    location: v.optional(v.string()),
    experience: v.array(v.object({
      title: v.string(),
      company: v.string(),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      description: v.optional(v.string()),
    })),
    education: v.array(v.object({
      school: v.string(),
      degree: v.optional(v.string()),
      field: v.optional(v.string()),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
    })),
    skills: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      await ctx.db.replace(existing._id, { ...args, reviewed: false });
      return existing._id;
    }
    return await ctx.db.insert("profiles", { ...args, reviewed: false });
  },
});
```

- [ ] **Step 2: Push and verify**

```bash
npx convex dev --once
```

Expected: ready, no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/profiles.ts
git commit -m "feat(profiles): add upsert internal mutation"
```

---

## Task 9: `convex/profiles.ts` — `parseUpload` action

**Files:**
- Modify: `convex/profiles.ts`
- Reference: `lib/profiles/schema.ts`

- [ ] **Step 1: Look up the current best OpenRouter model for structured extraction**

```bash
curl -s 'https://openrouter.ai/api/v1/models' \
  | jq -r '.data[] | select(.id | startswith("anthropic/claude")) | .id' \
  | sort -V | tail -10
```

Expected: a list of recent Claude IDs. Pick the highest-version Haiku-family model (cheap+fast for structured extraction). Record the chosen model ID — it goes in the action below.

- [ ] **Step 2: Look up OpenRouter zero-data-retention header**

```bash
curl -s 'https://openrouter.ai/docs/features/privacy-and-logging.md' 2>/dev/null \
  | grep -iE 'header|x-|privacy|do.not' | head -20
```

If that doesn't surface anything, fetch `https://openrouter.ai/docs/features/privacy-and-logging` via `WebFetch` to confirm the current header name (commonly `X-OR-Privacy: do_not_train` or similar). Record it.

- [ ] **Step 3: Add `parseUpload` action**

Append to `convex/profiles.ts`:

```ts
import { action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { ProfileSchema } from "../lib/profiles/schema";

const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PARSES_PER_WINDOW = 5;
const MAX_TEXT_LENGTH = 200_000;
const MODEL_ID = "<model id from Step 1>";

const SYSTEM_PROMPT = `You are a résumé parser. Extract structured data from the provided résumé text. Use null for missing fields. Do not invent details. Return only fields in the schema.`;

export const parseUpload = action({
  args: {
    text: v.string(),
    sourceFormat: v.union(v.literal("pdf"), v.literal("docx")),
  },
  handler: async (ctx, args): Promise<
    | { ok: true }
    | { ok: false; error: "TEXT_TOO_LONG" | "RATE_LIMIT" | "PARSE_FAILED" }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    if (args.text.length > MAX_TEXT_LENGTH) {
      return { ok: false, error: "TEXT_TOO_LONG" };
    }

    // Ensure user record exists
    const userId = await ctx.runMutation(api.users.store, {});

    // Rate limit
    const existing = await ctx.runQuery(api.profiles.current, {});
    const now = Date.now();
    let rateLimit;
    if (existing?.rateLimit) {
      if (now - existing.rateLimit.windowStartedAt > RATE_WINDOW_MS) {
        rateLimit = { countInWindow: 1, windowStartedAt: now };
      } else if (existing.rateLimit.countInWindow >= MAX_PARSES_PER_WINDOW) {
        return { ok: false, error: "RATE_LIMIT" };
      } else {
        rateLimit = {
          countInWindow: existing.rateLimit.countInWindow + 1,
          windowStartedAt: existing.rateLimit.windowStartedAt,
        };
      }
    } else {
      rateLimit = { countInWindow: 1, windowStartedAt: now };
    }

    // OpenRouter call (ZDR header verified at write-time per Step 2)
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY!,
      headers: {
        // exact header from Step 2:
        "X-OR-Privacy": "do_not_train",
      },
    });

    let parsed;
    try {
      const { output } = await generateText({
        model: openrouter.chat(MODEL_ID),
        output: Output.object({ schema: ProfileSchema }),
        system: SYSTEM_PROMPT,
        prompt: args.text,
      });
      parsed = output;
    } catch (e) {
      console.error("parseUpload:openrouter_failed", { textLength: args.text.length });
      return { ok: false, error: "PARSE_FAILED" };
    }

    await ctx.runMutation(internal.profiles.upsert, {
      userId,
      sourceFormat: args.sourceFormat,
      rawText: args.text,
      parsedAt: now,
      rateLimit,
      ...parsed,
    });

    return { ok: true };
  },
});
```

- [ ] **Step 4: Push and verify it compiles**

```bash
npx convex dev --once
```

Expected: ready, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add convex/profiles.ts
git commit -m "feat(profiles): add parseUpload action with rate limiting"
```

---

## Task 10: `convex/profiles.ts` — `update`, `markReviewed`, `clear` mutations

**Files:**
- Modify: `convex/profiles.ts`

- [ ] **Step 1: Add the three mutations**

Append to `convex/profiles.ts`:

```ts
import { mutation } from "./_generated/server";

const userOwnedProfile = async (ctx: any) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q: any) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) throw new Error("User record missing");
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
    .unique();
  if (!profile) throw new Error("No profile yet");
  return profile;
};

const ProfilePatch = v.object({
  name: v.optional(v.union(v.string(), v.null())),
  headline: v.optional(v.union(v.string(), v.null())),
  summary: v.optional(v.union(v.string(), v.null())),
  location: v.optional(v.union(v.string(), v.null())),
  experience: v.optional(v.array(v.object({
    title: v.string(),
    company: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    description: v.optional(v.string()),
  }))),
  education: v.optional(v.array(v.object({
    school: v.string(),
    degree: v.optional(v.string()),
    field: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  }))),
  skills: v.optional(v.array(v.string())),
});

export const update = mutation({
  args: { patch: ProfilePatch },
  handler: async (ctx, args) => {
    const profile = await userOwnedProfile(ctx);
    await ctx.db.patch(profile._id, args.patch);
  },
});

export const markReviewed = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await userOwnedProfile(ctx);
    await ctx.db.patch(profile._id, { reviewed: true });
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await userOwnedProfile(ctx);
    await ctx.db.delete(profile._id);
  },
});
```

- [ ] **Step 2: Push and verify**

```bash
npx convex dev --once
```

Expected: ready, no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/profiles.ts
git commit -m "feat(profiles): add update, markReviewed, clear mutations"
```

---

## Task 11: Convex action integration test with stubbed OpenRouter

**Files:**
- Create: `convex/profiles.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `convex/profiles.test.ts`:

```ts
import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

// Mock the AI SDK call so we don't hit OpenRouter
vi.mock("ai", async () => {
  const actual = await vi.importActual<any>("ai");
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
      output: {
        name: "Test User",
        headline: "Engineer",
        summary: null,
        location: null,
        experience: [],
        education: [],
        skills: ["TypeScript"],
      },
    }),
  };
});

describe("profiles.parseUpload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema);
    await expect(
      t.action(api.profiles.parseUpload, { text: "hi", sourceFormat: "pdf" }),
    ).rejects.toThrow(/Not authenticated/);
  });

  it("upserts a profile on first parse", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({ tokenIdentifier: "user|123", email: "a@b.co" });
    const result = await asUser.action(api.profiles.parseUpload, {
      text: "Some résumé text",
      sourceFormat: "pdf",
    });
    expect(result).toEqual({ ok: true });

    const profile = await asUser.query(api.profiles.current, {});
    expect(profile?.name).toBe("Test User");
    expect(profile?.skills).toEqual(["TypeScript"]);
    expect(profile?.rateLimit.countInWindow).toBe(1);
  });

  it("rejects text > 200_000 chars", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({ tokenIdentifier: "user|123", email: "a@b.co" });
    const result = await asUser.action(api.profiles.parseUpload, {
      text: "x".repeat(200_001),
      sourceFormat: "pdf",
    });
    expect(result).toEqual({ ok: false, error: "TEXT_TOO_LONG" });
  });

  it("blocks the 6th parse in a 24h window", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({ tokenIdentifier: "user|123", email: "a@b.co" });
    for (let i = 0; i < 5; i++) {
      const r = await asUser.action(api.profiles.parseUpload, { text: "ok", sourceFormat: "pdf" });
      expect(r).toEqual({ ok: true });
    }
    const r6 = await asUser.action(api.profiles.parseUpload, { text: "ok", sourceFormat: "pdf" });
    expect(r6).toEqual({ ok: false, error: "RATE_LIMIT" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail or pass as expected**

```bash
pnpm test convex/profiles.test.ts
```

Expected: at least the auth-rejection test passes. Others may need iteration on the action — fix until all pass.

- [ ] **Step 3: Commit**

```bash
git add convex/profiles.test.ts
git commit -m "test(profiles): action integration tests with stubbed OpenRouter"
```

---

## Task 12: `lib/client/extract-text.ts` — text extraction wrappers

**Files:**
- Create: `lib/client/extract-text.ts`
- Create: `lib/client/extract-text.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/client/extract-text.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { extractText, MAX_FILE_SIZE_BYTES } from "./extract-text";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({
          items: [{ str: "Hello PDF" }],
        }),
      }),
    }),
  }),
  GlobalWorkerOptions: { workerSrc: "" },
}));

vi.mock("mammoth/mammoth.browser", () => ({
  default: { extractRawText: vi.fn().mockResolvedValue({ value: "Hello DOCX" }) },
}));

const makeFile = (name: string, type: string, sizeBytes = 100) =>
  new File([new Uint8Array(sizeBytes)], name, { type });

describe("extractText", () => {
  it("extracts PDF text", async () => {
    const file = makeFile("a.pdf", "application/pdf");
    const result = await extractText(file);
    expect(result).toEqual({ ok: true, text: "Hello PDF", sourceFormat: "pdf" });
  });

  it("extracts DOCX text", async () => {
    const file = makeFile("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const result = await extractText(file);
    expect(result).toEqual({ ok: true, text: "Hello DOCX", sourceFormat: "docx" });
  });

  it("rejects unsupported types", async () => {
    const file = makeFile("a.png", "image/png");
    const result = await extractText(file);
    expect(result).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
  });

  it("rejects files over the size cap", async () => {
    const file = makeFile("a.pdf", "application/pdf", MAX_FILE_SIZE_BYTES + 1);
    const result = await extractText(file);
    expect(result).toEqual({ ok: false, error: "TOO_LARGE" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test lib/client/extract-text.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/client/extract-text.ts`**

Create `lib/client/extract-text.ts`:

```ts
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export type ExtractResult =
  | { ok: true; text: string; sourceFormat: "pdf" | "docx" }
  | { ok: false; error: "UNSUPPORTED_TYPE" | "TOO_LARGE" | "EXTRACTION_FAILED" };

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function extractText(file: File): Promise<ExtractResult> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: "TOO_LARGE" };
  }
  if (file.type === PDF_MIME || file.name.toLowerCase().endsWith(".pdf")) {
    return extractPdf(file);
  }
  if (file.type === DOCX_MIME || file.name.toLowerCase().endsWith(".docx")) {
    return extractDocx(file);
  }
  return { ok: false, error: "UNSUPPORTED_TYPE" };
}

async function extractPdf(file: File): Promise<ExtractResult> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error — worker URL provided by Next bundler
    pdfjs.GlobalWorkerOptions.workerSrc = (await import(
      "pdfjs-dist/legacy/build/pdf.worker.mjs?url"
    )).default;
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out.push(content.items.map((it: any) => it.str).join(" "));
    }
    return { ok: true, text: out.join("\n").trim(), sourceFormat: "pdf" };
  } catch {
    return { ok: false, error: "EXTRACTION_FAILED" };
  }
}

async function extractDocx(file: File): Promise<ExtractResult> {
  try {
    const mammoth = (await import("mammoth/mammoth.browser")).default;
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return { ok: true, text: result.value.trim(), sourceFormat: "docx" };
  } catch {
    return { ok: false, error: "EXTRACTION_FAILED" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test lib/client/extract-text.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/client/
git commit -m "feat(profiles): client-side PDF/DOCX text extraction"
```

---

## Task 13: `<ReviewCallout/>` component

**Files:**
- Create: `components/profile/ReviewCallout.tsx`

- [ ] **Step 1: Implement per the `/impeccable shape` brief**

Create `components/profile/ReviewCallout.tsx`. Follow the brief from Task 3 — exact composition (which DESIGN.md primitives, which copy variant) is dictated by that brief, not pre-specified here. Skeleton:

```tsx
"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

type Props = {
  fieldCount: number;
  onEdit: () => void;
  onReupload: () => void;
};

export function ReviewCallout({ fieldCount, onEdit, onReupload }: Props) {
  const markReviewed = useMutation(api.profiles.markReviewed);

  return (
    <section
      role="region"
      aria-label="Review your résumé"
      className="rounded-card border border-hairline bg-paper-raised p-6 sm:p-8"
    >
      <h2 className="type-headline text-ink">
        Here's what we noticed in your résumé.
      </h2>
      <p className="type-body text-body mt-4 max-w-prose">
        We extracted {fieldCount} fields. Tell us what we got wrong before they
        flow into your coaching.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => markReviewed({})}
          className="type-label rounded-pill bg-ink px-5 py-2.5 text-paper transition-colors hover:bg-ink-deep"
        >
          Looks right
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="type-label rounded-pill border border-hairline-strong px-5 py-2.5 text-ink transition-colors hover:border-ink"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onReupload}
          className="type-label text-mute transition-colors hover:text-ink"
        >
          Re-upload
        </button>
      </div>
    </section>
  );
}
```

If the `/impeccable shape` brief calls for different copy or composition, follow the brief.

- [ ] **Step 2: Verify it imports cleanly**

```bash
pnpm typecheck
```

Expected: no errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add components/profile/ReviewCallout.tsx
git commit -m "feat(profiles): ReviewCallout component"
```

---

## Task 14: `<UploadCard/>` component

**Files:**
- Create: `components/profile/UploadCard.tsx`

- [ ] **Step 1: Implement**

Create `components/profile/UploadCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { FileText, IdCard, UploadCloud } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { extractText, MAX_FILE_SIZE_BYTES } from "@/lib/client/extract-text";

type Status =
  | { kind: "idle" }
  | { kind: "extracting" }
  | { kind: "parsing" }
  | { kind: "error"; message: string };

const ERROR_COPY: Record<string, string> = {
  UNSUPPORTED_TYPE: "We can read PDF and DOCX. Try one of those.",
  TOO_LARGE: `That file's a bit large. Try a copy under ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
  EXTRACTION_FAILED:
    "We couldn't read this file. It might be a scan — try exporting a fresh PDF.",
  TEXT_TOO_LONG:
    "Your résumé is unusually long. Trim to the highlights and try again.",
  RATE_LIMIT:
    "You've parsed five résumés today. Take a breath; tomorrow we'll be ready again.",
  PARSE_FAILED:
    "Something on our side gave up. Try again — or wait a moment if it keeps happening.",
};

export function UploadCard() {
  const parseUpload = useAction(api.profiles.parseUpload);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onFile(file: File) {
    setStatus({ kind: "extracting" });
    const extracted = await extractText(file);
    if (!extracted.ok) {
      setStatus({ kind: "error", message: ERROR_COPY[extracted.error] ?? "Couldn't read that file." });
      return;
    }
    setStatus({ kind: "parsing" });
    const result = await parseUpload({
      text: extracted.text,
      sourceFormat: extracted.sourceFormat,
    });
    if (!result.ok) {
      setStatus({ kind: "error", message: ERROR_COPY[result.error] ?? "Something went wrong." });
      return;
    }
    setStatus({ kind: "idle" });
  }

  return (
    <article className="w-full rounded-card border border-hairline bg-paper-raised p-6 sm:p-8">
      <div className="mb-8 inline-flex w-full items-center gap-1 rounded-pill border border-hairline bg-paper p-1">
        <span className="type-label inline-flex flex-1 items-center justify-center gap-2 rounded-pill bg-paper-raised px-4 py-2.5 text-ink">
          <FileText className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          Upload CV
        </span>
        <span
          aria-disabled="true"
          className="type-label inline-flex flex-1 items-center justify-center gap-2 rounded-pill px-4 py-2.5 text-mute opacity-60"
          title="Coming soon"
        >
          <IdCard className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          LinkedIn
        </span>
      </div>

      <label
        htmlFor="resume-upload"
        className="block cursor-pointer rounded-card border border-dashed border-hairline-strong bg-paper px-6 py-12 text-center transition-colors hover:border-ink"
      >
        <UploadCloud className="mx-auto mb-4 h-8 w-8 text-mute" aria-hidden="true" strokeWidth={1.25} />
        <h3 className="type-title text-ink">CV or career profile</h3>
        <p className="type-body mt-2 max-w-sm mx-auto text-body">
          {status.kind === "extracting" ? "Reading your résumé…" :
           status.kind === "parsing" ? "Thinking about what we read. About ten seconds." :
           "Drop your résumé here and we'll explore what's possible."}
        </p>
        <p className="type-caption mt-6 text-mute">Supports PDF and DOCX.</p>
        <input
          id="resume-upload"
          type="file"
          accept=".pdf,.docx"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
          disabled={status.kind === "extracting" || status.kind === "parsing"}
        />
      </label>

      {status.kind === "error" && (
        <p role="alert" className="type-body mt-4 text-state-error">
          {status.message}
        </p>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/profile/UploadCard.tsx
git commit -m "feat(profiles): UploadCard component with PDF/DOCX upload"
```

---

## Task 15: `<ProfileView/>` component

**Files:**
- Create: `components/profile/ProfileView.tsx`

- [ ] **Step 1: Implement**

Create `components/profile/ProfileView.tsx`:

```tsx
"use client";

import { Pencil } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

type Props = {
  profile: Doc<"profiles">;
  onEdit: () => void;
};

export function ProfileView({ profile, onEdit }: Props) {
  return (
    <article className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        {profile.name && <h1 className="type-display text-ink">{profile.name}</h1>}
        {profile.headline && <p className="type-body-lg text-body">{profile.headline}</p>}
        {profile.location && <p className="type-caption text-mute">{profile.location}</p>}
        <div>
          <button
            type="button"
            onClick={onEdit}
            className="type-label inline-flex items-center gap-2 self-start rounded-pill border border-hairline-strong px-5 py-2 text-ink transition-colors hover:border-ink"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
            Edit profile
          </button>
        </div>
      </header>

      {profile.summary && (
        <section>
          <h2 className="type-label text-mute uppercase tracking-wider">Summary</h2>
          <p className="type-body-lg text-body mt-4 max-w-prose">{profile.summary}</p>
        </section>
      )}

      {profile.experience.length > 0 && (
        <section>
          <h2 className="type-label text-mute uppercase tracking-wider">Experience</h2>
          <ul className="mt-4 flex flex-col gap-8">
            {profile.experience.map((e, i) => (
              <li key={i} className="flex flex-col gap-2">
                <p className="type-title text-ink">{e.title}<span className="text-body"> · {e.company}</span></p>
                {(e.startDate || e.endDate) && (
                  <p className="type-caption text-mute">
                    {e.startDate ?? "—"} – {e.endDate ?? "Present"}
                  </p>
                )}
                {e.description && <p className="type-body text-body max-w-prose">{e.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.education.length > 0 && (
        <section>
          <h2 className="type-label text-mute uppercase tracking-wider">Education</h2>
          <ul className="mt-4 flex flex-col gap-6">
            {profile.education.map((e, i) => (
              <li key={i} className="flex flex-col gap-1">
                <p className="type-title text-ink">{e.school}</p>
                {(e.degree || e.field) && (
                  <p className="type-body text-body">{[e.degree, e.field].filter(Boolean).join(", ")}</p>
                )}
                {(e.startDate || e.endDate) && (
                  <p className="type-caption text-mute">{e.startDate ?? "—"} – {e.endDate ?? "—"}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.skills.length > 0 && (
        <section>
          <h2 className="type-label text-mute uppercase tracking-wider">Skills</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {profile.skills.map((s) => (
              <li key={s} className="type-caption rounded-pill border border-hairline bg-paper px-3 py-1 text-body">
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/profile/ProfileView.tsx
git commit -m "feat(profiles): ProfileView read-only display"
```

---

## Task 16: `<ProfileEditForm/>` component

**Files:**
- Create: `components/profile/ProfileEditForm.tsx`

- [ ] **Step 1: Implement using react-hook-form + zod resolver**

Create `components/profile/ProfileEditForm.tsx`:

```tsx
"use client";

import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ProfileSchema, type Profile } from "@/lib/profiles/schema";
import type { Doc } from "@/convex/_generated/dataModel";

type Props = { profile: Doc<"profiles">; onDone: () => void };

export function ProfileEditForm({ profile, onDone }: Props) {
  const update = useMutation(api.profiles.update);
  const markReviewed = useMutation(api.profiles.markReviewed);

  const form = useForm<Profile>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: {
      name: profile.name ?? null,
      headline: profile.headline ?? null,
      summary: profile.summary ?? null,
      location: profile.location ?? null,
      experience: profile.experience,
      education: profile.education,
      skills: profile.skills,
    },
  });

  const expArray = useFieldArray({ control: form.control, name: "experience" });
  const eduArray = useFieldArray({ control: form.control, name: "education" });

  const onSubmit = form.handleSubmit(async (values) => {
    await update({ patch: values });
    await markReviewed({});
    onDone();
  });

  const inputCls =
    "w-full rounded-control border border-hairline bg-paper px-4 py-3 type-body text-ink placeholder:text-mute focus:border-ink focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-10">
      <fieldset className="flex flex-col gap-4">
        <legend className="type-label text-mute uppercase tracking-wider mb-2">About you</legend>
        <input className={inputCls} placeholder="Name" {...form.register("name")} />
        <input className={inputCls} placeholder="Headline" {...form.register("headline")} />
        <input className={inputCls} placeholder="Location" {...form.register("location")} />
        <textarea className={inputCls} rows={4} placeholder="Summary" {...form.register("summary")} />
      </fieldset>

      <fieldset>
        <legend className="type-label text-mute uppercase tracking-wider mb-4">Experience</legend>
        <ul className="flex flex-col gap-6">
          {expArray.fields.map((field, i) => (
            <li key={field.id} className="flex flex-col gap-3 rounded-card border border-hairline bg-paper p-4">
              <input className={inputCls} placeholder="Title" {...form.register(`experience.${i}.title`)} />
              <input className={inputCls} placeholder="Company" {...form.register(`experience.${i}.company`)} />
              <div className="grid grid-cols-2 gap-3">
                <input className={inputCls} placeholder="Start date" {...form.register(`experience.${i}.startDate`)} />
                <input className={inputCls} placeholder="End date (or 'Present')" {...form.register(`experience.${i}.endDate`)} />
              </div>
              <textarea className={inputCls} rows={3} placeholder="Description" {...form.register(`experience.${i}.description`)} />
              <button type="button" onClick={() => expArray.remove(i)} className="type-label inline-flex items-center gap-2 self-end text-mute hover:text-state-error">
                <Trash2 className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} /> Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => expArray.append({ title: "", company: "", startDate: null, endDate: null, description: null })}
          className="type-label mt-4 inline-flex items-center gap-2 rounded-pill border border-hairline-strong px-5 py-2 text-ink transition-colors hover:border-ink"
        >
          <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} /> Add role
        </button>
      </fieldset>

      <fieldset>
        <legend className="type-label text-mute uppercase tracking-wider mb-4">Education</legend>
        <ul className="flex flex-col gap-6">
          {eduArray.fields.map((field, i) => (
            <li key={field.id} className="flex flex-col gap-3 rounded-card border border-hairline bg-paper p-4">
              <input className={inputCls} placeholder="School" {...form.register(`education.${i}.school`)} />
              <input className={inputCls} placeholder="Degree" {...form.register(`education.${i}.degree`)} />
              <input className={inputCls} placeholder="Field" {...form.register(`education.${i}.field`)} />
              <div className="grid grid-cols-2 gap-3">
                <input className={inputCls} placeholder="Start date" {...form.register(`education.${i}.startDate`)} />
                <input className={inputCls} placeholder="End date" {...form.register(`education.${i}.endDate`)} />
              </div>
              <button type="button" onClick={() => eduArray.remove(i)} className="type-label inline-flex items-center gap-2 self-end text-mute hover:text-state-error">
                <Trash2 className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} /> Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => eduArray.append({ school: "", degree: null, field: null, startDate: null, endDate: null })}
          className="type-label mt-4 inline-flex items-center gap-2 rounded-pill border border-hairline-strong px-5 py-2 text-ink transition-colors hover:border-ink"
        >
          <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} /> Add education
        </button>
      </fieldset>

      <fieldset>
        <legend className="type-label text-mute uppercase tracking-wider mb-4">Skills</legend>
        <textarea
          className={inputCls}
          rows={3}
          placeholder="Comma-separated"
          defaultValue={profile.skills.join(", ")}
          onBlur={(e) => form.setValue("skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        />
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="type-label rounded-pill bg-ink px-6 py-3 text-paper transition-colors hover:bg-ink-deep"
          disabled={form.formState.isSubmitting}
        >
          Save and mark reviewed
        </button>
        <button type="button" onClick={onDone} className="type-label text-mute hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/profile/ProfileEditForm.tsx
git commit -m "feat(profiles): ProfileEditForm with react-hook-form + zod"
```

---

## Task 17: `app/profile/page.tsx` — wire it all together

**Files:**
- Create: `app/profile/page.tsx`

- [ ] **Step 1: Implement**

Create `app/profile/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { SignInButton } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { SiteNav } from "@/components/site/SiteNav";
import { UploadCard } from "@/components/profile/UploadCard";
import { ProfileView } from "@/components/profile/ProfileView";
import { ProfileEditForm } from "@/components/profile/ProfileEditForm";
import { ReviewCallout } from "@/components/profile/ReviewCallout";

export default function ProfilePage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-3xl px-6 py-12 md:py-20">
        <AuthLoading>
          <p className="type-body text-mute">Loading…</p>
        </AuthLoading>
        <Unauthenticated>
          <div className="flex flex-col gap-6">
            <h1 className="type-headline text-ink">Sign in to start.</h1>
            <p className="type-body text-body max-w-prose">
              Your profile is the foundation. Sign in and we'll get you reading your résumé in seconds.
            </p>
            <SignInButton mode="modal">
              <button className="type-label self-start rounded-pill bg-ink px-6 py-3 text-paper transition-colors hover:bg-ink-deep">
                Sign in
              </button>
            </SignInButton>
          </div>
        </Unauthenticated>
        <Authenticated>
          <ProfileShell />
        </Authenticated>
      </main>
    </>
  );
}

function ProfileShell() {
  const profile = useQuery(api.profiles.current);
  const clear = useMutation(api.profiles.clear);
  const [editing, setEditing] = useState(false);

  if (profile === undefined) return <p className="type-body text-mute">Loading…</p>;
  if (profile === null) return <UploadCard />;
  if (editing) return <ProfileEditForm profile={profile} onDone={() => setEditing(false)} />;

  const fieldCount =
    Number(!!profile.name) +
    Number(!!profile.headline) +
    Number(!!profile.summary) +
    Number(!!profile.location) +
    profile.experience.length +
    profile.education.length +
    profile.skills.length;

  return (
    <div className="flex flex-col gap-10">
      {!profile.reviewed && (
        <ReviewCallout
          fieldCount={fieldCount}
          onEdit={() => setEditing(true)}
          onReupload={() => clear({})}
        />
      )}
      <ProfileView profile={profile} onEdit={() => setEditing(true)} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Smoke test in browser**

Run `pnpm dev` (and `npx convex dev` in another terminal if not already running). Visit http://localhost:3000/profile. With no profile yet, the upload card should render. Upload a real PDF résumé. Verify:

- "Reading your résumé…" appears
- "Thinking about what we read." appears
- Page swaps to `<ProfileView/>` with `<ReviewCallout/>` on top
- Click "Looks right" → callout disappears
- Click "Edit profile" → form renders with extracted fields populated
- Save changes → form closes, ProfileView shows updated values

- [ ] **Step 4: Commit**

```bash
git add app/profile/
git commit -m "feat(profiles): /profile page wires upload, view, edit, callout"
```

---

## Task 18: Home page copy follow-up

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Update the home page UploadPreview copy**

In `app/page.tsx`, find the line:

```tsx
Supports PDF, DOCX, and image screenshots.
```

Replace with:

```tsx
Supports PDF and DOCX.
```

The LinkedIn tab stays as-is (non-functional placeholder per the spec).

- [ ] **Step 2: Verify in browser**

Run `pnpm dev`, visit http://localhost:3000, confirm the copy reads "Supports PDF and DOCX."

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "fix(home): align upload preview copy with v1 scope (PDF + DOCX)"
```

---

## Task 19: Quality gates — `convex-performance-audit`, `/polish`, `/audit`

**Files:** none new; audits may produce fix commits.

- [ ] **Step 1: Run the Convex performance audit**

```
/convex-performance-audit
```

Or invoke the skill directly. Address any flagged hot-path issues with new commits.

- [ ] **Step 2: Run `/polish` on each profile component**

In Claude Code:

```
/polish components/profile/UploadCard.tsx
/polish components/profile/ProfileView.tsx
/polish components/profile/ProfileEditForm.tsx
/polish components/profile/ReviewCallout.tsx
```

Apply suggested fixes; commit each.

- [ ] **Step 3: Run `/audit` on the profile flow**

```
/audit /profile
```

Address any "must-fix" items. Commit fixes.

---

## Task 20: Final verification

**Files:** none

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 3: Build**

```bash
pnpm build
```

Expected: successful build.

- [ ] **Step 4: Manual smoke through golden path**

Run `pnpm dev` + `npx convex dev`. Walk through:

1. Visit `/` (signed out) — landing page renders, design intact.
2. Visit `/profile` (signed out) — sign-in CTA renders.
3. Sign in → redirects back, upload card visible.
4. Upload a real résumé → loading → profile renders → callout visible.
5. Click "Looks right" → callout dismisses.
6. Click "Edit profile" → form opens, fields populated.
7. Edit a field, save → form closes, view shows updated value.
8. Click "Re-upload" (in callout) → row deleted, upload card returns.
9. Upload again → confirms overwrite works.

- [ ] **Step 5: Final commit (if anything was tweaked during smoke)**

```bash
git add -A
git commit -m "chore(profiles): post-smoke fixes"
```

- [ ] **Step 6: Verification before completion**

Apply `superpowers:verification-before-completion` discipline — confirm test, typecheck, build, smoke evidence is captured before declaring this feature shipped.

---

## Self-review notes (kept for posterity)

**Spec coverage:** Each section of the spec maps to tasks above:
- §3 Architecture → Tasks 5, 7, 8, 9, 10, 12, 17
- §4 Schema → Task 5
- §5 Functions → Tasks 7, 8, 9, 10
- §6 UI surfaces → Tasks 13, 14, 15, 16, 17
- §7 Voice & copy → Tasks 13, 14, 15 (copy strings reflect §7)
- §8 Error handling → Task 14 (`ERROR_COPY` map)
- §9 Cost / privacy guardrails → Task 9 (rate limit + ZDR header), Task 6 (env var)
- §10 Testing → Tasks 4, 11, 12 (unit + integration); Tasks 17, 19, 20 (smoke + audits)
- §11 Deps → Task 1
- §12 Pre-implementation → Task 3 (`/impeccable shape`)

**Type consistency:** `ProfileSchema` (Zod) in Task 4 mirrors the Convex schema in Task 5; the action in Task 9 uses `ProfileSchema` for `Output.object`; the form in Task 16 uses the same schema via `zodResolver`. The discriminated `{ ok: true } | { ok: false; error: ... }` action result shape in Task 9 matches what Task 14 destructures.

**Placeholder scan:** `<model id from Step 1>` in Task 9 is intentional (a runtime lookup result, not a static placeholder). All other code blocks contain executable code, not pseudocode.
