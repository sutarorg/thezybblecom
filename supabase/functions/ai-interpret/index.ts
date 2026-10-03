// ============================================================================
// ai-interpret — authorization + usage gate for Zybble AI interpretation.
//
// The interpretation itself runs in the browser through Puter.js
// (deepseek/deepseek-v3.2), so this function performs no AI-provider call
// and reads no provider key. It keeps the server-side guarantees the flow
// always had, in the same order: the caller's session, workspace
// membership, plan entitlement, and one ai_requests usage row.
// It never calls SerpApi, writes leads, or consumes lead quota.
// ============================================================================
import {
  HttpError,
  callerFromRequest,
  corsHeaders,
  errorJson,
  getEntitlements,
  handleError,
  json,
  requireWorkspaceRole,
  serviceClient,
} from "../_shared/index.ts";

/** Model used by the client-side Puter.js interpretation; recorded with usage. */
const INTERPRET_MODEL = "deepseek/deepseek-v3.2";

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method !== "POST") return errorJson("Method not allowed", 405, "method_not_allowed");

  try {
    const sb = serviceClient();
    const body = await req.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId ?? "");
    const request = String(body.request ?? "").trim();

    if (!workspaceId) throw new HttpError(400, "workspaceId is required", "workspace_required");
    if (request.length < 3) throw new HttpError(400, "Describe what you're looking for.", "request_short");
    if (request.length > 400) throw new HttpError(400, "Keep the request under 400 characters.", "request_long");

    const user = await callerFromRequest(req, sb);
    await requireWorkspaceRole(sb, user.id, workspaceId);

    const entitlements = await getEntitlements(sb, user.id);
    if (!entitlements.allowances.ai) {
      throw new HttpError(403, "Zybble AI isn't available on your current plan.", "ai_not_entitled");
    }

    // Usage accounting: one row per authorized interpretation, attributed to
    // the workspace/user, tagged with the client-side model. The filter
    // values are produced in the browser after this gate returns.
    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      kind: "interpret",
      input: { request },
      status: "completed",
      model: INTERPRET_MODEL,
    });

    return json({ ok: true, model: INTERPRET_MODEL });
  } catch (e) {
    return handleError(e, { functionName: "ai-interpret", startedAt });
  }
});
