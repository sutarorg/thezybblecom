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

    /* Absolute safety net: the app must never sit on "loading" forever. */
    const failsafe = window.setTimeout(() => {
      if (mounted) {
        setUser((current) => (current === "loading" ? null : current));
      }
    }, 10000);

    getCurrentUser()
      .then((u) => {
        if (!mounted) return;
        window.clearTimeout(failsafe);
        setUser(u);
      })
      .catch(() => {
        if (!mounted) return;
        window.clearTimeout(failsafe);
        setUser(null);
      });

    const sb = getSupabase();
    if (!sb) {
      return () => {
        mounted = false;
        window.clearTimeout(failsafe);
      };
    }

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
      window.clearTimeout(failsafe);
      subscription.unsubscribe();
    };
  }, []);

  return user;
}

/** Active workspace for the signed-in user. */
export function useWorkspace(user: AppUser | null | "loading") {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    /*
     * Never hang forever: if the workspace lookup (including the
     * self-provisioning recovery) exceeds this budget, surface an
     * actionable error instead of an endless "loading" state.
     */
    const budget = window.setTimeout(() => {
      setLoading(false);
      setError((current) =>
        current ??
        "Your workspace is taking longer than expected to load. Check your connection and try again."
      );
    }, 15000);

    getDefaultWorkspace()
      .then((ws) => {
        window.clearTimeout(budget);
        setWorkspace(ws);
        setError(ws ? null : "We couldn't load your workspace. Please try again.");
      })
      .catch((e: Error) => {
        window.clearTimeout(budget);
        setError(e.message || "We couldn't load your workspace. Please try again.");
      })
      .finally(() => {
        window.clearTimeout(budget);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    // Do not query workspaces before auth has resolved. The old parallel
    // requests could finish the unauthenticated query last and overwrite a
    // valid workspace with null, leaving Find Leads permanently blocked.
    if (user === "loading") return;
    if (!user) {
      setWorkspace(null);
      setError(null);
      setLoading(false);
      return;
    }
    refresh();
    const onChange = () => refresh();
    window.addEventListener("zybble:workspace", onChange);
    return () => window.removeEventListener("zybble:workspace", onChange);
  }, [refresh, user]);

  return { workspace, loading, error, refresh };
}

/**
 * Convenience for pages: the active workspace plus the plan that
 * governs entitlements. Both come from the server.
 */
export function useWorkspaceContext() {
  const user = useAuthUser();
  const { workspace, loading, error, refresh } = useWorkspace(user);
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
