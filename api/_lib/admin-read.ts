// ============================================================================
// Admin console — read endpoints.
//
// Every figure returned here comes from a real row in the production
// database. There is no sample data, no placeholder series and no estimated
// metric: where something cannot be derived honestly (AI token cost, for
// example) the response says so instead of inventing a number.
//
// All cross-tenant reads go through the SECURITY DEFINER functions added in
// migration 0008, which are granted to `service_role` only. Simple paginated
// lists use PostgREST directly with the same privileged client.
//
// NOTE: imported with the emitted ".js" extension (see
// api/_tests/module-resolution.test.ts).
// ============================================================================
import {
  AdminApiError,
  adminRpc,
  notFound,
  readEnum,
  readInt,
  readPagination,
  readRange,
  readString,
  optionalUuid,
  requireUuid,
  type AdminContext,
  type Json,
} from "./admin-core.js";
import { readServerEnv } from "./supabase-server.js";
import { hasPaddleCredentials, hasPaddleWebhookSecret, paddleEnvironment, paddlePricePresence } from "./paddle.js";

type Params = URLSearchParams;

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */
export async function overview(ctx: AdminContext, params: Params) {
  const range = readRange(params);
  const [metrics, series, plans] = await Promise.all([
    adminRpc<Json>(ctx, "admin_overview_metrics", { p_from: range.from, p_to: range.to }),
    adminRpc<Json[]>(ctx, "admin_timeseries", { p_from: range.from, p_to: range.to }),
    planCatalog(ctx),
  ]);
  return { range, metrics, series, plans };
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */
const SUBSCRIPTION_STATUSES = [
  "none",
  "created",
  "authenticated",
  "pending",
  "active",
  "trialing",
  "past_due",
  "cancelled",
  "paused",
  "halted",
  "failed",
  "expired",
  "completed",
] as const;

const PLAN_IDS = ["free", "growth", "agency", "scale"] as const;
const USER_SORTS = ["created_at", "name", "email", "plan", "leads_used", "last_activity", "workspaces"] as const;

export async function users(ctx: AdminContext, params: Params) {
  const { page, pageSize, offset } = readPagination(params);
  const hasDateFilter = Boolean(params.get("from") || params.get("to"));
  const range = hasDateFilter ? readRange(params) : null;

  const data = await adminRpc<{ total: number; rows: Json[] }>(ctx, "admin_user_directory", {
    p_search: readString(params, "q"),
    p_plan: readEnum(params, "plan", PLAN_IDS),
    p_role: readEnum(params, "role", ["user", "admin"] as const),
    p_sub_status: readEnum(params, "status", SUBSCRIPTION_STATUSES),
    p_from: range?.from ?? null,
    p_to: range?.to ?? null,
    p_sort: readEnum(params, "sort", USER_SORTS) ?? "created_at",
    p_dir: readEnum(params, "dir", ["asc", "desc"] as const) ?? "desc",
    p_limit: pageSize,
    p_offset: offset,
  });

  return { page, pageSize, total: data?.total ?? 0, rows: data?.rows ?? [] };
}

export async function userDetail(ctx: AdminContext, id: string) {
  const userId = requireUuid(id, "user");
  const detail = await adminRpc<Json | null>(ctx, "admin_user_detail", { p_user: userId });
  if (!detail) throw notFound("That customer");
  return detail;
}

/* ------------------------------------------------------------------ */
/* Workspaces                                                          */
/* ------------------------------------------------------------------ */
const WORKSPACE_SORTS = ["created_at", "name", "owner", "members", "leads_used", "leads_total", "searches"] as const;

export async function workspaces(ctx: AdminContext, params: Params) {
  const { page, pageSize, offset } = readPagination(params);
  const data = await adminRpc<{ total: number; rows: Json[] }>(ctx, "admin_workspace_directory", {
    p_search: readString(params, "q"),
    p_plan: readEnum(params, "plan", PLAN_IDS),
    p_client: readEnum(params, "kind", ["client", "personal"] as const),
    p_activity: readEnum(params, "activity", ["active", "idle"] as const),
    p_sort: readEnum(params, "sort", WORKSPACE_SORTS) ?? "created_at",
    p_dir: readEnum(params, "dir", ["asc", "desc"] as const) ?? "desc",
    p_limit: pageSize,
    p_offset: offset,
  });
  return { page, pageSize, total: data?.total ?? 0, rows: data?.rows ?? [] };
}

export async function workspaceDetail(ctx: AdminContext, id: string) {
  const workspaceId = requireUuid(id, "workspace");
  const detail = await adminRpc<Json | null>(ctx, "admin_workspace_detail", { p_workspace: workspaceId });
  if (!detail) throw notFound("That workspace");
  return detail;
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */
const BILLING_KINDS = ["payments", "invoices", "subscriptions"] as const;
const PAYMENT_STATUSES = ["captured", "failed", "refunded"] as const;
const INVOICE_STATUSES = ["paid", "failed", "upcoming", "refunded"] as const;

export async function billing(ctx: AdminContext, params: Params) {
  const range = readRange(params);
  const kind = readEnum(params, "kind", BILLING_KINDS) ?? "payments";
  const { page, pageSize, offset } = readPagination(params);

  const statusAllowed =
    kind === "payments" ? PAYMENT_STATUSES : kind === "invoices" ? INVOICE_STATUSES : SUBSCRIPTION_STATUSES;

  const [summary, records] = await Promise.all([
    adminRpc<Json>(ctx, "admin_billing_overview", { p_from: range.from, p_to: range.to }),
    adminRpc<{ total: number; rows: Json[] }>(ctx, "admin_billing_records", {
      p_kind: kind,
      p_search: readString(params, "q"),
      p_status: readEnum(params, "status", statusAllowed as readonly string[]),
      p_plan: readEnum(params, "plan", PLAN_IDS),
      // A record search by provider id must look across all time, otherwise
      // "find this payment" fails for anything older than the range.
      p_from: params.get("q") ? null : range.from,
      p_to: params.get("q") ? null : range.to,
      p_limit: pageSize,
      p_offset: offset,
    }),
  ]);

  return {
    range,
    kind,
    summary,
    records: { page, pageSize, total: records?.total ?? 0, rows: records?.rows ?? [] },
    provider: { paddleConfigured: hasPaddleCredentials() },
  };
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */
export type PlanRow = {
  id: string;
  price_cents: number;
  currency: string;
  lead_allowance: number;
  max_lists: number;
  max_users: number;
  has_ai: boolean;
  client_workspaces: boolean;
  priority_processing: boolean;
};

async function planCatalog(ctx: AdminContext): Promise<PlanRow[]> {
  const { data, error } = await ctx.sb.from("plans").select("*").order("price_cents", { ascending: true });
  if (error) {
    console.error("admin query failed", { fn: "plans", code: error.code });
    throw new AdminApiError(500, "We couldn't load the plan catalog. Please try again.", "query_failed");
  }
  return (data ?? []) as PlanRow[];
}

export async function plans(ctx: AdminContext) {
  const catalog = await planCatalog(ctx);

  // Per-plan adoption, counted from entitling subscriptions only. Free is
  // derived (everyone without an entitling paid subscription), exactly the
  // way effective_plan_for_user() resolves it.
  const counts = await Promise.all(
    catalog.map(async (plan) => {
      const { count } = await ctx.sb
        .from("subscriptions")
        .select("user_id", { count: "exact", head: true })
        .eq("plan_id", plan.id)
        .in("status", ["active", "trialing"]);
      return [plan.id, count ?? 0] as const;
    }),
  );
  const { count: totalUsers } = await ctx.sb.from("profiles").select("id", { count: "exact", head: true });

  const paidSubscribers = counts
    .filter(([id]) => id !== "free")
    .reduce((sum, [, value]) => sum + value, 0);

  return {
    plans: catalog,
    adoption: Object.fromEntries(counts),
    totals: {
      users: totalUsers ?? 0,
      paidSubscribers,
      freeUsers: Math.max((totalUsers ?? 0) - paidSubscribers, 0),
    },
    // Paddle price ids are configuration, not data: show whether each paid
    // plan is wired up without ever returning the id itself.
    providerPlans: paddlePricePresence(),
  };
}

/* ------------------------------------------------------------------ */
/* Searches                                                            */
/* ------------------------------------------------------------------ */
const SEARCH_STATUSES = [
  "failed_only",
  "processing_only",
  "queued",
  "processing",
  "fetching",
  "normalizing",
  "deduplicating",
  "saving",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;

export async function searches(ctx: AdminContext, params: Params) {
  const { page, pageSize, offset } = readPagination(params);
  const hasDateFilter = Boolean(params.get("from") || params.get("to") || params.get("range"));
  const range = hasDateFilter ? readRange(params) : null;

  const data = await adminRpc<{ total: number; by_status: Json; rows: Json[] }>(ctx, "admin_search_directory", {
    p_search: readString(params, "q"),
    p_status: readEnum(params, "status", SEARCH_STATUSES),
    p_workspace: optionalUuid(params.get("workspaceId")),
    p_user: optionalUuid(params.get("userId")),
    p_from: range?.from ?? null,
    p_to: range?.to ?? null,
    p_limit: pageSize,
    p_offset: offset,
  });

  return {
    page,
    pageSize,
    total: data?.total ?? 0,
    byStatus: data?.by_status ?? {},
    rows: data?.rows ?? [],
  };
}

export async function searchDetail(ctx: AdminContext, id: string) {
  const searchId = requireUuid(id, "search");
  const detail = await adminRpc<Json | null>(ctx, "admin_search_detail", { p_search_id: searchId });
  if (!detail) throw notFound("That search");
  return detail;
}

/* ------------------------------------------------------------------ */
/* Leads (operational aggregates only)                                 */
/* ------------------------------------------------------------------ */
export async function leads(ctx: AdminContext, params: Params) {
  const range = readRange(params);
  const data = await adminRpc<Json>(ctx, "admin_leads_overview", { p_from: range.from, p_to: range.to });
  return { range, ...data };
}

/* ------------------------------------------------------------------ */
/* Usage + quotas                                                      */
/* ------------------------------------------------------------------ */
export async function usage(ctx: AdminContext, params: Params) {
  const { page, pageSize, offset } = readPagination(params);
  const period = (params.get("period") ?? "").match(/^\d{4}-\d{2}-\d{2}$/) ? params.get("period") : null;

  const data = await adminRpc<Json>(ctx, "admin_usage_rollup", {
    p_period: period,
    p_plan: readEnum(params, "plan", PLAN_IDS),
    p_state: readEnum(params, "state", ["near", "exhausted", "active"] as const),
    p_search: readString(params, "q"),
    p_limit: pageSize,
    p_offset: offset,
  });

  return { page, pageSize, ...data };
}

/* ------------------------------------------------------------------ */
/* AI operations                                                       */
/* ------------------------------------------------------------------ */
export async function ai(ctx: AdminContext, params: Params) {
  const range = readRange(params);
  const data = await adminRpc<Json>(ctx, "admin_ai_overview", { p_from: range.from, p_to: range.to });
  return {
    range,
    ...data,
    // Configuration presence only. Keys are never read into a response.
    configuration: {
      openRouterConfigured: Boolean(readServerEnv("OPENROUTER_API_KEY")),
      model: readServerEnv("OPENROUTER_MODEL") || "deepseek/deepseek-v3.2",
      attribution: Boolean(readServerEnv("OPENROUTER_HTTP_REFERER")),
      serpApiConfigured: Boolean(readServerEnv("SERPAPI_API_KEY")),
    },
    notes: {
      // `ai_requests.tokens` is nullable and no current code path writes it,
      // so spend cannot be derived. Say so rather than estimate.
      tokensTracked: false,
      costTracked: false,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */
export async function webhooks(ctx: AdminContext, params: Params) {
  const { page, pageSize, offset } = readPagination(params);
  const hasDateFilter = Boolean(params.get("from") || params.get("to") || params.get("range"));
  const range = hasDateFilter ? readRange(params) : null;

  const data = await adminRpc<Json>(ctx, "admin_webhook_directory", {
    p_search: readString(params, "q"),
    p_status: readEnum(params, "status", ["received", "processed", "failed"] as const),
    p_event_type: readString(params, "eventType", 80),
    p_from: range?.from ?? null,
    p_to: range?.to ?? null,
    p_limit: pageSize,
    p_offset: offset,
  });

  return {
    page,
    pageSize,
    ...data,
    provider: {
      paddleConfigured: hasPaddleCredentials(),
      webhookSecretConfigured: hasPaddleWebhookSecret(),
    },
  };
}

export async function webhookDetail(ctx: AdminContext, id: string) {
  const eventId = requireUuid(id, "webhook event");
  const detail = await adminRpc<Json | null>(ctx, "admin_webhook_detail", { p_id: eventId });
  if (!detail) throw notFound("That webhook event");
  return detail;
}

/* ------------------------------------------------------------------ */
/* Audit logs                                                          */
/* ------------------------------------------------------------------ */
export async function auditLogs(ctx: AdminContext, params: Params) {
  const { page, pageSize, offset } = readPagination(params);
  let query = ctx.sb
    .from("admin_audit_logs")
    .select(
      "id, admin_user_id, admin_email, admin_name, action, target_type, target_id, target_label, summary, before_state, after_state, metadata, result, ip, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  const admin = optionalUuid(params.get("adminId"));
  if (admin) query = query.eq("admin_user_id", admin);

  const action = readString(params, "action", 80);
  if (action) query = query.eq("action", action);

  const targetType = readEnum(params, "targetType", [
    "user",
    "workspace",
    "plan",
    "subscription",
    "usage",
    "webhook",
    "system",
  ] as const);
  if (targetType) query = query.eq("target_type", targetType);

  const targetId = readString(params, "targetId", 80);
  if (targetId) query = query.eq("target_id", targetId);

  if (params.get("from") || params.get("to") || params.get("range")) {
    const range = readRange(params);
    query = query.gte("created_at", range.from).lt("created_at", range.to);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("admin query failed", { fn: "admin_audit_logs", code: error.code });
    throw new AdminApiError(500, "We couldn't load the audit log. Please try again.", "query_failed");
  }

  // Distinct actions/admins power the filter chips without a second page load.
  const { data: recentActions } = await ctx.sb
    .from("admin_audit_logs")
    .select("action, admin_user_id, admin_email")
    .order("created_at", { ascending: false })
    .limit(500);

  const actions = [...new Set((recentActions ?? []).map((row) => String(row.action)))].sort();
  const adminsMap = new Map<string, string>();
  for (const row of recentActions ?? []) {
    if (row.admin_user_id) adminsMap.set(String(row.admin_user_id), String(row.admin_email ?? ""));
  }

  return {
    page,
    pageSize,
    total: count ?? 0,
    rows: data ?? [],
    facets: {
      actions,
      admins: [...adminsMap].map(([id, email]) => ({ id, email })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* System health                                                       */
/* ------------------------------------------------------------------ */
export async function system(ctx: AdminContext, params: Params) {
  const hours = readInt(params, "hours", 24, 1, 720);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const startedAt = Date.now();
  const { error: pingError } = await ctx.sb.from("plans").select("id").limit(1);
  const databaseLatencyMs = Date.now() - startedAt;

  const health = pingError ? null : await adminRpc<Json>(ctx, "admin_ops_health", { p_since: since });

  return {
    since,
    hours,
    database: {
      status: pingError ? "failing" : databaseLatencyMs > 1500 ? "degraded" : "healthy",
      latencyMs: databaseLatencyMs,
      checkedAt: new Date().toISOString(),
    },
    health,
    // Presence of server configuration — never the values themselves. A
    // missing key is a real, actionable operational signal.
    configuration: {
      supabaseServiceKey: true, // this request could not have been served without it
      serpApi: Boolean(readServerEnv("SERPAPI_API_KEY")),
      openRouter: Boolean(readServerEnv("OPENROUTER_API_KEY")),
      resend: Boolean(readServerEnv("RESEND_API_KEY")),
      paddle: hasPaddleCredentials(),
      paddleEnvironment: paddleEnvironment(),
      paddleWebhookSecret: hasPaddleWebhookSecret(),
      paddlePlans: paddlePricePresence(),
      appUrl: Boolean(readServerEnv("APP_URL")),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
export async function settings(ctx: AdminContext) {
  const [roster, recentAdminChanges] = await Promise.all([
    adminRpc<Json[]>(ctx, "admin_roster", {}),
    ctx.sb
      .from("admin_audit_logs")
      .select("id, admin_email, action, target_label, summary, created_at")
      .in("action", ["user.role.grant", "user.role.revoke"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return {
    admins: roster ?? [],
    recentRoleChanges: recentAdminChanges.data ?? [],
    you: { id: ctx.user.id, email: ctx.adminEmail, name: ctx.adminName },
    capabilities: {
      // Honest capability flags: the console only offers an action when the
      // backend can really perform it.
      suspendAccounts: true,
      roleManagement: true,
      planEditing: true,
      quotaOverride: true,
      subscriptionSync: hasPaddleCredentials(),
      webhookReplay: false,
      impersonation: false,
      featureFlags: false,
      maintenanceMode: false,
    },
  };
}
