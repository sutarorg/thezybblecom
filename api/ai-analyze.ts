// ============================================================================
// ai-analyze — OpenAI-powered lead intelligence (cached per lead).
// Vercel twin of the Supabase Edge Function supabase/functions/ai-analyze:
// same request/response contract, but running on the same-origin /api route
// where OPENAI_API_KEY lives on Vercel deployments. All database access runs
// with the caller's bearer token so RLS stays the security boundary.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getOpenAIModel, openAIJson, OpenAIError } from "./_lib/openai.js";
import {
  createUserSupabaseClient,
  requireSupabaseServerConfig,
  SupabaseServerConfigError,
} from "./_lib/supabase-server.js";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };
type Json = Record<string, unknown>;

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

const ANALYZE_SYSTEM = `You are Zybble's lead analyst. You interpret ONLY the structured public business data you're given and write plain, useful, honest observations for a salesperson.
Rules:
- Never invent facts. When information is missing (e.g. no email), say it's unavailable.
- 3-5 short observations: local presence, review activity, contactability, and one honest outreach angle.
- Be concrete but skeptical. Mark uncertainty.`;

const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "One concise sentence about this lead." },
    points: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 5,
      description: "Honest observations grounded only in the supplied business record.",
    },
    outreach_angle: { type: "string", description: "One cautious, data-grounded outreach angle." },
  },
  required: ["summary", "points", "outreach_angle"],
};

function bodyOf(req: VercelRequest): Json {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body as Json;
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed", code: "method_not_allowed" });
  }

  try {
    // Authenticate before validating the payload so unauthenticated probes
    // always see 401 rather than request-shape details.
    const token = tokenOf(req);
    const sb = userClient(token);

    const body = bodyOf(req);
    const leadId = String(body.leadId ?? "");
    const workspaceId = String(body.workspaceId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw new ApiError(400, "A valid lead is required.", "lead_invalid");
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new ApiError(400, "A valid workspace is required.", "workspace_invalid");
    const refresh = body.refresh === true;

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

    // Authorize the lead's workspace before reading a cached insight. Looking
    // up ai_insights by lead_id first would let a member of one workspace
    // receive cached analysis for a lead in another workspace.
    const { data: lead, error: leadError } = await sb
      .from("leads")
      .select(
        "name, category, categories, rating, reviews, website, website_domain, email, phone, address, city, state, open_state, hours_display, services, amenities, price_level"
      )
      .eq("id", leadId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (leadError || !lead) throw new ApiError(404, "This lead doesn't exist.", "lead_not_found");

    const model = getOpenAIModel();
    const { data: cached } = await sb
      .from("ai_insights")
      .select("summary, points, model, created_at")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (cached && cached.model === model && !refresh) {
      const cachedPoints = Array.isArray(cached.points) ? cached.points : [];
      return res.status(200).json({
        ...cached,
        outreach_angle: cachedPoints.length ? String(cachedPoints[cachedPoints.length - 1]) : "",
        cached: true,
      });
    }

    const out = await openAIJson({
      instructions: ANALYZE_SYSTEM,
      input: `Analyze this public business record:\n${JSON.stringify(lead, null, 2)}`,
      schema: ANALYSIS_SCHEMA,
      schemaName: "zybble_lead_analysis",
      maxOutputTokens: 2_500,
      timeoutMs: 25_000,
    });

    const summary = typeof out.summary === "string" ? out.summary.trim().slice(0, 500) : "";
    const observations = Array.isArray(out.points)
      ? out.points.slice(0, 5).map((point) => String(point).trim().slice(0, 300)).filter(Boolean)
      : [];
    const outreachAngle = typeof out.outreach_angle === "string" ? out.outreach_angle.trim().slice(0, 300) : "";
    if (!summary || observations.length === 0 || !outreachAngle) {
      // Never return a successful response with blank analysis output.
      throw new ApiError(502, "Zybble AI returned incomplete analysis. Please try again.", "malformed_response");
    }
    // Keep the existing UI behavior: the outreach angle is the final displayed point.
    const points = [...observations, outreachAngle];

    const { error: insightError } = await sb.from("ai_insights").upsert(
      {
        lead_id: leadId,
        user_id: auth.user.id,
        summary,
        points,
        model,
      },
      { onConflict: "lead_id" }
    );
    if (insightError) {
      console.error("api request", { route: "/api/ai-analyze", status: 500, code: "insight_save_failed", durationMs: Date.now() - startedAt });
    }

    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: auth.user.id,
      kind: "analyze",
      input: { lead_id: leadId },
      status: "completed",
      model,
    }).then(() => undefined);

    // Preserve the existing monthly AI usage counter behavior via the
    // security-definer RPC (usage_counters itself is not writable by users).
    await sb.rpc("increment_usage_counter", { ws: workspaceId, metric: "ai_runs", delta: 1 }).then(() => undefined);

    return res.status(200).json({ summary, points, outreach_angle: outreachAngle, model, cached: false });
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : error instanceof SupabaseServerConfigError
        ? new ApiError(error.status, error.message, error.code)
        : error instanceof OpenAIError
          ? new ApiError(error.status, error.message, error.code)
          : new ApiError(500, "The AI service couldn't complete that action. Please try again.", "unknown");
    console.error("api request", {
      route: "/api/ai-analyze",
      status: apiError.status,
      code: apiError.code,
      providerCategory: apiError.code.startsWith("provider_") || apiError.code.startsWith("rate_") || apiError.code === "model_invalid" ? apiError.code : undefined,
      durationMs: Date.now() - startedAt,
    });
    return res.status(apiError.status).json({ error: apiError.message, code: apiError.code });
  }
}
