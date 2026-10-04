// ============================================================================
// /api/admin/* — the single entry point for the Zybble operator console.
//
// WHY ONE CATCH-ALL FUNCTION INSTEAD OF FIFTEEN FILES
// Vercel maps every deployable file under api/ to its own Function, and this
// project's budget is asserted at ≤12 in vercel-routing.test.ts (9 are
// already in use). Fifteen admin routes as fifteen files would blow that
// budget. A catch-all also gives the panel exactly one authorization
// choke-point, which is far easier to audit than fifteen copies of the same
// check.
//
// AUTHORIZATION HAPPENS HERE, BEFORE ANY HANDLER RUNS.
// requireAdmin() validates the Supabase JWT and re-reads profiles.role from
// the database. Only then is the service-role client created and handed to a
// handler. There is no code path that reaches a handler without it.
// ============================================================================
import {
  adminServiceClient,
  requestUrl,
  readBody,
  requireAdmin,
  sendError,
  sendJson,
  AdminError,
  type AdminRequest,
  type AdminResponse,
  type Json,
} from "../_lib/admin-core.js";
import {
  ai,
  auditLogs,
  billing,
  leads,
  overview,
  plans,
  searches,
  settings,
  system,
  usage,
  users,
  webhooks,
  workspaces,
  type Ctx,
} from "../_lib/admin-routes.js";

export const maxDuration = 30;

type Handler = (ctx: Ctx) => Promise<Json>;

/** Resource → handler. `POST` support is decided inside each handler. */
const ROUTES: Record<string, { handler: Handler; mutable: boolean }> = {
  overview: { handler: overview, mutable: false },
  users: { handler: users, mutable: true },
  workspaces: { handler: workspaces, mutable: false },
  billing: { handler: billing, mutable: true },
  plans: { handler: plans, mutable: true },
  searches: { handler: searches, mutable: false },
  leads: { handler: leads, mutable: false },
  usage: { handler: usage, mutable: true },
  ai: { handler: ai, mutable: false },
  webhooks: { handler: webhooks, mutable: false },
  "audit-logs": { handler: auditLogs, mutable: false },
  system: { handler: system, mutable: false },
  settings: { handler: settings, mutable: false },
};

export default async function handler(req: AdminRequest, res: AdminResponse) {
  const method = (req.method ?? "GET").toUpperCase();

  // No CORS headers are emitted on purpose: /api/admin/* is same-origin only.
  // A cross-site page therefore cannot read a response even with a stolen
  // session, and the browser blocks the preflight for a cross-origin POST.
  if (method === "OPTIONS") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Cross-origin admin requests are not allowed.", code: "method_not_allowed" });
  }
  if (method !== "GET" && method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Use GET or POST on an admin endpoint.", code: "method_not_allowed" });
  }

  try {
    const url = requestUrl(req);
    const segments = url.pathname
      .replace(/^\/+/, "")
      .split("/")
      .filter(Boolean);
    // ["api","admin", resource, ...rest]
    const resource = segments[2] ?? "";
    const rest = segments.slice(2);

    const route = ROUTES[resource];
    if (!route) {
      // Authorization is still required before admitting which resources
      // exist — an unauthenticated probe must not be able to enumerate them.
      await requireAdmin(req);
      throw new AdminError(404, "That admin endpoint doesn't exist.", "unknown_endpoint");
    }
    if (method === "POST" && !route.mutable) {
      throw new AdminError(405, "That admin endpoint is read-only.", "read_only");
    }

    const actor = await requireAdmin(req);
    const sb = adminServiceClient();
    const body = method === "POST" ? readBody(req) : {};

    const payload = await route.handler({
      sb,
      actor,
      query: url.searchParams,
      body,
      method,
      segments: rest,
    });

    console.info("admin request", {
      route: `/api/admin/${resource}`,
      method,
      adminId: actor.id,
      status: 200,
    });
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendError(res, error);
  }
}
