"use client";

import { useEffect } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function UserSync() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const store = useMutation(api.users.store);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    void store();
  }, [isAuthenticated, isLoading, store]);

  return null;
}
