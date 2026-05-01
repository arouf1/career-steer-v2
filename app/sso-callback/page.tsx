"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";

export default function SSOCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="flex items-center gap-3 text-body">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span className="type-caption">Completing sign-in…</span>
      </div>
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
