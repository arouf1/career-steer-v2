// app/workspace/calls/[callId]/page.tsx
//
// Server component shell for the per-call detail page.
// Auth guard mirrors app/workspace/calls/page.tsx — Clerk auth() check
// server-side before any client hydration.

import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CallDetailClient } from "./CallDetailClient";

export const metadata: Metadata = {
  title: "Call",
  description: "Detail view of a past call.",
};

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { callId } = await params;
  return <CallDetailClient callId={callId} />;
}
