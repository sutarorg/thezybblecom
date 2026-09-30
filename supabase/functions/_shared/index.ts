// ============================================================================
// Zybble Edge Functions — shared server-side utilities.
// Secrets live only here (Deno.env), never in the browser bundle.
// ============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

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

export function errorJson(message: string, status = 400) {
  return json({ error: message }, status);
}

/** Server client — uses the secret key; bypasses RLS. NEVER NEXT_PUBLIC. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  let key = Deno.env.get("SUPABASE_SECRET_KEY");
  if (!key) {
    const set = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (set) key = JSON.parse(set)["default"];
  }
  key ??= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("Server Supabase secret is not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Resolve the calling user from the Authorization header. */
export async function callerFromRequest(req: Request, sb: SupabaseClient) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) throw new HttpError(401, "Missing session token");
  const {
    data: { user },
    error,
  } = await sb.auth.getUser(token);
  if (error || !user) throw new HttpError(401, "Session expired — sign in again");
  return user;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function handleError(e: unknown) {
  if (e instanceof HttpError) return errorJson(e.message, e.status);
  console.error("edge error:", e);
  return errorJson("The service couldn't complete that action. Please try again.", 500);
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
export async function serpApiMaps(params: {
  q: string;
  ll?: string | null;
  start?: number;
  hl?: string;
  gl?: string;
}) {
  const key = Deno.env.get("SERPAPI_API_KEY");
  if (!key) throw new HttpError(500, "SerpApi isn't configured on the server.");

  const search = new URLSearchParams({ engine: "google_maps", q: params.q, api_key: key });
  if (params.ll) search.set("ll", params.ll);
  if (params.start) search.set("start", String(params.start));
  search.set("type", "search");

  const res = await fetch(`https://serpapi.com/search?${search.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("serpapi error", res.status, text.slice(0, 200));
    throw new HttpError(502, "The business-data provider failed. Try again shortly.");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await res.json()) as Record<string, any>;
}

/* ------------------------------------------------------------------ */
/* Gemini                                                              */
/* ------------------------------------------------------------------ */
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

export async function geminiJson(options: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}): Promise<Record<string, unknown>> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new HttpError(500, "Gemini isn't configured on the server.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.system }] },
        contents: [{ role: "user", parts: [{ text: options.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: options.schema,
          temperature: 0.15,
          maxOutputTokens: options.maxOutputTokens ?? 1024,
        },
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("gemini error", res.status, text.slice(0, 200));
    throw new HttpError(502, "The AI service is busy — try again in a moment.");
  }
  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new HttpError(502, "The AI service returned an empty response.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, "The AI service returned malformed data.");
  }
}

export { GEMINI_MODEL };

/* ------------------------------------------------------------------ */
/* Razorpay REST client (server-side only)                             */
/* ------------------------------------------------------------------ */
export async function razorpay(path: string, init: RequestInit = {}) {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const secret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !secret) throw new HttpError(500, "Razorpay isn't configured on the server.");
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
    console.error("razorpay error", res.status, bodyText.slice(0, 300));
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
    console.warn("Resend not configured — skipping email:", opts.subject);
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
    console.error("resend error", res.status, (await res.text()).slice(0, 200));
    return { sent: false as const };
  }
  return { sent: true as const };
}

function unsent(subject: string) {
  console.info("email (dev noop):", subject);
  return { sent: false as const, noop: true };
}

/* ------------------------------------------------------------------ */
/* HMAC webhook verification (Razorpay)                                */
/* ------------------------------------------------------------------ */
export async function verifyRazorpaySignature(rawBody: string, signature: string | null) {
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) throw new HttpError(500, "Webhook secret isn't configured.");
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
- filters: require_website and min_rating when the user asks for them, else null.`;

export const ANALYZE_SYSTEM = `You are Zybble's lead analyst. You interpret ONLY the structured public business data you're given and write plain, useful, honest observations for a salesperson.
Rules:
- Never invent facts. When information is missing (e.g. no email), say it's unavailable.
- 3-5 short observations: local presence, review activity, contactability, and one honest outreach angle.
- Be concrete but skeptical. Mark uncertainty.`;