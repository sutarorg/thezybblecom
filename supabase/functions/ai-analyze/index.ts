// ============================================================================
// ai-analyze — Gemini-powered lead intelligence (cached per lead).
// ============================================================================
import {
  ANALYZE_SYSTEM,
  HttpError,
  callerFromRequest,
  corsHeaders,
  errorJson,
  geminiJson,
  getEntitlements,
  handleError,
  json,
  requireWorkspaceRole,
  serviceClient,
  GEMINI_MODEL,
} from "../_shared/index.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  try {
    const sb = serviceClient();
    const body = await req.json().catch(() => ({}));
    const leadId = String(body.leadId ?? "");
    const workspaceId = String(body.workspaceId ?? "");
    if (!leadId || !workspaceId) throw new HttpError(400, "leadId and workspaceId are required");

    const user = await callerFromRequest(req, sb);
    await requireWorkspaceRole(sb, user.id, workspaceId);

    const entitlements = await getEntitlements(sb, user.id);
    if (!entitlements.allowances.ai) {
      throw new HttpError(403, "Zybble AI is included on Growth, Agency, and Scale.");
    }

    // cached insight first
    const { data: cached } = await sb
      .from("ai_insights")
      .select("summary, points, model, created_at")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (cached && !body.refresh) {
      return json({ ...cached, cached: true });
    }

    const { data: lead, error: leadErr } = await sb
      .from("leads")
      .select(
        "name, category, categories, rating, reviews, website, website_domain, email, phone, address, city, state, open_state, hours_display, services, amenities, price_level"
      )
      .eq("id", leadId)
      .eq("workspace_id", workspaceId)
      .single();
    if (leadErr || !lead) throw new HttpError(404, "This lead doesn't exist.");

    const prompt = `Analyze this business record:\n${JSON.stringify(lead, null, 2)}`;

    const out = await geminiJson({
      system: ANALYZE_SYSTEM,
      prompt,
      schema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "One sentence about this lead." },
          points: {
            type: "array",
            items: { type: "string" },
            description: "3-5 short observations.",
          },
          outreach_angle: { type: "string" },
        },
        required: ["summary", "points"],
      },
      maxOutputTokens: 512,
    });

    const summary = String(out.summary ?? "");
    const points = Array.isArray(out.points) ? out.points.map(String) : [];
    if (out.outreach_angle) points.push(String(out.outreach_angle));

    await sb.from("ai_insights").upsert(
      {
        lead_id: leadId,
        user_id: user.id,
        summary,
        points,
        model: GEMINI_MODEL,
      },
      { onConflict: "lead_id" }
    );

    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      kind: "analyze",
      input: { lead_id: leadId },
      status: "completed",
      model: GEMINI_MODEL,
    });

    // bump AI counter
    const period = new Date();
    period.setDate(1);
    await sb.rpc("noop", {}).then(() => null).catch(() => null);
    await sb
      .from("usage_counters")
      .upsert(
        {
          workspace_id: workspaceId,
          period_start: period.toISOString().slice(0, 10),
        },
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

    return json({ summary, points, model: GEMINI_MODEL, cached: false });
  } catch (e) {
    return handleError(e);
  }
});
