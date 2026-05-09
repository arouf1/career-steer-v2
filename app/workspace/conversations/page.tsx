// app/workspace/conversations/page.tsx
//
// Server component shell for the /workspace/conversations history page.
// Auth guard lives here (redirect before any client hydration); the client
// component owns the live Convex subscription, filter state, and pagination.

import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ConversationsListClient } from "./ConversationsListClient";

export const metadata: Metadata = {
  title: "Conversations",
  description: "Your past mock interviews and deep-dive conversations.",
};

export default async function ConversationsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return <ConversationsListClient />;
}
