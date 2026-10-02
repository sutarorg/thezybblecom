import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };
type JsonObject = Record<string, unknown>;

export const maxDuration = 30;

class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code = "ai_error") { super(message); }
}

function env(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function bodyOf(req: VercelRequest): JsonObject {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body as JsonObject;
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject;
    } catch { throw new ApiError(400, "The AI request wasn't valid JSON.", "invalid_json"); }
  }
  throw new ApiError(400, "An AI request is required.", "missing_body");
}

function tokenOf(req: VercelRequest) {
  const value = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const token = value?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError(401, "Your session expired — sign in again.", "auth_missing");
  return token;
}

function userClient(token: string): SupabaseClient {
  const url = env("SUPABASE_URL", "VITE_SUPABASE_URL");
  const key = env("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!url || !key) throw new ApiError(500, "The AI server isn't connected to Supabase.", "supabase_config");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
    location: { type: "string" },
    quantity: { type: "integer" },
    minRating: { type: "string", enum: ["", "3", "3.5", "4", "4.5"] },
    priceLevel: { type: "string", enum: ["", "1", "2", "3", "4"] },
    businessSize: { type: "string", enum: ["", "small", "medium", "enterprise"] },
    requireWebsite: { type: "boolean" },
    requirePhone: { type: "boolean" },
    requireEmail: { type: "boolean" },
    openNow: { type: "boolean" },
    summary: { type: "string" },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["category", "summary"],
};

function geminiBody(request: string, mode: "full" | "no-thinking" | "json-only") {
  const system = "You turn a user's lead-discovery request into search-form filters. Do not invent requirements. You only fill the form; you never claim to run a search. Business size must only be set when the user explicitly asks for small, medium, or enterprise businesses. Return concise JSON.";
  const body: JsonObject = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: `User request: ${request}` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.15,
      maxOutputTokens: 512,
      ...(mode !== "json-only" ? { responseSchema: RESPONSE_SCHEMA } : {}),
      ...(mode === "full" ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  };
  if (mode === "json-only") {
    body.contents = [{ role: "user", parts: [{ text: `Return only JSON with keys category, location, quantity, minRating, priceLevel, businessSize, requireWebsite, requirePhone, requireEmail, openNow, summary, notes. User request: ${request}` }] }];
  }
  return body;
}

async function callGemini(request: string): Promise<JsonObject> {
  const apiKey = env("GEMINI_API_KEY");
  const model = env("GEMINI_MODEL") || "gemini-2.5-flash";
  if (!apiKey) throw new ApiError(500, "Gemini isn't configured on the server.", "missing_key");

  let lastPayload: JsonObject = {};
  for (const mode of ["full", "no-thinking", "json-only"] as const) {
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify(geminiBody(request, mode)),
      });
    } catch {
      throw new ApiError(502, "The AI service couldn't be reached — try again in a moment.", "provider_unreachable");
    }

    const payload = (await response.json().catch(() => ({}))) as JsonObject;
    lastPayload = payload;
    if (!response.ok) {
      const error = payload.error as JsonObject | undefined;
      const providerMessage = typeof error?.message === "string" ? error.message : "";
      const lower = providerMessage.toLowerCase();
      console.warn("gemini interpret error", { status: response.status, mode, model, message: providerMessage.slice(0, 240) });
      if (response.status === 400 && (lower.includes("api key") || lower.includes("apikey"))) throw new ApiError(502, "The Gemini API key was rejected. Update GEMINI_API_KEY.", "invalid_key");
      if (response.status === 401 || response.status === 403) throw new ApiError(502, "The AI provider rejected the server credentials.", "provider_auth");
      if (response.status === 429) throw new ApiError(429, "Zybble AI is rate-limited — try again shortly.", "rate_limited");
      if (response.status === 400 && mode !== "json-only") continue; // unsupported schema/thinking config; retry simpler
      if (response.status >= 500) throw new ApiError(502, "The AI provider is temporarily unavailable.", "provider_unavailable");
      throw new ApiError(502, "The AI provider rejected the request configuration.", "invalid_provider_request");
    }

    const candidates = payload.candidates as JsonObject[] | undefined;
    const content = candidates?.[0]?.content as JsonObject | undefined;
    const parts = content?.parts as JsonObject[] | undefined;
    const text = parts?.map((part) => part.text).filter((x): x is string => typeof x === "string").join("\n").trim();
    if (!text) {
      console.warn("gemini empty interpret response", { mode, model, finishReason: candidates?.[0]?.finishReason });
      throw new ApiError(502, "The AI service returned an empty response.", "empty_response");
    }
    try {
      return JSON.parse(text) as JsonObject;
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]) as JsonObject;
      throw new ApiError(502, "The AI service returned malformed data.", "malformed_response");
    }
  }
  console.warn("gemini interpret exhausted retries", { model, payloadKeys: Object.keys(lastPayload) });
  throw new ApiError(502, "The AI service couldn't complete that request — try again.", "provider_failed");
}

