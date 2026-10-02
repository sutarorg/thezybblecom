import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & {
  status(code: number): VercelResponse;
  json(body: unknown): void;
};

type JsonObject = Record<string, unknown>;

export const maxDuration = 30;

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
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
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    return req.body as JsonObject;
  }
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject;
    } catch {
      throw new ApiError(400, "The AI request wasn't valid JSON.");
    }
  }
  throw new ApiError(400, "An AI request is required.");
}

function tokenOf(req: VercelRequest) {
  const value = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const token = value?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError(401, "Your session expired — sign in again.");
  return token;
}

function userClient(token: string): SupabaseClient {
  const url = env("SUPABASE_URL", "VITE_SUPABASE_URL");
  const key = env(
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY"
  );
  if (!url || !key) {
    throw new ApiError(500, "The AI server isn't connected to Supabase.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function callGemini(request: string): Promise<JsonObject> {
  const apiKey = env("GEMINI_API_KEY");
  const model = env("GEMINI_MODEL") || "gemini-2.5-flash";
  if (!apiKey) throw new ApiError(500, "Gemini isn't configured on the server.");

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You turn a user's lead-discovery request into search-form filters. Do not invent requirements. You only fill the form; you never claim to run a search. Return concise JSON matching the schema.",
            }],
          },
          contents: [{ role: "user", parts: [{ text: `User request: ${request}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                category: { type: "string" },
                location: { type: "string" },
                quantity: { type: "integer" },
                minRating: { type: "string", enum: ["", "3", "3.5", "4", "4.5"] },
                priceLevel: { type: "string", enum: ["", "1", "2", "3", "4"] },
                requireWebsite: { type: "boolean" },
                requirePhone: { type: "boolean" },
                requireEmail: { type: "boolean" },
                openNow: { type: "boolean" },
                summary: { type: "string" },
                notes: { type: "array", items: { type: "string" } },
              },
              required: ["category", "summary"],
            },
            temperature: 0.15,
            maxOutputTokens: 512,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
  } catch {
    throw new ApiError(502, "The AI service couldn't be reached — try again in a moment.");
  }

  const payload = (await response.json().catch(() => ({}))) as JsonObject;
  if (!response.ok) {
    const error = payload.error as JsonObject | undefined;
    const providerMessage = typeof error?.message === "string" ? error.message.toLowerCase() : "";
    if (response.status === 400 && providerMessage.includes("api key")) {
      throw new ApiError(502, "The Gemini API key was rejected. Update GEMINI_API_KEY.");
    }
    if (response.status === 429) throw new ApiError(429, "Zybble AI is busy — try again shortly.");
    throw new ApiError(502, "The AI service couldn't complete that request — try again.");
  }

  const candidates = payload.candidates as JsonObject[] | undefined;
  const content = candidates?.[0]?.content as JsonObject | undefined;
  const parts = content?.parts as JsonObject[] | undefined;
  const text = parts?.[0]?.text;
  if (typeof text !== "string" || !text) {
    throw new ApiError(502, "The AI service returned an empty response.");
  }
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    throw new ApiError(502, "The AI service returned malformed data.");
  }
}

function cleanResult(raw: JsonObject) {
  const filters: JsonObject = {};
  if (typeof raw.category === "string" && raw.category.trim()) filters.category = raw.category.trim().slice(0, 80);
  if (typeof raw.location === "string" && raw.location.trim()) filters.location = raw.location.trim().slice(0, 80);
  if (typeof raw.quantity === "number" && Number.isFinite(raw.quantity)) {
    filters.quantity = Math.max(1, Math.min(240, Math.round(raw.quantity)));
  }
  if (typeof raw.minRating === "string" && ["3", "3.5", "4", "4.5"].includes(raw.minRating)) filters.minRating = raw.minRating;
  if (typeof raw.priceLevel === "string" && ["1", "2", "3", "4"].includes(raw.priceLevel)) filters.priceLevel = raw.priceLevel;
  for (const key of ["requireWebsite", "requirePhone", "requireEmail", "openNow"] as const) {
    if (raw[key] === true) filters[key] = true;
  }
  if (!filters.category) throw new ApiError(502, "Zybble AI couldn't identify a business category. Try rephrasing.");
  return {
    filters,
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 240) : "Search filters prepared.",
    notes: Array.isArray(raw.notes) ? raw.notes.slice(0, 2).map((note) => String(note).slice(0, 160)) : [],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = bodyOf(req);
    const workspaceId = String(body.workspaceId ?? "");
    const request = String(body.request ?? "").trim();
    if (!workspaceId) throw new ApiError(400, "workspaceId is required");
    if (request.length < 3) throw new ApiError(400, "Describe what you're looking for.");
    if (request.length > 400) throw new ApiError(400, "Keep the request under 400 characters.");

    const token = tokenOf(req);
    const sb = userClient(token);
    const { data: auth, error: authError } = await sb.auth.getUser(token);
    if (authError || !auth.user) throw new ApiError(401, "Your session expired — sign in again.");

    const { data: membership, error: membershipError } = await sb
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (membershipError || !membership) throw new ApiError(403, "You don't have access to that workspace.");

    const { data: subscription } = await sb
      .from("subscriptions")
      .select("plan_id, status")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    const planId = subscription && ["active", "trialing"].includes(subscription.status)
      ? subscription.plan_id
      : "free";
    const { data: plan } = await sb.from("plans").select("has_ai").eq("id", planId).maybeSingle();
    if (plan?.has_ai === false) throw new ApiError(403, "Zybble AI isn't available on your current plan.");

    const result = cleanResult(await callGemini(request));
    // Telemetry must never turn a successful interpretation into a user error.
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
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError
      ? error.message
      : "The AI service couldn't complete that action. Please try again.";
    return res.status(status).json({ error: message });
  }
}
