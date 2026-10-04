/* ------------------------------------------------------------------ */
/* Admin console — browser → /api/admin/* transport                     */
/*                                                                     */
/* The browser holds NO privileged credential. Every call here sends    */
/* the signed-in user's Supabase access token to the same-origin admin  */
/* API, which verifies the session and re-reads `profiles.role` before  */
/* touching any data. If that check fails the UI simply receives a 401  */
/* or 403 — there is no client-side bypass, because there is nothing to */
/* bypass.                                                              */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "../services/supabase";

export class AdminRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "admin_error") {
    super(message);
    this.name = "AdminRequestError";
    this.status = status;
    this.code = code;
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, params?: QueryParams) {
  const clean = path.replace(/^\/+/, "");
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return `/api/admin/${clean}${qs ? `?${qs}` : ""}`;
}

async function accessToken(): Promise<string> {
  const sb = getSupabase();
  if (!sb) {
    throw new AdminRequestError(503, "This deployment has no Supabase configuration.", "config_missing");
  }
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) throw new AdminRequestError(401, "Your session expired — sign in again.", "auth_missing");
  return session.access_token;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  options: { params?: QueryParams; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const token = await accessToken();
  const response = await fetch(buildUrl(path, options.params), {
    method,
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const payload = (parsed ?? {}) as { error?: string; code?: string };
    throw new AdminRequestError(
      response.status,
      payload.error ??
        (response.status === 404
          ? "That admin endpoint doesn't exist."
          : "The admin service couldn't complete that request."),
      payload.code ?? "admin_error",
    );
  }

  return (parsed ?? {}) as T;
}

export const adminGet = <T>(path: string, params?: QueryParams, signal?: AbortSignal) =>
  request<T>("GET", path, { params, signal });

export const adminPost = <T>(path: string, body: unknown) => request<T>("POST", path, { body });

export const adminPatch = <T>(path: string, body: unknown) => request<T>("PATCH", path, { body });

/* ------------------------------------------------------------------ */
/* Data hook                                                           */
/* ------------------------------------------------------------------ */
export type AdminQuery<T> = {
  data: T | null;
  error: string | null;
  status: number | null;
  loading: boolean;
  /** True only for the very first load, so refreshes don't blank the page. */
  initial: boolean;
  refresh: () => void;
};

/**
 * Loads one admin endpoint. Re-runs whenever the path or the parameters
 * change, aborts the in-flight request on unmount, and keeps the previous
 * data visible while refreshing (no flicker on filter changes).
 */
export function useAdminData<T>(path: string, params?: QueryParams, enabled = true): AdminQuery<T> {
  const key = useMemo(() => JSON.stringify(params ?? {}), [params]);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [nonce, setNonce] = useState(0);
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);

    adminGet<T>(path, JSON.parse(key) as QueryParams, controller.signal)
      .then((result) => {
        if (!active) return;
        loadedOnce.current = true;
        setData(result);
        setError(null);
        setStatus(200);
      })
      .catch((caught: unknown) => {
        if (!active || (caught instanceof DOMException && caught.name === "AbortError")) return;
        loadedOnce.current = true;
        const failure =
          caught instanceof AdminRequestError
            ? caught
            : new AdminRequestError(0, "We couldn't reach the admin service. Check your connection.", "network");
        setError(failure.message);
        setStatus(failure.status);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [path, key, enabled, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return { data, error, status, loading, initial: loading && !loadedOnce.current, refresh };
}

/* ------------------------------------------------------------------ */
/* Identity / access                                                   */
/* ------------------------------------------------------------------ */
export type AdminIdentity = {
  id: string;
  email: string;
  name: string;
  role: "admin";
  serverTime: string;
};

export type AdminAccess =
  | { state: "loading" }
  | { state: "granted"; identity: AdminIdentity }
  | { state: "unauthenticated" }
  | { state: "forbidden" }
  | { state: "error"; message: string };

/**
 * The real admin gate for the UI: it asks the server who you are. A client
 * flag (`profiles.role` read in the browser) is only ever used to avoid a
 * pointless flash of the console shell — never to grant access.
 */
export function useAdminAccess(): AdminAccess {
  const [access, setAccess] = useState<AdminAccess>({ state: "loading" });

  useEffect(() => {
    let active = true;
    adminGet<AdminIdentity>("me")
      .then((identity) => active && setAccess({ state: "granted", identity }))
      .catch((caught: unknown) => {
        if (!active) return;
        const failure =
          caught instanceof AdminRequestError
            ? caught
            : new AdminRequestError(0, "We couldn't reach the admin service.", "network");
        if (failure.status === 401) setAccess({ state: "unauthenticated" });
        else if (failure.status === 403) setAccess({ state: "forbidden" });
        else setAccess({ state: "error", message: failure.message });
      });
    return () => {
      active = false;
    };
  }, []);

  return access;
}
