// ============================================================================
// ai-interpret — turns a plain-language request into SEARCH FILTERS ONLY.
// It never calls SerpApi, writes leads, or consumes lead quota.
// ============================================================================
import {
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

const MAX_LEADS = 240;

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string" },
    location: { type: ["string", "null"] },
    quantity: { type: ["integer", "null"] },
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
    "category", "location", "quantity", "minRating", "priceLevel", "businessSize",
    "requireWebsite", "requirePhone", "requireEmail", "openNow", "summary", "notes",
  ],
};

function explicitlyRequestedBusinessSize(request: string, size: string) {
  const text = request.toLowerCase();
  if (size === "small") return /\bsmall(?:[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized))?\b/.test(text);
  if (size === "medium") return /\bmedium(?:[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized))?\b/.test(text);
  return /\benterprise(?:s)?\b|\blarge[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized)\b/.test(text);
}

const INTERPRET_SYSTEM = `You are Zybble's search interpreter for a B2B lead-discovery tool.
Never invent businesses, facts, or requirements. You only structure the user's request into search filters.`;

const INSTRUCTIONS = `${INTERPRET_SYSTEM}
You are filling in a search form, not running a search.
Use null for optional values the user did not request and false for requirements the user did not state.
Only set businessSize when the user actually asks for small, medium, or enterprise businesses.
summary is one short sentence. notes contains at most two short caveats or suggestions.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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

    const out = await openAIJson({
      instructions: INSTRUCTIONS,
      input: `User request: ${request}`,
      schema: RESPONSE_SCHEMA,
      schemaName: "zybble_search_filters",
      maxOutputTokens: 2_000,
      timeoutMs: 25_000,
    });

    // Validate and clamp every model-produced value before it reaches the UI.
    const filters: Record<string, unknown> = {};
    if (typeof out.category === "string" && out.category.trim()) filters.category = out.category.trim().slice(0, 80);
    if (typeof out.location === "string" && out.location.trim()) filters.location = out.location.trim().slice(0, 80);
    if (typeof out.quantity === "number" && Number.isFinite(out.quantity)) {
      filters.quantity = Math.max(1, Math.min(MAX_LEADS, Math.round(out.quantity)));
    }
    if (typeof out.minRating === "string" && ["3", "3.5", "4", "4.5"].includes(out.minRating)) filters.minRating = out.minRating;
    if (typeof out.priceLevel === "string" && ["1", "2", "3", "4"].includes(out.priceLevel)) filters.priceLevel = out.priceLevel;
    if (
      typeof out.businessSize === "string" &&
      ["small", "medium", "enterprise"].includes(out.businessSize) &&
      explicitlyRequestedBusinessSize(request, out.businessSize)
    ) {
      filters.businessSize = out.businessSize;
    }
    if (out.requireWebsite === true) filters.requireWebsite = true;
    if (out.requirePhone === true) filters.requirePhone = true;
    if (out.requireEmail === true) filters.requireEmail = true;
    if (out.openNow === true) filters.openNow = true;
    if (!filters.category) throw new HttpError(502, "Zybble AI couldn't identify a business category. Try rephrasing.", "category_missing");

    await sb.from("ai_requests").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      kind: "interpret",
      input: { request, filters },
      status: "completed",
      model: OPENAI_MODEL,
    });

    return json({
      filters,
      summary: typeof out.summary === "string" ? out.summary.slice(0, 240) : "Search filters prepared.",
      notes: Array.isArray(out.notes) ? out.notes.slice(0, 2).map((n) => String(n).slice(0, 160)) : [],
    });
  } catch (e) {
    return handleError(e);
  }
});
