/* ------------------------------------------------------------------ */
/* Admin API client.                                                   */
/*                                                                     */
/* Every call carries the caller's Supabase access token and goes to   */
/* the same-origin /api/admin/* function, which re-verifies the token  */
/* AND re-reads profiles.role before touching any data. Nothing here   */
/* is a security boundary — this file only talks to one.               */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSession } from "../services/supabase";
import { safeApiMessage } from "../services/api-response";

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

export function toQuery(params: Params = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const q = search.toString();
  return q ? `?${q}` : "";
}

async function request<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const session = await getSession();
  if (!session?.access_token) {
    throw new AdminApiError(401, "Your session expired — sign in again.", "auth_missing");
  }

  let response: Response;
  try {
    response = await fetch(`/api/admin/${path.replace(/^\/+/, "")}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new AdminApiError(0, "The admin server couldn't be reached. Check your connection.", "network");
  }

  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok || (parsed && typeof parsed === "object" && "error" in (parsed as object))) {
    const body = (parsed ?? {}) as { error?: unknown; code?: unknown };
    const fallback =
      response.status === 401
        ? "Your session expired — sign in again."
        : response.status === 403
          ? "You don't have access to the Zybble admin console."
          : response.status === 404
            ? "That admin endpoint isn't available on this deployment."
            : "The admin server couldn't complete that request.";
    throw new AdminApiError(
      response.status,
      safeApiMessage(body.error, fallback),
      typeof body.code === "string" ? body.code : "admin_error",
    );
  }

  return (parsed ?? {}) as T;
}

export const adminGet = <T,>(path: string, params?: Params, signal?: AbortSignal) =>
  request<T>(`${path}${toQuery(params)}`, { signal });

export const adminPost = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body });

/* ------------------------------------------------------------------ */
/* Data hook with abort-on-change and an honest error state.           */
/* ------------------------------------------------------------------ */
export type Resource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  reload: () => void;
};

export function useAdminResource<T>(path: string, params: Params = {}): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = `${path}${toQuery(params)}`;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setErrorCode(null);

    adminGet<T>(key, undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || !mounted.current) return;
        setData(result);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || !mounted.current) return;
        if ((e as Error)?.name === "AbortError") return;
        const err = e as AdminApiError;
        setError(err.message || "Something went wrong loading that data.");
        setErrorCode(err.code ?? "admin_error");
        setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted && mounted.current) setLoading(false);
      });

    return () => controller.abort();
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, errorCode, reload };
}
