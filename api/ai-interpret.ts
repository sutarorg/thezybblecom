import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  INTERPRET_SYSTEM_PROMPT,
  cleanInterpretResult,
  extractJsonObject,
} from "./_lib/interpret.js";
import { OpenRouterError, getOpenRouterModel, openRouterChatJson } from "./_lib/openrouter.js";
import {
  createUserSupabaseClient,
  requireSupabaseServerConfig,
  SupabaseServerConfigError,
} from "./_lib/supabase-server.js";

/**
 * Zybble AI interpretation — authorization, usage accounting, and the
 * DeepSeek V3.2 interpretation itself, all server-side.
 *
 * The interpretation runs here through OpenRouter's server-side API
 * (OPENROUTER_API_KEY, OpenAI-compatible chat completions), keeping every
 * guarantee the gate always had, in the same order:
 *
 *   1. the caller's Supabase session,
 *   2. workspace membership (workspace authorization),
 *   3. plan entitlement (plans.has_ai),
 *   4. the AI interpretation (validated and clamped server-side),
 *   5. one ai_requests usage row per completed interpretation.
 *
 * It never runs a search, consumes lead quota, or creates leads — the
 * response only fills the filter form, and the user presses "Find leads".
 */
type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };

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

function bodyOf(req: VercelRequest): Record<string, unknown> {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body as Record<string, unknown>;
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
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
  // Server-side Supabase configuration (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY,
  // legacy SUPABASE_ANON_KEY fallback). Browser VITE_* values never reach here;
  // see api/_lib/supabase-server.ts. The caller's bearer token is forwarded so
  // RLS keeps evaluating as the signed-in user.
  const config = requireSupabaseServerConfig("AI");
  return createUserSupabaseClient(config, token, { serverLabel: "AI" });
}

/**
 * DeepSeek V3.2 (via the server-side OpenRouter integration) turns the
 * request into filters. One silent retry when the reply isn't usable JSON;
 * the result is fully validated and clamped before it ever reaches the
 * client.
 */
async function interpretWithAi(request: string) {
  let sawCategoryMissing = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const system =
      attempt === 0
        ? INTERPRET_SYSTEM_PROMPT
        : `${INTERPRET_SYSTEM_PROMPT}\nYour previous reply was not usable. Respond with the JSON object only, and always include a non-empty "category".`;
    const text = await openRouterChatJson({
      messages: [
        { role: "system", content: system },
        { role: "user", content: `User request: ${request}` },
      ],
      maxOutputTokens: 900,
      timeoutMs: 25_000,
    });
    const parsed = extractJsonObject(text);
    if (!parsed) continue;
    const cleaned = cleanInterpretResult(parsed, request);
    if (cleaned) return cleaned;
    sawCategoryMissing = true;
  }
  throw new ApiError(
    502,
    sawCategoryMissing
      ? "Zybble AI couldn't identify a business category. Try rephrasing."
      : "Zybble AI couldn't turn that into filters. Try rephrasing.",
    sawCategoryMissing ? "category_missing" : "malformed_response",
  );
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

    // The interpretation itself — server-side, so the browser never touches an
    // OpenRouter credential or third-party sign-in flow.
    const interpretation = await interpretWithAi(request);
    const model = getOpenRouterModel();

    // Usage accounting: one row per completed interpretation, attributed to
    // the workspace/user, tagged with the model that produced it.
    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: auth.user.id,
      kind: "interpret",
      input: { request },
      status: "completed",
      model,
    }).then(() => undefined);

    return res.status(200).json({ ok: true, model, ...interpretation });
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : error instanceof SupabaseServerConfigError
        ? new ApiError(error.status, error.message, error.code)
        : error instanceof OpenRouterError
          ? new ApiError(error.status, error.message, error.code)
          : new ApiError(500, "The AI service couldn't complete that action. Please try again.", "unknown");
    console.error("api request", {
      route: "/api/ai-interpret",
      status: apiError.status,
      code: apiError.code,
      providerCategory: apiError.code.startsWith("provider_") || apiError.code.startsWith("rate_") || apiError.code === "model_invalid" ? apiError.code : undefined,
      durationMs: Date.now() - startedAt,
    });
    return res.status(apiError.status).json({ error: apiError.message, code: apiError.code });
  }
}
