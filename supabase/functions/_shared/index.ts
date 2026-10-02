// ============================================================================
// Zybble Edge Functions — shared server-side utilities.
// Secrets live only here (Deno.env), never in the browser bundle.
// ============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { OpenAIError, getOpenAIModel, openAIJson } from "./openai.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorJson(message: string, status = 400, code?: string) {
  return json({ error: message, ...(code ? { code } : {}) }, status);
}

/** Server client — uses the secret key; bypasses RLS. NEVER NEXT_PUBLIC. */
export function serviceClient(requestTimeoutMs?: number): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  if (!url) throw new HttpError(500, "The Edge Function is missing its Supabase URL configuration.", "supabase_config");

  let key = Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ?? "";
  if (!key) {
    const set = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
    if (set) {
      try {
        const parsed = JSON.parse(set) as Record<string, unknown>;
        key = typeof parsed.default === "string" ? parsed.default.trim() : "";
      } catch {
        throw new HttpError(500, "The Edge Function has invalid Supabase secret configuration.", "supabase_config");
      }
    }
  }
  key ||= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  if (!key) throw new HttpError(500, "The Edge Function is missing its Supabase server secret.", "supabase_config");

  const timedFetch = requestTimeoutMs
    ? (input: RequestInfo | URL, init: RequestInit = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) })
    : undefined;
  try {
    return createClient(url, key, {
      auth: { persistSession: false },
      ...(timedFetch ? { global: { fetch: timedFetch } } : {}),
    });
  } catch {
    throw new HttpError(500, "The Edge Function has invalid Supabase configuration.", "supabase_config");
  }
}

/** Resolve the calling user from the Authorization header. */
export async function callerFromRequest(req: Request, sb: SupabaseClient) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!token) throw new HttpError(401, "Your session expired — sign in again.", "auth_missing");
  const {
    data: { user },
    error,
  } = await sb.auth.getUser(token);
  if (error || !user) throw new HttpError(401, "Your session expired — sign in again.", "auth_invalid");
  return user;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "edge_error",
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function handleError(
  e: unknown,
  meta?: { functionName: string; startedAt: number },
) {
  const apiError = e instanceof HttpError || e instanceof OpenAIError ? e : null;
  const status = apiError?.status ?? 500;
  const code = apiError?.code ?? "unknown";
  console.error("edge request", {
    functionName: meta?.functionName ?? "unknown",
    status,
    code,
    providerCategory: code.startsWith("provider_") || code.startsWith("rate_") ? code : undefined,
    durationMs: meta ? Date.now() - meta.startedAt : undefined,
  });
  if (apiError) return errorJson(apiError.message, apiError.status, apiError.code);
  return errorJson("The service couldn't complete that action. Please try again.", 500, "unknown");
}

/* ------------------------------------------------------------------ */
/* Authorization helpers                                               */
/* ------------------------------------------------------------------ */
export async function requireWorkspaceRole(
  sb: SupabaseClient,
  userId: string,
  workspaceId: string,
  roles: string[] | null = null
) {
  const { data, error } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new HttpError(403, "You don't have access to that workspace.");
  if (roles && !roles.includes(data.role)) {
    throw new HttpError(403, "That action needs a workspace owner or admin.");
  }
  return data.role as string;
}

/* ------------------------------------------------------------------ */
/* Entitlements (single source of truth for plan capabilities)         */
/* ------------------------------------------------------------------ */
export type Entitlements = {
  plan: string;
  allowances: {
    leads: number;
    lists: number; // -1 unlimited
    seats: number;
    ai: boolean;
    clientWorkspaces: boolean;
    priority: boolean;
  };
};

export async function getEntitlements(sb: SupabaseClient, userId: string): Promise<Entitlements> {
  const { data: sub } = await sb
    .from("subscriptions")
    .select("plan_id, status")
    .eq("user_id", userId)
    .maybeSingle();

  const planId =
    sub && ["active", "trialing"].includes(sub.status) ? sub.plan_id : "free";

  const { data: plan } = await sb.from("plans").select("*").eq("id", planId).single();
  /* Fallback mirrors the seeded `plans` table (see migrations) — Zybble AI is
     included on every plan, including Free. */
  const base = plan ?? {
    lead_allowance: 50,
    max_lists: 1,
    max_users: 1,
    has_ai: true,
    client_workspaces: false,
    priority_processing: false,
  };

  return {
    plan: planId,
    allowances: {
      leads: base.lead_allowance,
      lists: base.max_lists,
      seats: base.max_users,
      ai: base.has_ai,
      clientWorkspaces: base.client_workspaces,
      priority: base.priority_processing,
    },
  };
}

