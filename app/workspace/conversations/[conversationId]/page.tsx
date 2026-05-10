// app/workspace/conversations/[conversationId]/page.tsx
//
// Server component shell for the per-conversation detail page.
// Auth guard mirrors app/workspace/conversations/page.tsx. Clerk auth() check
// server-side before any client hydration.

import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ConversationDetailClient } from "./ConversationDetailClient";

export const metadata: Metadata = {
  title: "Conversation",
  description: "Detail view of a past conversation.",
};

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { conversationId } = await params;
  return <ConversationDetailClient callId={conversationId} />;
}
