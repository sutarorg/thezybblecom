/* ------------------------------------------------------------------ */
/* Auth + workspace React bindings over the service layer.             */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useState } from "react";
import { getCurrentUser, getDefaultWorkspace, type AppUser } from "./api";
import { getSupabase } from "./supabase";
import type { Workspace } from "../data/types";

export function useAuthUser() {
  const [user, setUser] = useState<AppUser | null | "loading">("loading");

  useEffect(() => {
    let mounted = true;
    getCurrentUser()
      .then((u) => mounted && setUser(u))
      .catch(() => mounted && setUser(null));

    const sb = getSupabase();
    if (!sb) return () => { mounted = false; };

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        if (mounted) setUser(null);
        return;
      }
      getCurrentUser()
        .then((u) => mounted && setUser(u))
        .catch(() => mounted && setUser(null));
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return user;
}

/** Active workspace for the signed-in user. */
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    getDefaultWorkspace()
      .then((ws) => {
        setWorkspace(ws);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener("zybble:workspace", onChange);
    return () => window.removeEventListener("zybble:workspace", onChange);
  }, [refresh]);

  return { workspace, loading, error, refresh };
}

/**
 * Convenience for pages: the active workspace plus the plan that
 * governs entitlements. Both come from the server.
 */
export function useWorkspaceContext() {
  const user = useAuthUser();
  const { workspace, loading, error, refresh } = useWorkspace();
  const planId = user === "loading" || !user ? "free" : user.planId;
  return {
    user: user === "loading" ? null : user,
    workspace,
    planId,
    ready: user !== "loading" && !loading,
    loading: user === "loading" || loading,
    error,
    refresh,
  };
}
