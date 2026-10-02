import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  OpenAIError,
  getOpenAIModel,
  openAIJson,
} from "./_lib/openai.js";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };
type JsonObject = Record<string, unknown>;

export const maxDuration = 30;

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "ai_error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
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
    } catch {
      throw new ApiError(400, "The AI request wasn't valid JSON.", "invalid_json");
    }
  }
  throw new ApiError(400, "An AI request is required.", "missing_body");
}

function tokenOf(req: VercelRequest) {
  const value = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const token = value?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new ApiError(401, "Your session expired — sign in again.", "auth_missing");
  return token;
}

function userClient(token: string): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!url || !key) throw new ApiError(500, "The AI server isn't connected to Supabase.", "supabase_config");
  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  } catch {
    throw new ApiError(500, "The AI server has invalid Supabase configuration.", "supabase_config");
  }
}

export const INTERPRET_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", description: "The requested business category." },
    location: { type: ["string", "null"], description: "Only the location stated by the user, otherwise null." },
    quantity: { type: ["integer", "null"], description: "The requested quantity, otherwise null." },
    minRating: { type: ["string", "null"], enum: [null, "3", "3.5", "4", "4.5"] },
    priceLevel: { type: ["string", "null"], enum: [null, "1", "2", "3", "4"] },
    businessSize: { type: ["string", "null"], enum: [null, "small", "medium", "enterprise"] },
    requireWebsite: { type: "boolean" },
    requirePhone: { type: "boolean" },
    requireEmail: { type: "boolean" },
    openNow: { type: "boolean" },
    summary: { type: "string" },
    notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "category",
    "location",
    "quantity",
    "minRating",
    "priceLevel",
    "businessSize",
    "requireWebsite",
    "requirePhone",
    "requireEmail",
    "openNow",
    "summary",
    "notes",
  ],
};

const INTERPRET_INSTRUCTIONS = `You turn a user's lead-discovery request into search-form filters.
You only fill the form; you do not run a search, consume quota, create leads, or claim that results were found.
Do not invent requirements. Use null for optional values the user did not request and false for requirements the user did not state.
Only set businessSize to small, medium, or enterprise when the user actually requests that size.
Keep category suitable for a Google Maps business search. Keep summary and notes concise.`;

function explicitlyRequestedBusinessSize(request: string, size: string) {
  const text = request.toLowerCase();
  if (size === "small") return /\bsmall(?:[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized))?\b/.test(text);
  if (size === "medium") return /\bmedium(?:[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized))?\b/.test(text);
  return /\benterprise(?:s)?\b|\blarge[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized)\b/.test(text);
}

export function cleanInterpretResult(raw: JsonObject, request = "") {
  const filters: JsonObject = {};
  if (typeof raw.category === "string" && raw.category.trim()) filters.category = raw.category.trim().slice(0, 80);
  if (typeof raw.location === "string" && raw.location.trim()) filters.location = raw.location.trim().slice(0, 100);
  if (typeof raw.quantity === "number" && Number.isFinite(raw.quantity)) {
    filters.quantity = Math.max(1, Math.min(240, Math.round(raw.quantity)));
  }
  if (typeof raw.minRating === "string" && ["3", "3.5", "4", "4.5"].includes(raw.minRating)) filters.minRating = raw.minRating;
  if (typeof raw.priceLevel === "string" && ["1", "2", "3", "4"].includes(raw.priceLevel)) filters.priceLevel = raw.priceLevel;
  if (
    typeof raw.businessSize === "string" &&
    ["small", "medium", "enterprise"].includes(raw.businessSize) &&
    explicitlyRequestedBusinessSize(request, raw.businessSize)
  ) {
    filters.businessSize = raw.businessSize;
  }
  for (const key of ["requireWebsite", "requirePhone", "requireEmail", "openNow"] as const) {
    if (raw[key] === true) filters[key] = true;
  }
  if (!filters.category) {
    throw new ApiError(502, "Zybble AI couldn't identify a business category. Try rephrasing.", "category_missing");
  }
  return {
    filters,
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 240) : "Search filters prepared.",
    notes: Array.isArray(raw.notes) ? raw.notes.slice(0, 2).map((note) => String(note).slice(0, 160)) : [],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed", code: "method_not_allowed" });
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

    const output = await openAIJson({
      instructions: INTERPRET_INSTRUCTIONS,
      input: `User request: ${request}`,
      schema: INTERPRET_RESPONSE_SCHEMA,
      schemaName: "zybble_search_filters",
      maxOutputTokens: 2_000,
      timeoutMs: 25_000,
    });
    const result = cleanInterpretResult(output, request);
    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: auth.user.id,
      kind: "interpret",
      input: { request, filters: result.filters },
      status: "completed",
      model: getOpenAIModel(),
    }).then(() => undefined);

    return res.status(200).json(result);
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : error instanceof OpenAIError
        ? new ApiError(error.status, error.message, error.code)
        : new ApiError(500, "The AI service couldn't complete that action. Please try again.", "unknown");
    console.error("api request", {
      route: "/api/ai-interpret",
      status: apiError.status,
      code: apiError.code,
      providerCategory: apiError.code.startsWith("provider_") || apiError.code.startsWith("rate_") ? apiError.code : undefined,
      durationMs: Date.now() - startedAt,
    });
    return res.status(apiError.status).json({ error: apiError.message, code: apiError.code });
  }
}
