---
name: Auth & security (career-steer-v2)
description: Read before editing proxy.ts, app/api/auth/**, or anything that touches Clerk identity. Clerk is the source of truth; Convex enforces.
appliesTo: proxy.ts, app/api/auth/**, lib/server/auth/**
---

# Auth & security — read before editing auth flows

## Source of truth

- **Clerk owns identity.** Sign-in, sign-up, sessions, MFA, organization, OAuth — all Clerk. Installed via the Vercel Marketplace integration; do not hand-wire env vars or providers.
- **Convex enforces access.** Every authenticated Convex function calls `await ctx.auth.getUserIdentity()` first and rejects on null. Roles / permissions live in the `users` table indexed by `clerkId`.

## Non-negotiables

- **No auth state in client-only stores.** Don't put `userId` / role / org into Zustand or React context as the primary source — read it from Clerk hooks (`useUser`, `useAuth`) or from server props. Client stores can cache for UX but must invalidate on sign-out.
- **No `auth()` bypass in server actions.** Every Server Action that mutates user data starts with a Clerk `auth()` call (or the Convex equivalent if calling Convex directly). No `// TODO: add auth` placeholders that ship.
- **No `NEXT_PUBLIC_*` for secrets.** Anything `NEXT_PUBLIC_*` is in the browser bundle. Webhook secrets, OpenRouter keys, Exa keys, Convex deploy keys — server-only env, never `NEXT_PUBLIC_`.
- **Webhook signature verification.** Any incoming webhook (Clerk → Convex sync, Stripe later, etc.) verifies signature before doing anything. Reject on mismatch with 401, do not log the body.
- **No PII in client logs.** `console.log` in client code never contains email, full name, resume content. Server-side structured logs only, with PII redacted before leaving Vercel Functions.

## Standing reminders

- **Use the installed skill.** `convex-setup-auth` covers the Clerk ↔ Convex wiring end to end. If you're touching auth and haven't invoked it, you're probably doing it wrong.
- **Middleware patterns.** Use `vercel-plugin:routing-middleware` guidance for any new middleware logic — Edge runtime is *not* the right answer; route through Fluid Compute Node middleware.
- **Org / multi-tenant later.** MVP is single-user accounts. Don't pre-build org switching into the schema — but don't actively make it impossible either (use `userId` FKs, not denormalized data).

## When in doubt

Invoke `convex-setup-auth` (Clerk + Convex pattern) or `vercel-plugin:auth` (Vercel-side patterns).
