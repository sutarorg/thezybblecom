// ============================================================================
// ai-interpret — turns a plain-language request into SEARCH FILTERS ONLY.
// It never calls SerpApi, never writes leads, never consumes lead quota.
// The user reviews the filters and runs the search explicitly.
// ============================================================================
import {
  HttpError,
  INTERPRET_SYSTEM,
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

const MAX_LEADS = 240;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  try {
    const sb = serviceClient();
    const body = await req.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId ?? "");
    const request = String(body.request ?? "").trim();

    if (!workspaceId) throw new HttpError(400, "workspaceId is required");
    if (request.length < 3) throw new HttpError(400, "Describe what you're looking for.");
    if (request.length > 400) throw new HttpError(400, "Keep the request under 400 characters.");

    const user = await callerFromRequest(req, sb);
    await requireWorkspaceRole(sb, user.id, workspaceId);

    const entitlements = await getEntitlements(sb, user.id);
    if (!entitlements.allowances.ai) {
      throw new HttpError(403, "Zybble AI isn't available on your current plan.");
    }

    const out = await geminiJson({
      system: `${INTERPRET_SYSTEM}
You are filling in a search FORM, not running a search.
Only set a field when the user actually implied it; leave the rest out.
summary: one short sentence describing what you filled in.
notes: up to 2 short caveats or suggestions (optional).`,
      prompt: `User request: ${request}`,
      schema: {
        type: "object",
        properties: {
          category: { type: "string", description: "Business type, e.g. 'dentists'." },
          location: { type: "string", description: "City/region text, or omit." },
          quantity: { type: "integer", description: "1-240" },
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
      },
      maxOutputTokens: 512,
    });

    // Validate + clamp everything before it reaches the UI.
    const filters: Record<string, unknown> = {};
    if (typeof out.category === "string" && out.category.trim()) filters.category = out.category.trim().slice(0, 80);
    if (typeof out.location === "string" && out.location.trim()) filters.location = out.location.trim().slice(0, 80);
    if (typeof out.quantity === "number" && Number.isFinite(out.quantity)) {
      filters.quantity = Math.max(1, Math.min(MAX_LEADS, Math.round(out.quantity)));
    }
    if (typeof out.minRating === "string" && ["3", "3.5", "4", "4.5"].includes(out.minRating)) {
      filters.minRating = out.minRating;
    }
    if (typeof out.priceLevel === "string" && ["1", "2", "3", "4"].includes(out.priceLevel)) {
      filters.priceLevel = out.priceLevel;
    }
    if (typeof out.businessSize === "string" && ["small", "medium", "enterprise"].includes(out.businessSize)) {
      filters.businessSize = out.businessSize;
    }
    if (out.requireWebsite === true) filters.requireWebsite = true;
    if (out.requirePhone === true) filters.requirePhone = true;
    if (out.requireEmail === true) filters.requireEmail = true;
    if (out.openNow === true) filters.openNow = true;

    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      kind: "interpret",
      input: { request, filters },
      status: "completed",
      model: GEMINI_MODEL,
    });

    return json({
      filters,
      summary: typeof out.summary === "string" ? out.summary.slice(0, 240) : "",
      notes: Array.isArray(out.notes) ? out.notes.slice(0, 2).map((n) => String(n).slice(0, 160)) : [],
    });
  } catch (e) {
    return handleError(e);
  }
});
