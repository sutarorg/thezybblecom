/* ------------------------------------------------------------------ */
/* Auth + workspace React bindings over the service layer.             */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useState } from "react";
import {
  BACKEND_ENABLED,
  getCurrentUser,
  getDefaultWorkspace,
  type AppUser,
} from "./api";
import { getSupabase } from "./supabase";
import type { Workspace } from "../data/types";

export function useAuthUser() {
  const [user, setUser] = useState<AppUser | null | "loading">("loading");

  useEffect(() => {
    let mounted = true;
    getCurrentUser().then((u) => {
      if (mounted) setUser(u);
    });
    const sb = getSupabase();
    if (sb) {
      const {
        data: { subscription },
      } = sb.auth.onAuthStateChange(() => {
        getCurrentUser().then((u) => {
          if (mounted) setUser(u);
        });
      });
      return () => {
        mounted = false;
        subscription.unsubscribe();
      };
    }
    return () => {
      mounted = false;
    };
  }, []);

  return user;
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    getDefaultWorkspace()
      .then((ws) => setWorkspace(ws))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener("zybble:workspace", onChange);
    return () => window.removeEventListener("zybble:workspace", onChange);
  }, [refresh]);

  return { workspace, loading, refresh };
}

export const backend = BACKEND_ENABLED;
