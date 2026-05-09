// app/workspace/calls/page.tsx
//
// Server component shell for the /workspace/calls history page.
// Auth guard lives here (redirect before any client hydration); the client
// component owns the live Convex subscription, filter state, and pagination.

import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CallsListClient } from "./CallsListClient";

export const metadata: Metadata = {
  title: "Calls",
  description: "Your past mock interviews and deep-dive calls.",
};

export default async function CallsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return <CallsListClient />;
}