function cleanResult(raw: JsonObject) {
  const filters: JsonObject = {};
  if (typeof raw.category === "string" && raw.category.trim()) filters.category = raw.category.trim().slice(0, 80);
  if (typeof raw.location === "string" && raw.location.trim()) filters.location = raw.location.trim().slice(0, 100);
  if (typeof raw.quantity === "number" && Number.isFinite(raw.quantity)) filters.quantity = Math.max(1, Math.min(240, Math.round(raw.quantity)));
  if (typeof raw.minRating === "string" && ["3", "3.5", "4", "4.5"].includes(raw.minRating)) filters.minRating = raw.minRating;
  if (typeof raw.priceLevel === "string" && ["1", "2", "3", "4"].includes(raw.priceLevel)) filters.priceLevel = raw.priceLevel;
  if (typeof raw.businessSize === "string" && ["small", "medium", "enterprise"].includes(raw.businessSize)) filters.businessSize = raw.businessSize;
  for (const key of ["requireWebsite", "requirePhone", "requireEmail", "openNow"] as const) if (raw[key] === true) filters[key] = true;
  if (!filters.category) throw new ApiError(502, "Zybble AI couldn't identify a business category. Try rephrasing.", "category_missing");
  return {
    filters,
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 240) : "Search filters prepared.",
    notes: Array.isArray(raw.notes) ? raw.notes.slice(0, 2).map((note) => String(note).slice(0, 160)) : [],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = bodyOf(req);
    const workspaceId = String(body.workspaceId ?? "");
    const request = String(body.request ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new ApiError(400, "A valid workspace is required.", "workspace_invalid");
    if (request.length < 3) throw new ApiError(400, "Describe what you're looking for.", "request_short");
    if (request.length > 400) throw new ApiError(400, "Keep the request under 400 characters.", "request_long");

    const token = tokenOf(req);
    const sb = userClient(token);
    const { data: auth, error: authError } = await sb.auth.getUser(token);
    if (authError || !auth.user) throw new ApiError(401, "Your session expired — sign in again.", "auth_invalid");

    const { data: membership, error: membershipError } = await sb
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (membershipError || !membership) throw new ApiError(403, "You don't have access to that workspace.", "workspace_forbidden");

    const { data: subscription } = await sb.from("subscriptions").select("plan_id, status").eq("user_id", auth.user.id).maybeSingle();
    const planId = subscription && ["active", "trialing"].includes(subscription.status) ? subscription.plan_id : "free";
    const { data: plan } = await sb.from("plans").select("has_ai").eq("id", planId).maybeSingle();
    if (plan?.has_ai === false) throw new ApiError(403, "Zybble AI isn't available on your current plan.", "ai_not_entitled");

    const result = cleanResult(await callGemini(request));
    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: auth.user.id,
      kind: "interpret",
      input: { request, filters: result.filters },
      status: "completed",
      model: env("GEMINI_MODEL") || "gemini-2.5-flash",
    }).then(() => undefined);

    return res.status(200).json(result);
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(500, "The AI service couldn't complete that action. Please try again.", "unknown");
    if (!(error instanceof ApiError)) console.error("ai-interpret error", error);
    return res.status(apiError.status).json({ error: apiError.message, code: apiError.code });
  }
}