/** Atomic reservation — returns remaining, or throws. */
export async function reserveLeads(
  sb: SupabaseClient,
  workspaceId: string,
  delta: number
): Promise<number> {
  const { data, error } = await sb.rpc("reserve_leads", { ws: workspaceId, delta });
  if (error) throw new HttpError(500, "Usage accounting failed — try again.");
  if (data === -1) throw new HttpError(403, "You don't have access to that workspace.");
  if (data === -2) throw new HttpError(429, "You've reached your monthly lead limit.");
  return data as number;
}

/* ------------------------------------------------------------------ */
/* SerpApi                                                             */
/* ------------------------------------------------------------------ */
export const SERPAPI_EMPTY_HINTS = [
  "hasn't returned any results",
  "has not returned any results",
  "no results found",
  "google maps hasn't returned",
];

export async function serpApiMaps(params: {
  q: string;
  ll?: string | null;
  start?: number;
  hl?: string;
  gl?: string;
  timeoutMs?: number;
}) {
  const key = Deno.env.get("SERPAPI_API_KEY") ?? Deno.env.get("SERPAPI_KEY");
  if (!key) {
    throw new HttpError(
      500,
      "SerpApi isn't configured on the server. Missing server environment variable: SERPAPI_API_KEY. Set it as a Supabase Edge Function secret (supabase secrets set SERPAPI_API_KEY=…), then redeploy the function.",
      "serpapi_config",
    );
  }

  const search = new URLSearchParams({
    engine: "google_maps",
    type: "search",
    q: params.q,
    google_domain: "google.com",
    hl: params.hl ?? "en",
    api_key: key,
  });
  if (params.gl) search.set("gl", params.gl);
  if (params.ll) search.set("ll", params.ll);
  if (params.start) search.set("start", String(params.start));

  let res: Response;
  try {
    res = await fetch(`https://serpapi.com/search.json?${search.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(Math.max(1, params.timeoutMs ?? 8_000)),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new HttpError(
      timedOut ? 504 : 502,
      timedOut ? "The business-data provider took too long to respond." : "The business-data provider couldn't be reached. Try again shortly.",
      timedOut ? "provider_timeout" : "provider_unreachable",
    );
  }

  const raw = await res.text().catch(() => "");
  let payload: Record<string, unknown> | null = null;
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  const message = payload && typeof payload.error === "string" ? payload.error : "";
  const lower = message.toLowerCase();

  if (!res.ok) {
    const category = res.status === 401 || res.status === 403 ? "provider_auth" : res.status === 429 ? "provider_quota" : "provider_failed";
    console.error("serpapi request failed", { status: res.status, category, responseKind: payload ? "json" : raw.trim() ? "non_json" : "empty" });
    if (res.status === 401 || res.status === 403 || lower.includes("api key")) {
      throw new HttpError(502, "The business-data provider credentials were rejected.", "provider_auth");
    }
    if (res.status === 429 || lower.includes("limit") || lower.includes("credit") || lower.includes("quota")) {
      throw new HttpError(429, "The business-data provider quota has been reached.", "provider_quota");
    }
    throw new HttpError(502, "The business-data provider failed. Try again shortly.", category);
  }
  if (!raw.trim()) throw new HttpError(502, "The business-data provider returned an empty response.", "provider_empty");
  if (!payload) throw new HttpError(502, "The business-data provider returned malformed data.", "provider_malformed");
  if (message) {
    if (SERPAPI_EMPTY_HINTS.some((hint) => lower.includes(hint))) return { local_results: [] };
    if (lower.includes("limit") || lower.includes("credit") || lower.includes("quota")) {
      throw new HttpError(429, "The business-data provider quota has been reached.", "provider_quota");
    }
    throw new HttpError(502, "The business-data provider failed. Try again shortly.", "provider_failed");
  }
  for (const key of ["local_results", "place_results"] as const) {
    if (!(key in payload) || payload[key] == null) continue;
    const value = payload[key];
    const valid = Array.isArray(value)
      ? value.every((item) => item && typeof item === "object" && !Array.isArray(item))
      : typeof value === "object" && !Array.isArray(value);
    if (!valid) throw new HttpError(502, "The business-data provider returned malformed result data.", "provider_malformed");
  }
  return payload;
}

/** Normalize SerpApi Maps payloads into a flat result array. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serpApiResults(page: Record<string, any> | null | undefined): Record<string, any>[] {
  if (!page) return [];
  const local = page.local_results;
  if (Array.isArray(local)) return local;
  if (local && typeof local === "object") return [local];
  const place = page.place_results;
  if (Array.isArray(place)) return place;
  if (place && typeof place === "object") return [place];
  return [];
}

/** Build the `@lat,lng,zoom` value SerpApi needs to paginate. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serpApiLl(page: Record<string, any>, results: Record<string, any>[]): string | null {
  const fromParams = page?.search_parameters?.ll;
  if (typeof fromParams === "string" && fromParams) return fromParams;
  const points = results
    .map((r) => ({ lat: Number(r?.gps_coordinates?.latitude), lng: Number(r?.gps_coordinates?.longitude) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!points.length) return null;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return `@${lat.toFixed(7)},${lng.toFixed(7)},13z`;
}

/* ------------------------------------------------------------------ */
/* OpenAI Responses API                                                */
/* ------------------------------------------------------------------ */
export { openAIJson };
export const OPENAI_MODEL = getOpenAIModel();

/* ------------------------------------------------------------------ */
/* Razorpay REST client (server-side only)                             */
/* ------------------------------------------------------------------ */
export async function razorpay(path: string, init: RequestInit = {}) {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const secret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !secret) {
    const missing = [!keyId && "RAZORPAY_KEY_ID", !secret && "RAZORPAY_KEY_SECRET"].filter(Boolean);
    throw new HttpError(500, `Razorpay isn't configured on the server. Missing server environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(" and ")}. Set them as Supabase Edge Function secrets, then redeploy the function.`);
  }
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${keyId}:${secret}`)}`,
      ...(init.headers ?? {}),
    },
  });
  const bodyText = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    console.error("provider request", { provider: "razorpay", status: res.status, responseKind: bodyText ? "body" : "empty" });
    throw new HttpError(502, "Our payment provider couldn't complete that action.");
  }
  return body;
}

