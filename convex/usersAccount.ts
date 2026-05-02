"use node";

import { ConvexError } from "convex/values";
import { createClerkClient } from "@clerk/backend";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

// Server-side account deletion. Replaces the brittle two-step client flow
// (Convex deleteAccount mutation + client-side Clerk user.delete()) which
// depended on the Clerk dashboard's "allow self-delete" toggle being on.
//
// Using the Backend SDK with the admin secret key bypasses that setting:
// - Order: Clerk delete first, then Convex cascade. Failure of Clerk delete
//   leaves Convex data intact (recoverable retry).
// - The Clerk webhook (convex/http.ts) re-runs the cascade idempotently
//   when Clerk fires user.deleted, so even if the inline cascade below
//   races or fails, the user's data ends up gone.
export const deleteAccount = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new ConvexError(
        "Server misconfigured: CLERK_SECRET_KEY not set in Convex env. " +
          "Run `npx convex env set CLERK_SECRET_KEY <value>` " +
          "with the Secret Key from Clerk dashboard.",
      );
    }

    const clerk = createClerkClient({ secretKey });

    // Step 1: Delete Clerk user. If this throws, nothing in Convex is
    // destroyed yet — user can retry safely.
    try {
      await clerk.users.deleteUser(identity.subject);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      throw new ConvexError(`Clerk deletion failed: ${msg}`);
    }

    // Step 2: Cascade Convex data inline. Webhook will fire user.deleted
    // and run this again idempotently — having both ensures the user sees
    // data gone immediately, not on webhook delay.
    await ctx.runMutation(internal.users.deleteByTokenIdentifierInternal, {
      tokenIdentifier: identity.tokenIdentifier,
    });
  },
});
