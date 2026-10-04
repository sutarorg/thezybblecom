// ============================================================================
// /api/admin/* — the single privileged endpoint behind the Zybble admin
// console.
//
// One deployable function serves the whole console. vercel.json rewrites
// `/api/admin/:path*` here and passes the tail as `?path=`, so the Vercel
// function budget stays untouched while the browser still talks to clean,
// readable URLs like `/api/admin/users/<id>`.
//
// EVERY request — read or write — goes through requireAdmin() first: the
// Supabase session is verified server-side and `profiles.role` is re-read
// from the database. Only after that does a privileged client touch any data.
// Mutations additionally require a reason and write an immutable audit row.
//
// Nothing secret ever crosses this boundary: responses carry sanitized rows
// and presence booleans ("Razorpay is configured"), never keys, tokens or raw
// provider payloads.
// ============================================================================
import {
  AdminApiError,
  adminPathSegments,
  adminQuery,
  jsonBody,
  notFound,
  requireAdmin,
  respondWithError,
  type AdminContext,
  type VercelRequest,
  type VercelResponse,
} from "./_lib/admin-core.js";
import * as read from "./_lib/admin-read.js";
import {
  overrideUsage,
  setUserRole,
  setUserSuspension,
  syncSubscription,
  updatePlan,
} from "./_lib/admin-actions.js";

export const maxDuration = 30;

function methodNotAllowed(allowed: string): AdminApiError {
  return new AdminApiError(405, `Use ${allowed} for that admin endpoint.`, "method_not_allowed");
}

/* ------------------------------------------------------------------ */
/* Read routes                                                         */
/* ------------------------------------------------------------------ */
async function handleGet(ctx: AdminContext, segments: string[], params: URLSearchParams) {
  const [section, id, action] = segments;

  switch (section) {
    case undefined:
    case "me":
      // Cheap identity probe. The admin shell calls this before rendering, so
      // access is proven by the server rather than by a client flag.
      return {
        id: ctx.user.id,
        email: ctx.adminEmail,
        name: ctx.adminName,
        role: "admin" as const,
        serverTime: new Date().toISOString(),
      };
    case "overview":
      return read.overview(ctx, params);
    case "users":
      return id ? read.userDetail(ctx, id) : read.users(ctx, params);
    case "workspaces":
      return id ? read.workspaceDetail(ctx, id) : read.workspaces(ctx, params);
    case "billing":
      return read.billing(ctx, params);
    case "plans":
      return read.plans(ctx);
    case "searches":
      return id ? read.searchDetail(ctx, id) : read.searches(ctx, params);
    case "leads":
      return read.leads(ctx, params);
    case "usage":
      return read.usage(ctx, params);
    case "ai":
      return read.ai(ctx, params);
    case "webhooks":
      return id ? read.webhookDetail(ctx, id) : read.webhooks(ctx, params);
    case "audit-logs":
      return read.auditLogs(ctx, params);
    case "system":
      return read.system(ctx, params);
    case "settings":
      return read.settings(ctx);
    default:
      throw notFound(`/${[section, id, action].filter(Boolean).join("/")}`);
  }
}

/* ------------------------------------------------------------------ */
/* Write routes                                                        */
/* ------------------------------------------------------------------ */
async function handleWrite(
  ctx: AdminContext,
  method: string,
  segments: string[],
  body: Record<string, unknown>,
) {
  const [section, id, action] = segments;

  if (section === "users" && id && action === "role") {
    if (method !== "POST") throw methodNotAllowed("POST");
    return setUserRole(ctx, id, body);
  }
  if (section === "users" && id && action === "suspend") {
    if (method !== "POST") throw methodNotAllowed("POST");
    return setUserSuspension(ctx, id, body);
  }
  if (section === "plans" && id && !action) {
    if (method !== "PATCH") throw methodNotAllowed("PATCH");
    return updatePlan(ctx, id, body);
  }
  if (section === "usage" && id === "override" && !action) {
    if (method !== "POST") throw methodNotAllowed("POST");
    return overrideUsage(ctx, body);
  }
  if (section === "billing" && id === "sync" && !action) {
    if (method !== "POST") throw methodNotAllowed("POST");
    return syncSubscription(ctx, body);
  }

  throw notFound(`/${[section, id, action].filter(Boolean).join("/")}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Admin data is per-operator and frequently changing: never cache it, in
  // the browser or at the edge.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  const method = (req.method ?? "GET").toUpperCase();
  const segments = adminPathSegments(req);
  const context = segments.join("/") || "root";

  try {
    if (!["GET", "POST", "PATCH"].includes(method)) {
      throw methodNotAllowed("GET, POST or PATCH");
    }

    // Authorization happens before routing, so an unauthenticated probe can't
    // even learn which admin endpoints exist.
    const ctx = await requireAdmin(req);

    const payload =
      method === "GET"
        ? await handleGet(ctx, segments, adminQuery(req))
        : await handleWrite(ctx, method, segments, jsonBody(req));

    return res.status(200).json(payload);
  } catch (error) {
    return respondWithError(res, error, context);
  }
}
