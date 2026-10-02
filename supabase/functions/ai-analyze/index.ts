// ============================================================================
// ai-analyze — OpenAI-powered lead intelligence (cached per lead).
// ============================================================================
import {
  ANALYZE_SYSTEM,
  HttpError,
  OPENAI_MODEL,
  callerFromRequest,
  corsHeaders,
  errorJson,
  getEntitlements,
  handleError,
  json,
  openAIJson,
  requireWorkspaceRole,
  serviceClient,
} from "../_shared/index.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("Method not allowed", 405, "method_not_allowed");

  try {
    const sb = serviceClient();
    const body = await req.json().catch(() => ({}));
    const leadId = String(body.leadId ?? "");
    const workspaceId = String(body.workspaceId ?? "");
    if (!leadId || !workspaceId) throw new HttpError(400, "leadId and workspaceId are required", "invalid_request");

    const user = await callerFromRequest(req, sb);
    await requireWorkspaceRole(sb, user.id, workspaceId);

    const entitlements = await getEntitlements(sb, user.id);
    if (!entitlements.allowances.ai) {
      throw new HttpError(403, "Zybble AI isn't available on your current plan.", "ai_not_entitled");
    }

    const { data: cached } = await sb
      .from("ai_insights")
      .select("summary, points, model, created_at")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (cached && cached.model === OPENAI_MODEL && !body.refresh) {
      const cachedPoints = Array.isArray(cached.points) ? cached.points : [];
      return json({
        ...cached,
        outreach_angle: cachedPoints.length ? String(cachedPoints[cachedPoints.length - 1]) : "",
        cached: true,
      });
    }

    const { data: lead, error: leadErr } = await sb
      .from("leads")
      .select(
        "name, category, categories, rating, reviews, website, website_domain, email, phone, address, city, state, open_state, hours_display, services, amenities, price_level"
      )
      .eq("id", leadId)
      .eq("workspace_id", workspaceId)
      .single();
    if (leadErr || !lead) throw new HttpError(404, "This lead doesn't exist.", "lead_not_found");

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
      throw new HttpError(502, "Zybble AI returned incomplete analysis. Please try again.", "malformed_response");
    }
    // Keep the existing UI behavior: the outreach angle is the final displayed point.
    const points = [...observations, outreachAngle];

    await sb.from("ai_insights").upsert(
      {
        lead_id: leadId,
        user_id: user.id,
        summary,
        points,
        model: OPENAI_MODEL,
      },
      { onConflict: "lead_id" }
    );

    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      kind: "analyze",
      input: { lead_id: leadId },
      status: "completed",
      model: OPENAI_MODEL,
    });

    // Preserve the existing monthly AI usage counter behavior.
    const period = new Date();
    period.setDate(1);
    await sb
      .from("usage_counters")
      .upsert(
        { workspace_id: workspaceId, period_start: period.toISOString().slice(0, 10) },
        { onConflict: "workspace_id,period_start" }
      );
    const { data: counter } = await sb
      .from("usage_counters")
      .select("ai_runs")
      .eq("workspace_id", workspaceId)
      .eq("period_start", period.toISOString().slice(0, 10))
      .single();
    await sb
      .from("usage_counters")
      .update({ ai_runs: (counter?.ai_runs ?? 0) + 1 })
      .eq("workspace_id", workspaceId)
      .eq("period_start", period.toISOString().slice(0, 10));

    return json({ summary, points, outreach_angle: outreachAngle, model: OPENAI_MODEL, cached: false });
  } catch (e) {
    return handleError(e);
  }
});