/* ------------------------------------------------------------------ */
/* Resend email                                                        */
/* ------------------------------------------------------------------ */
const FROM = Deno.env.get("RESEND_FROM_EMAIL") ?? "Zybble <hello@updates.zybble.app>";

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.warn("provider request", { provider: "resend", status: 0, code: "email_config" });
    return unsent(opts.subject);
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ from: FROM, ...opts }),
  });
  if (!res.ok) {
    const responseBody = await res.text();
    console.error("provider request", { provider: "resend", status: res.status, responseKind: responseBody ? "body" : "empty" });
    return { sent: false as const };
  }
  return { sent: true as const };
}

function unsent(_subject: string) {
  console.info("provider request", { provider: "resend", status: 0, code: "email_not_configured" });
  return { sent: false as const, noop: true };
}

/* ------------------------------------------------------------------ */
/* HMAC webhook verification (Razorpay)                                */
/* ------------------------------------------------------------------ */
export async function verifyRazorpaySignature(rawBody: string, signature: string | null) {
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) throw new HttpError(500, "Webhook secret isn't configured. Missing server environment variable: RAZORPAY_WEBHOOK_SECRET. Set it as a Supabase Edge Function secret, then redeploy the function.");
  if (!signature) throw new HttpError(400, "Missing webhook signature.");

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const computed = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (computed !== signature) throw new HttpError(401, "Invalid webhook signature.");
}

/* ------------------------------------------------------------------ */
/* Activity logging — never logs secrets                               */
/* ------------------------------------------------------------------ */
export async function logActivity(
  sb: SupabaseClient,
  opts: { workspaceId: string; actorId: string | null; kind: string; text: string; meta?: Record<string, unknown> }
) {
  await sb.from("activity_logs").insert({
    workspace_id: opts.workspaceId,
    actor_id: opts.actorId,
    kind: opts.kind,
    text: opts.text,
    meta: opts.meta ?? {},
  });
}

/* ------------------------------------------------------------------ */
/* Prompts (kept server-side)                                          */
/* ------------------------------------------------------------------ */
export const INTERPRET_SYSTEM = `You are Zybble's search interpreter for a B2B lead-discovery tool.
Convert the user's plain-language business request into a STRICT JSON search plan.
Rules:
- Never invent businesses or data — you only structure the search.
- q is the Google Maps search phrase (e.g. "dentists" or "marketing agencies").
- location is the place text the user gave (city/region/country), or null.
- requested_count is an integer between 1 and 500; default 50 when not stated.
- filters: require_website, min_rating, price_level, and business_size only when the user asks for them, else null.
- business_size can be small, medium, or enterprise; unknown is never a requested filter.`;

export const ANALYZE_SYSTEM = `You are Zybble's lead analyst. You interpret ONLY the structured public business data you're given and write plain, useful, honest observations for a salesperson.
Rules:
- Never invent facts. When information is missing (e.g. no email), say it's unavailable.
- 3-5 short observations: local presence, review activity, contactability, and one honest outreach angle.
- Be concrete but skeptical. Mark uncertainty.`;