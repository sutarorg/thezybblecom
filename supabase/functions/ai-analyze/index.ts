// ============================================================================
// ai-analyze — DeepSeek-powered lead intelligence (cached per lead).
// Supabase Edge twin of /api/ai-analyze: same request/response contract.
//
// The analysis runs on the same provider as every other Zybble AI surface —
// DeepSeek V3.2 through OpenRouter's server-side API (OPENROUTER_API_KEY,
// mirrored in _shared/openrouter.ts) — so no other AI dependency remains in
// this path.
// ============================================================================
import {
  ANALYZE_SYSTEM,
  HttpError,
  OPENROUTER_MODEL,
  callerFromRequest,
  corsHeaders,
  errorJson,
  extractJsonObject,
  getEntitlements,
  handleError,
  json,
  openRouterChatJson,
  requireWorkspaceRole,
  serviceClient,
} from "../_shared/index.ts";

/**
 * DeepSeek V3.2 (via the server-side OpenRouter integration) analyzes the
 * record. One silent retry when the reply isn't usable JSON; the provider's
 * output is validated field-by-field before it can reach the response.
 */
async function analyzeWithAi(lead: unknown): Promise<{ summary: string; observations: string[]; outreachAngle: string }> {
  let sawMalformed = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const system =
      attempt === 0
        ? ANALYZE_SYSTEM
        : `${ANALYZE_SYSTEM}\nYour previous reply was not usable. Respond with the JSON object only, with a non-empty "summary", 3-5 "points", and a non-empty "outreach_angle".`;
    const text = await openRouterChatJson({
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Analyze this public business record:\n${JSON.stringify(lead, null, 2)}` },
      ],
      maxOutputTokens: 2_500,
      timeoutMs: 25_000,
    });
    const out = extractJsonObject(text);
    if (!out) {
      sawMalformed = true;
      continue;
    }
    const summary = typeof out.summary === "string" ? out.summary.trim().slice(0, 500) : "";
    const observations = Array.isArray(out.points)
      ? out.points.slice(0, 5).map((point) => String(point).trim().slice(0, 300)).filter(Boolean)
      : [];
    const outreachAngle = typeof out.outreach_angle === "string" ? out.outreach_angle.trim().slice(0, 300) : "";
    if (summary && observations.length > 0 && outreachAngle) {
      return { summary, observations, outreachAngle };
    }
    sawMalformed = true;
  }
  throw new HttpError(502, "Zybble AI returned incomplete analysis. Please try again.", "malformed_response");
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // Authorize the lead's workspace before reading a cached insight. Looking
    // up ai_insights by lead_id first would let a member of one workspace
    // receive cached analysis for a lead in another workspace.
    const { data: lead, error: leadErr } = await sb
      .from("leads")
      .select(
        "name, category, categories, rating, reviews, website, website_domain, email, phone, address, city, state, open_state, hours_display, services, amenities, price_level"
      )
      .eq("id", leadId)
      .eq("workspace_id", workspaceId)
      .single();
    if (leadErr || !lead) throw new HttpError(404, "This lead doesn't exist.", "lead_not_found");

    const { data: cached } = await sb
      .from("ai_insights")
      .select("summary, points, model, created_at")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (cached && cached.model === OPENROUTER_MODEL && !body.refresh) {
      const cachedPoints = Array.isArray(cached.points) ? cached.points : [];
      return json({
        ...cached,
        outreach_angle: cachedPoints.length ? String(cachedPoints[cachedPoints.length - 1]) : "",
        cached: true,
      });
    }

    const { summary, observations, outreachAngle } = await analyzeWithAi(lead);
    // Keep the existing UI behavior: the outreach angle is the final displayed point.
    const points = [...observations, outreachAngle];

    await sb.from("ai_insights").upsert(
      {
        lead_id: leadId,
        user_id: user.id,
        summary,
        points,
        model: OPENROUTER_MODEL,
      },
      { onConflict: "lead_id" }
    );

    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      kind: "analyze",
      input: { lead_id: leadId },
      status: "completed",
      model: OPENROUTER_MODEL,
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

    return json({ summary, points, outreach_angle: outreachAngle, model: OPENROUTER_MODEL, cached: false });
  } catch (e) {
    return handleError(e, { functionName: "ai-analyze", startedAt });
  }
});
