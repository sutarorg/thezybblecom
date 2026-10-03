// ============================================================================
// ai-interpret — authorization, usage accounting, and the DeepSeek V3.2
// interpretation itself, all server-side (Supabase Edge twin of
// /api/ai-interpret, sharing the same response contract).
//
// The interpretation runs here through OpenRouter's server-side API
// (OPENROUTER_API_KEY), keeping every guarantee the gate always had, in the
// same order: the caller's session, workspace membership, plan entitlement,
// the (validated, clamped) interpretation, and one ai_requests usage row.
// It never calls SerpApi, writes leads, or consumes lead quota.
// ============================================================================
import {
  HttpError,
  INTERPRET_SYSTEM_PROMPT,
  OPENROUTER_MODEL,
  callerFromRequest,
  cleanInterpretResult,
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
  throw new HttpError(
    502,
    sawCategoryMissing
      ? "Zybble AI couldn't identify a business category. Try rephrasing."
      : "Zybble AI couldn't turn that into filters. Try rephrasing.",
    sawCategoryMissing ? "category_missing" : "malformed_response",
  );
}

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

    // The interpretation itself — server-side, so the browser never touches an
    // OpenRouter credential or third-party sign-in flow.
    const interpretation = await interpretWithAi(request);

    // Usage accounting: one row per completed interpretation, attributed to
    // the workspace/user, tagged with the model that produced it.
    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      kind: "interpret",
      input: { request },
      status: "completed",
      model: OPENROUTER_MODEL,
    });

    return json({ ok: true, model: OPENROUTER_MODEL, ...interpretation });
  } catch (e) {
    return handleError(e, { functionName: "ai-interpret", startedAt });
  }
});
