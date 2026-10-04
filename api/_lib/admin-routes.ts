// ============================================================================
// Admin API resource handlers.
//
// Every handler receives an already-authorized AdminActor and a service-role
// Supabase client. Nothing here re-checks permissions because the single
// entry point (api/admin/[...path].ts) refuses to dispatch without them —
// keeping authorization in exactly one place is what makes it auditable.
//
// RULES OBSERVED THROUGHOUT:
//  * Only columns that exist in supabase/migrations are selected.
//  * Secrets (razorpay_customer_id, raw webhook payload signatures, provider
//    keys) are never returned.
//  * Every list is paginated and filtered in Postgres — never in the browser.
//  * Every mutation validates input, performs the operation, writes an audit
//    row, and returns the REAL post-operation state.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AdminError,
  badRequest,
  currentUsagePeriod,
  dbError,
  int,
  likeTerm,
  notFound,
  oneOf,
  paging,
  period,
  requireUuid,
  str,
  writeAuditLog,
  type AdminActor,
  type Json,
  type Query,
} from "./admin-core.js";
import { PLAN_LABELS, mapSubscriptionStatus } from "./billing-core.js";

/**
 * Display labels for every plan in the `plans` table. PLAN_LABELS from
 * billing-core only covers the three PAID plans (it exists to name a
 * Razorpay checkout), so `free` is added here rather than duplicating the
 * paid names.
 */
const ALL_PLAN_LABELS: Record<string, string> = { free: "Free", ...PLAN_LABELS };

export type Ctx = {
  sb: SupabaseClient;
  actor: AdminActor;
  query: Query;
  body: Json;
  method: string;
  segments: string[];
};

/* ------------------------------------------------------------------ */
/* Shared vocabularies — these MUST mirror the CHECK constraints in    */
/* supabase/migrations. Inventing a status here would silently produce */
/* an always-empty filter.                                             */
/* ------------------------------------------------------------------ */
export const PLAN_IDS = ["free", "growth", "agency", "scale"] as const;
export const SUBSCRIPTION_STATUSES = [
  "created", "authenticated", "pending", "active", "trialing", "past_due",
  "cancelled", "paused", "halted", "failed", "expired", "completed",
] as const;
export const INVOICE_STATUSES = ["paid", "failed", "upcoming", "refunded"] as const;
export const SEARCH_STATUSES = [
  "queued", "processing", "fetching", "normalizing", "deduplicating",
  "saving", "completed", "partial", "failed", "cancelled",
] as const;
export const EXPORT_STATUSES = ["preparing", "processing", "completed", "failed"] as const;
export const AI_STATUSES = ["processing", "completed", "failed"] as const;
export const AI_KINDS = ["interpret", "analyze", "suggest", "summary"] as const;
export const WEBHOOK_STATUSES = ["received", "processed", "failed"] as const;
export const LEAD_STATUSES = ["new", "contacted"] as const;
export const SEARCH_IN_FLIGHT = [
  "queued", "processing", "fetching", "normalizing", "deduplicating", "saving",
] as const;

function rpcOrThrow<T>(operation: string, result: { data: T; error: unknown }): T {
  if (result.error) throw dbError(operation, result.error);
  return result.data;
}

/* ================================================================== */
/* OVERVIEW                                                            */
/* ================================================================== */
export async function overview({ sb, query }: Ctx): Promise<Json> {
  const p = period(query);
  const metrics = rpcOrThrow(
    "overview.metrics",
    await sb.rpc("admin_overview_metrics", { p_from: p.from, p_to: p.to }),
  );

  // Daily signup/search series for the window — real rows only, so an empty
  // database produces an empty series rather than a fabricated curve.
  const [signups, searches] = await Promise.all([
    sb.from("profiles").select("created_at").gte("created_at", p.from).lt("created_at", p.to).limit(5000),
    sb.from("lead_searches").select("created_at, status").gte("created_at", p.from).lt("created_at", p.to).limit(10000),
  ]);
  if (signups.error) throw dbError("overview.signups", signups.error);
  if (searches.error) throw dbError("overview.searches", searches.error);

  const series = buildSeries(p.from, p.to, [
    { key: "signups", rows: (signups.data ?? []).map((r) => r.created_at as string) },
    { key: "searches", rows: (searches.data ?? []).map((r) => r.created_at as string) },
    {
      key: "failedSearches",
      rows: (searches.data ?? []).filter((r) => r.status === "failed").map((r) => r.created_at as string),
    },
  ]);

  return { period: p, metrics, series };
}

/** Bucket ISO timestamps into UTC days across the window. */
function buildSeries(from: string, to: string, inputs: { key: string; rows: string[] }[]) {
  const start = new Date(from);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  const days: string[] = [];
  for (let d = new Date(start); d <= end && days.length <= 400; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const index = new Map(days.map((d, i) => [d, i]));
  const points = days.map((day) => ({ day }) as Record<string, string | number>);
  for (const input of inputs) {
    for (const point of points) point[input.key] = 0;
    for (const iso of input.rows) {
      const i = index.get(iso.slice(0, 10));
      if (i !== undefined) points[i]![input.key] = (points[i]![input.key] as number) + 1;
    }
  }
  return points;
}

/* ================================================================== */
/* USERS                                                               */
/* ================================================================== */
export async function users(ctx: Ctx): Promise<Json> {
  const { sb, query, segments } = ctx;

  if (segments.length >= 2) return userDetail(ctx, requireUuid(segments[1]!, "user id"));
  if (ctx.method === "POST") throw badRequest("A user id is required for that action.", "missing_target");

  const p = paging(query, 25, 100);
  const dateFrom = str(query, "from");
  const dateTo = str(query, "to");

  const rows = rpcOrThrow(
    "users.list",
    await sb.rpc("admin_list_users", {
      p_search: likeTerm(str(query, "q")),
      p_plan: oneOf(str(query, "plan"), PLAN_IDS, null) ?? "",
      p_role: oneOf(str(query, "role"), ["user", "admin"] as const, null) ?? "",
      p_status: oneOf(str(query, "status"), ["active", "suspended"] as const, null) ?? "",
      p_sub_status: oneOf(str(query, "subscription"), [...SUBSCRIPTION_STATUSES, "none"] as const, null) ?? "",
      p_from: Number.isFinite(Date.parse(dateFrom)) ? new Date(dateFrom).toISOString() : null,
      p_to: Number.isFinite(Date.parse(dateTo)) ? new Date(dateTo).toISOString() : null,
      p_sort: oneOf(str(query, "sort"), ["created_at", "name", "email", "plan", "leads_used"] as const, "created_at"),
      p_dir: oneOf(str(query, "dir"), ["asc", "desc"] as const, "desc"),
      p_limit: p.pageSize,
      p_offset: p.from,
    }),
  ) as (Json & { total_count?: number })[] | null;

  const list = rows ?? [];
  const total = Number(list[0]?.total_count ?? 0);
  return {
    rows: list.map(({ total_count: _ignored, ...rest }) => rest),
    page: p.page,
    pageSize: p.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}

async function userDetail(ctx: Ctx, userId: string): Promise<Json> {
  const { sb, method } = ctx;
  if (method === "POST") return userAction(ctx, userId);

  const detail = rpcOrThrow("users.detail", await sb.rpc("admin_user_detail", { p_user: userId })) as Json | null;
  if (!detail) throw notFound("user");
  return { user: detail };
}

async function userAction(ctx: Ctx, userId: string): Promise<Json> {
  const { sb, actor, body } = ctx;
  const action = String(body.action ?? "");

  const current = await sb.from("profiles").select("id, name, role, status").eq("id", userId).maybeSingle();
  if (current.error) throw dbError("users.read", current.error);
  if (!current.data) throw notFound("user");

  if (action === "set_role") {
    const role = oneOf(String(body.role ?? ""), ["user", "admin"] as const);
    if (!role) throw badRequest("Role must be 'user' or 'admin'.", "invalid_role");
    if (userId === actor.id && role !== "admin") {
      // Prevents an operator locking the whole team out of /admin by accident.
      throw badRequest("You can't remove your own admin role. Ask another admin to do it.", "self_demotion");
    }
    if (current.data.role === role) {
      return { user: current.data, changed: false };
    }

    // Must go through the RPC: the profiles_protect_role trigger rejects a
    // direct service-role UPDATE because auth.uid() is null for that key.
    const { data, error } = await sb.rpc("admin_set_profile_role", { p_user: userId, p_role: role });
    if (error) throw dbError("users.set_role", error);

    const audited = await writeAuditLog(actor, {
      action: "user.role_changed",
      targetType: "user",
      targetId: userId,
      summary: `Role ${current.data.role} → ${role}`,
      before: { role: current.data.role },
      after: { role },
    });
    return { user: data, changed: true, audited };
  }

  if (action === "set_status") {
    const status = oneOf(String(body.status ?? ""), ["active", "suspended"] as const);
    if (!status) throw badRequest("Status must be 'active' or 'suspended'.", "invalid_status");
    if (userId === actor.id) throw badRequest("You can't suspend your own account.", "self_suspend");
    if (current.data.status === status) return { user: current.data, changed: false };

    const reason = String(body.reason ?? "").slice(0, 300);
    const { data, error } = await sb.rpc("admin_set_profile_status", { p_user: userId, p_status: status });
    if (error) throw dbError("users.set_status", error);

    const audited = await writeAuditLog(actor, {
      action: status === "suspended" ? "user.suspended" : "user.reactivated",
      targetType: "user",
      targetId: userId,
      summary: `Account status ${current.data.status} → ${status}`,
      before: { status: current.data.status },
      after: { status },
      metadata: reason ? { reason } : {},
    });
    return { user: data, changed: true, audited };
  }

  throw badRequest("Unknown user action.", "unknown_action");
}

/* ================================================================== */
/* WORKSPACES                                                          */
/* ================================================================== */
export async function workspaces(ctx: Ctx): Promise<Json> {
  const { sb, query, segments } = ctx;

  if (segments.length >= 2) {
    const id = requireUuid(segments[1]!, "workspace id");
    const detail = rpcOrThrow("workspaces.detail", await sb.rpc("admin_workspace_detail", { p_ws: id })) as Json | null;
    if (!detail) throw notFound("workspace");
    return { workspace: detail };
  }

  const p = paging(query, 25, 100);
  const rows = rpcOrThrow(
    "workspaces.list",
    await sb.rpc("admin_list_workspaces", {
      p_search: likeTerm(str(query, "q")),
      p_plan: oneOf(str(query, "plan"), PLAN_IDS, null) ?? "",
      p_client: oneOf(str(query, "client"), ["client", "internal"] as const, null) ?? "",
      p_sort: oneOf(str(query, "sort"), ["created_at", "name", "leads", "usage", "activity", "members"] as const, "created_at"),
      p_limit: p.pageSize,
      p_offset: p.from,
    }),
  ) as (Json & { total_count?: number })[] | null;

  const list = rows ?? [];
  const total = Number(list[0]?.total_count ?? 0);
  return {
    rows: list.map(({ total_count: _ignored, ...rest }) => rest),
    page: p.page,
    pageSize: p.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}

/* ================================================================== */
/* BILLING                                                             */
/* ================================================================== */
export async function billing(ctx: Ctx): Promise<Json> {
  const { sb, query, method, segments } = ctx;
  if (method === "POST") return billingAction(ctx);

  const view = oneOf(segments[1] ?? "summary", ["summary", "subscriptions", "payments", "invoices", "events"] as const, "summary")!;
  const p = paging(query, 25, 100);
  const range = period(query);

  if (view === "summary") {
    const metrics = rpcOrThrow(
      "billing.summary",
      await sb.rpc("admin_overview_metrics", { p_from: range.from, p_to: range.to }),
    ) as Json;
    const renewals = await sb
      .from("subscriptions")
      .select("id, user_id, plan_id, status, current_period_end, razorpay_subscription_id, cancel_at_cycle_end")
      .in("status", ["active", "trialing"])
      .gte("current_period_end", new Date().toISOString())
      .lte("current_period_end", new Date(Date.now() + 30 * 86_400_000).toISOString())
      .order("current_period_end", { ascending: true })
      .limit(25);
    if (renewals.error) throw dbError("billing.renewals", renewals.error);

    const events = await sb
      .from("subscription_events")
      .select("id, user_id, event_type, razorpay_event_id, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (events.error) throw dbError("billing.events", events.error);

    return {
      period: range,
      business: (metrics as { business?: Json })?.business ?? {},
      renewals: renewals.data ?? [],
      events: events.data ?? [],
    };
  }

  const search = likeTerm(str(query, "q"));

  if (view === "subscriptions") {
    let q = sb
      .from("subscriptions")
      .select(
        "id, user_id, plan_id, status, currency, razorpay_subscription_id, razorpay_plan_id, " +
          "current_period_start, current_period_end, charge_at, cancel_at, cancel_at_cycle_end, " +
          "latest_payment_id, last_event_at, created_at, updated_at",
        { count: "exact" },
      )
      .order("updated_at", { ascending: false })
      .range(p.from, p.to);
    const status = oneOf(str(query, "status"), SUBSCRIPTION_STATUSES, null);
    if (status) q = q.eq("status", status);
    const plan = oneOf(str(query, "plan"), PLAN_IDS, null);
    if (plan) q = q.eq("plan_id", plan);
    if (search) q = q.or(`razorpay_subscription_id.ilike.%${search}%,razorpay_plan_id.ilike.%${search}%`);
    const { data, error, count } = await q;
    if (error) throw dbError("billing.subscriptions", error);
    return withOwners(sb, "rows", (data ?? []) as unknown as Record<string, unknown>[], "user_id", p, count ?? 0);
  }

  if (view === "payments") {
    let q = sb
      .from("payments")
      .select(
        "id, user_id, subscription_id, razorpay_payment_id, razorpay_subscription_id, " +
          "amount_cents, currency, status, method, captured_at, created_at",
        { count: "exact" },
      )
      .gte("created_at", range.from)
      .lt("created_at", range.to)
      .order("created_at", { ascending: false })
      .range(p.from, p.to);
    const status = str(query, "status");
    if (status) q = q.eq("status", status.slice(0, 40));
    if (search) q = q.or(`razorpay_payment_id.ilike.%${search}%,razorpay_subscription_id.ilike.%${search}%`);
    const { data, error, count } = await q;
    if (error) throw dbError("billing.payments", error);
    return withOwners(sb, "rows", (data ?? []) as unknown as Record<string, unknown>[], "user_id", p, count ?? 0);
  }

  // invoices
  let q = sb
    .from("invoices")
    .select(
      "id, user_id, subscription_id, number, description, amount_cents, currency, status, " +
        "razorpay_invoice_id, razorpay_payment_id, period_start, period_end, issued_at",
      { count: "exact" },
    )
    .gte("issued_at", range.from)
    .lt("issued_at", range.to)
    .order("issued_at", { ascending: false })
    .range(p.from, p.to);
  const status = oneOf(str(query, "status"), INVOICE_STATUSES, null);
  if (status) q = q.eq("status", status);
  if (search) q = q.or(`number.ilike.%${search}%,razorpay_invoice_id.ilike.%${search}%,razorpay_payment_id.ilike.%${search}%`);
  const { data, error, count } = await q;
  if (error) throw dbError("billing.invoices", error);
  return withOwners(sb, "rows", (data ?? []) as unknown as Record<string, unknown>[], "user_id", p, count ?? 0);
}

/**
 * Resolve owner name/email for a page of rows in ONE extra query (never N+1).
 * Email comes from `profiles` + the users RPC rather than auth.users because
 * only the page's ids are needed.
 */
async function withOwners(
  sb: SupabaseClient,
  key: string,
  rows: Record<string, unknown>[],
  idField: string,
  p: { page: number; pageSize: number },
  total: number,
): Promise<Json> {
  const ids = [...new Set(rows.map((r) => r[idField]).filter((v): v is string => typeof v === "string"))];
  const owners: Record<string, { name: string; email: string }> = {};
  if (ids.length) {
    const { data, error } = await sb.rpc("admin_lookup_identities", { p_ids: ids });
    if (error) throw dbError("identities.lookup", error);
    for (const row of (data ?? []) as { id: string; name: string; email: string }[]) {
      owners[row.id] = { name: row.name, email: row.email };
    }
  }
  return {
    [key]: rows.map((r) => ({ ...r, owner: owners[String(r[idField] ?? "")] ?? null })),
    page: p.page,
    pageSize: p.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}

async function billingAction(ctx: Ctx): Promise<Json> {
  const { sb, actor, body } = ctx;
  const action = String(body.action ?? "");

  if (action === "sync_subscription") {
    const userId = requireUuid(String(body.userId ?? ""), "user id");
    const before = await sb
      .from("subscriptions")
      .select("id, user_id, plan_id, status, razorpay_subscription_id, current_period_start, current_period_end, charge_at, cancel_at_cycle_end")
      .eq("user_id", userId)
      .maybeSingle();
    if (before.error) throw dbError("billing.sync.read", before.error);
    if (!before.data) throw notFound("subscription");

    const remoteId = before.data.razorpay_subscription_id;
    if (!remoteId) {
      throw badRequest("That subscription has no Razorpay id to reconcile against.", "no_provider_id");
    }

    const remote = await razorpayGet(`/subscriptions/${encodeURIComponent(String(remoteId))}`);
    const status = mapSubscriptionStatus(remote.status, String(before.data.status ?? "active"));
    const update: Json = {
      status,
      current_period_start: epoch(remote.current_start),
      current_period_end: epoch(remote.current_end),
      charge_at: epoch(remote.charge_at),
      cancel_at_cycle_end: Boolean(remote.cancel_at_cycle_end),
      last_event_at: new Date().toISOString(),
    };
    // Entitlement must never be invented from a provider read: a subscription
    // that is not paying drops to the free plan, exactly as the webhook does.
    if (status === "cancelled" || status === "expired" || status === "failed") {
      update.plan_id = "free";
    }

    const { data, error } = await sb
      .from("subscriptions")
      .update(update)
      .eq("user_id", userId)
      .select("id, user_id, plan_id, status, razorpay_subscription_id, current_period_start, current_period_end, charge_at, cancel_at_cycle_end")
      .maybeSingle();
    if (error) throw dbError("billing.sync.write", error);

    const audited = await writeAuditLog(actor, {
      action: "billing.subscription_synced",
      targetType: "subscription",
      targetId: String(before.data.id),
      summary: `Reconciled with Razorpay: ${before.data.status} → ${status}`,
      before: before.data as Json,
      after: data as Json,
      metadata: { provider: "razorpay", provider_status: String(remote.status ?? "") },
    });
    return { subscription: data, audited };
  }

  if (action === "expire_lapsed") {
    const { data, error } = await sb.rpc("expire_lapsed_subscriptions");
    if (error) throw dbError("billing.expire_lapsed", error);
    const audited = await writeAuditLog(actor, {
      action: "billing.expire_lapsed",
      targetType: "subscription",
      summary: `Normalized ${Number(data ?? 0)} lapsed subscription(s) to the free plan`,
      after: { updated: Number(data ?? 0) },
    });
    return { updated: Number(data ?? 0), audited };
  }

  throw badRequest("Unknown billing action.", "unknown_action");
}

function epoch(value: unknown): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

/**
 * Minimal read-only Razorpay call for reconciliation. Uses the SERVER-ONLY
 * key secret; neither the key nor the raw provider error ever reaches the
 * browser.
 */
async function razorpayGet(path: string): Promise<Json> {
  const keyId = (process.env.RAZORPAY_KEY_ID ?? "").trim();
  const secret = (process.env.RAZORPAY_KEY_SECRET ?? "").trim();
  if (!keyId || !secret) {
    throw new AdminError(
      500,
      "Razorpay isn't configured on this deployment, so subscriptions can't be reconciled.",
      "billing_config",
    );
  }
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AdminError(502, "Razorpay couldn't be reached. Try again shortly.", "provider_unreachable");
  }
  if (!response.ok) {
    console.error("admin provider", { provider: "razorpay", status: response.status });
    if (response.status === 404) throw notFound("Razorpay subscription");
    throw new AdminError(502, "Razorpay couldn't complete that lookup.", "provider_error");
  }
  return (await response.json().catch(() => ({}))) as Json;
}

/* ================================================================== */
/* PLANS                                                               */
/* ================================================================== */
const PLAN_NUMERIC_FIELDS = ["price_cents", "lead_allowance", "max_lists", "max_users"] as const;
const PLAN_BOOLEAN_FIELDS = ["has_ai", "client_workspaces", "priority_processing"] as const;

export async function plans(ctx: Ctx): Promise<Json> {
  const { sb, actor, body, method } = ctx;

  if (method !== "POST") {
    const { data, error } = await sb.from("plans").select("*").order("price_cents", { ascending: true });
    if (error) throw dbError("plans.list", error);

    // Live impact, so an operator can see who an edit would affect.
    const { data: counts, error: countError } = await sb
      .from("subscriptions")
      .select("plan_id, status")
      .in("status", ["active", "trialing"]);
    if (countError) throw dbError("plans.counts", countError);
    const subscribers: Record<string, number> = {};
    for (const row of counts ?? []) subscribers[String(row.plan_id)] = (subscribers[String(row.plan_id)] ?? 0) + 1;

    const { count: workspaceCount, error: wsError } = await sb
      .from("workspaces")
      .select("id", { count: "exact", head: true });
    if (wsError) throw dbError("plans.workspaces", wsError);

    return {
      plans: (data ?? []).map((p) => ({ ...p, label: ALL_PLAN_LABELS[String(p.id)] ?? String(p.id), subscribers: subscribers[String(p.id)] ?? 0 })),
      totalWorkspaces: workspaceCount ?? 0,
    };
  }

  const planId = oneOf(String(body.id ?? ""), PLAN_IDS);
  if (!planId) throw badRequest("That plan doesn't exist.", "invalid_plan");

  const before = await sb.from("plans").select("*").eq("id", planId).maybeSingle();
  if (before.error) throw dbError("plans.read", before.error);
  if (!before.data) throw notFound("plan");

  const update: Json = {};
  for (const field of PLAN_NUMERIC_FIELDS) {
    if (!(field in body)) continue;
    const value = Number(body[field]);
    if (!Number.isInteger(value)) throw badRequest(`${field} must be a whole number.`, "invalid_value");
    // max_lists is the only field where -1 is meaningful (unlimited).
    const min = field === "max_lists" ? -1 : field === "price_cents" ? 0 : 1;
    if (value < min) throw badRequest(`${field} can't be below ${min}.`, "invalid_value");
    if (value > 10_000_000) throw badRequest(`${field} is unreasonably large.`, "invalid_value");
    update[field] = value;
  }
  for (const field of PLAN_BOOLEAN_FIELDS) {
    if (!(field in body)) continue;
    if (typeof body[field] !== "boolean") throw badRequest(`${field} must be true or false.`, "invalid_value");
    update[field] = body[field];
  }
  if (!Object.keys(update).length) throw badRequest("No plan changes were supplied.", "no_changes");

  // Guard rail: a reduction that would instantly put live customers over
  // their allowance requires explicit acknowledgement.
  if (typeof update.lead_allowance === "number" && update.lead_allowance < Number(before.data.lead_allowance)) {
    const { count, error } = await sb
      .from("usage_counters")
      .select("workspace_id", { count: "exact", head: true })
      .eq("period_start", currentUsagePeriod())
      .gt("leads_used", update.lead_allowance as number);
    if (error) throw dbError("plans.impact", error);
    if ((count ?? 0) > 0 && body.acknowledgeImpact !== true) {
      throw new AdminError(
        409,
        `${count} workspace(s) are already above that allowance this month and would be immediately over quota. Re-submit with confirmation to proceed.`,
        "plan_impact",
      );
    }
  }

  const { data, error } = await sb.from("plans").update(update).eq("id", planId).select("*").maybeSingle();
  if (error) throw dbError("plans.update", error);

  const changed = Object.fromEntries(
    Object.keys(update).map((k) => [k, { from: (before.data as Json)[k], to: (data as Json)?.[k] }]),
  );
  const audited = await writeAuditLog(actor, {
    action: "plan.updated",
    targetType: "plan",
    targetId: planId,
    summary: `Updated ${Object.keys(update).join(", ")} on the ${ALL_PLAN_LABELS[planId] ?? planId} plan`,
    before: before.data as Json,
    after: data as Json,
    metadata: { changed },
  });
  return { plan: data, changed, audited };
}

/* ================================================================== */
/* SEARCHES                                                            */
/* ================================================================== */
export async function searches(ctx: Ctx): Promise<Json> {
  const { sb, query, segments } = ctx;

  if (segments.length >= 2) {
    const id = requireUuid(segments[1]!, "search id");
    const [search, jobs] = await Promise.all([
      sb.from("lead_searches").select("*").eq("id", id).maybeSingle(),
      sb.from("lead_search_jobs").select("*").eq("search_id", id).order("created_at", { ascending: false }),
    ]);
    if (search.error) throw dbError("searches.detail", search.error);
    if (!search.data) throw notFound("search");
    if (jobs.error) throw dbError("searches.jobs", jobs.error);

    const { count: leadCount, error: leadError } = await sb
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("search_id", id);
    if (leadError) throw dbError("searches.leads", leadError);

    const identities = await resolveIdentities(sb, [String(search.data.user_id)]);
    const workspace = await sb.from("workspaces").select("id, name").eq("id", search.data.workspace_id).maybeSingle();
    if (workspace.error) throw dbError("searches.workspace", workspace.error);

    return {
      search: search.data,
      jobs: jobs.data ?? [],
      leadCount: leadCount ?? 0,
      owner: identities[String(search.data.user_id)] ?? null,
      workspace: workspace.data ?? null,
    };
  }

  const p = paging(query, 25, 100);
  const range = period(query);
  let q = sb
    .from("lead_searches")
    .select("id, workspace_id, user_id, query, location, requested_count, result_count, status, error, created_at, completed_at", { count: "exact" })
    .gte("created_at", range.from)
    .lt("created_at", range.to)
    .order("created_at", { ascending: false })
    .range(p.from, p.to);

  const view = oneOf(str(query, "view"), ["failed", "processing"] as const, null);
  if (view === "failed") q = q.in("status", ["failed", "partial"]);
  else if (view === "processing") q = q.in("status", [...SEARCH_IN_FLIGHT]);
  else {
    const status = oneOf(str(query, "status"), SEARCH_STATUSES, null);
    if (status) q = q.eq("status", status);
  }

  const workspaceId = str(query, "workspaceId");
  if (workspaceId) q = q.eq("workspace_id", requireUuid(workspaceId, "workspace id"));
  const userId = str(query, "userId");
  if (userId) q = q.eq("user_id", requireUuid(userId, "user id"));
  const search = likeTerm(str(query, "q"));
  if (search) q = q.or(`query.ilike.%${search}%,location.ilike.%${search}%`);

  const { data, error, count } = await q;
  if (error) throw dbError("searches.list", error);
  const rows = data ?? [];
  const [identities, workspaceNames] = await Promise.all([
    resolveIdentities(sb, rows.map((r) => String(r.user_id))),
    resolveWorkspaces(sb, rows.map((r) => String(r.workspace_id))),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r,
      owner: identities[String(r.user_id)] ?? null,
      workspace_name: workspaceNames[String(r.workspace_id)] ?? null,
    })),
    page: p.page,
    pageSize: p.pageSize,
    total: count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / p.pageSize)),
    period: range,
  };
}

async function resolveIdentities(sb: SupabaseClient, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map: Record<string, { name: string; email: string }> = {};
  if (!unique.length) return map;
  const { data, error } = await sb.rpc("admin_lookup_identities", { p_ids: unique });
  if (error) throw dbError("identities.lookup", error);
  for (const row of (data ?? []) as { id: string; name: string; email: string }[]) {
    map[row.id] = { name: row.name, email: row.email };
  }
  return map;
}

async function resolveWorkspaces(sb: SupabaseClient, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map: Record<string, string> = {};
  if (!unique.length) return map;
  const { data, error } = await sb.from("workspaces").select("id, name").in("id", unique);
  if (error) throw dbError("workspaces.names", error);
  for (const row of data ?? []) map[String(row.id)] = String(row.name);
  return map;
}

/* ================================================================== */
/* LEADS (operational overview, not the customer leads UI)             */
/* ================================================================== */
export async function leads({ sb, query }: Ctx): Promise<Json> {
  const range = period(query);
  const summary = rpcOrThrow(
    "leads.overview",
    await sb.rpc("admin_leads_overview", { p_from: range.from, p_to: range.to }),
  );

  // Top workspaces by lead volume — bounded, single query.
  const p = paging(query, 20, 50);
  const rows = rpcOrThrow(
    "leads.workspaces",
    await sb.rpc("admin_list_workspaces", {
      p_search: likeTerm(str(query, "q")),
      p_plan: oneOf(str(query, "plan"), PLAN_IDS, null) ?? "",
      p_client: "",
      p_sort: "leads",
      p_limit: p.pageSize,
      p_offset: p.from,
    }),
  ) as (Json & { total_count?: number })[] | null;

  const list = rows ?? [];
  const total = Number(list[0]?.total_count ?? 0);
  return {
    period: range,
    summary,
    workspaces: list.map(({ total_count: _ignored, ...rest }) => rest),
    page: p.page,
    pageSize: p.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}

/* ================================================================== */
/* USAGE                                                               */
/* ================================================================== */
export async function usage(ctx: Ctx): Promise<Json> {
  const { sb, query, method } = ctx;
  if (method === "POST") return usageAction(ctx);

  const periodStart = /^\d{4}-\d{2}-01$/.test(str(query, "periodStart"))
    ? str(query, "periodStart")
    : currentUsagePeriod();

  const { data, error } = await sb.rpc("admin_usage_overview", { p_period: periodStart });
  if (error) throw dbError("usage.overview", error);

  type Row = {
    workspace_id: string;
    workspace_name: string;
    owner_name: string;
    owner_email: string;
    plan_id: string;
    lead_allowance: number;
    leads_used: number;
    searches: number;
    exports: number;
    ai_runs: number;
    pct: number;
  };
  const all = (data ?? []) as Row[];

  const planFilter = oneOf(str(query, "plan"), PLAN_IDS, null);
  const view = oneOf(str(query, "view"), ["all", "near_limit", "exhausted", "active"] as const, "all")!;
  const search = str(query, "q").toLowerCase();

  const filtered = all.filter((r) => {
    if (planFilter && r.plan_id !== planFilter) return false;
    if (view === "exhausted" && !(r.lead_allowance > 0 && r.leads_used >= r.lead_allowance)) return false;
    if (view === "near_limit" && !(r.pct >= 80 && r.pct < 100)) return false;
    if (view === "active" && r.leads_used === 0 && r.searches === 0) return false;
    if (search && !`${r.workspace_name} ${r.owner_name} ${r.owner_email}`.toLowerCase().includes(search)) return false;
    return true;
  });
  filtered.sort((a, b) => b.leads_used - a.leads_used || b.pct - a.pct);

  const p = paging(query, 25, 100);
  const totals = all.reduce(
    (acc, r) => ({
      leads: acc.leads + r.leads_used,
      searches: acc.searches + r.searches,
      exports: acc.exports + r.exports,
      ai: acc.ai + r.ai_runs,
      nearLimit: acc.nearLimit + (r.pct >= 80 && r.pct < 100 ? 1 : 0),
      exhausted: acc.exhausted + (r.lead_allowance > 0 && r.leads_used >= r.lead_allowance ? 1 : 0),
    }),
    { leads: 0, searches: 0, exports: 0, ai: 0, nearLimit: 0, exhausted: 0 },
  );

  const byPlan: Record<string, { workspaces: number; leads: number; searches: number }> = {};
  for (const r of all) {
    const bucket = (byPlan[r.plan_id] ??= { workspaces: 0, leads: 0, searches: 0 });
    bucket.workspaces += 1;
    bucket.leads += r.leads_used;
    bucket.searches += r.searches;
  }

  // Trailing periods, aggregated in Postgres via a bounded select.
  const { data: history, error: historyError } = await sb
    .from("usage_counters")
    .select("period_start, leads_used, searches, exports, ai_runs")
    .gte("period_start", new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10))
    .limit(20000);
  if (historyError) throw dbError("usage.history", historyError);
  const historyByPeriod: Record<string, { leads: number; searches: number; exports: number; ai: number }> = {};
  for (const row of history ?? []) {
    const key = String(row.period_start);
    const bucket = (historyByPeriod[key] ??= { leads: 0, searches: 0, exports: 0, ai: 0 });
    bucket.leads += Number(row.leads_used ?? 0);
    bucket.searches += Number(row.searches ?? 0);
    bucket.exports += Number(row.exports ?? 0);
    bucket.ai += Number(row.ai_runs ?? 0);
  }

  return {
    periodStart,
    totals,
    byPlan,
    history: Object.entries(historyByPeriod)
      .map(([periodKey, v]) => ({ period_start: periodKey, ...v }))
      .sort((a, b) => a.period_start.localeCompare(b.period_start)),
    rows: filtered.slice(p.from, p.from + p.pageSize),
    page: p.page,
    pageSize: p.pageSize,
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / p.pageSize)),
  };
}

async function usageAction(ctx: Ctx): Promise<Json> {
  const { sb, actor, body } = ctx;
  if (String(body.action ?? "") !== "adjust") throw badRequest("Unknown usage action.", "unknown_action");

  const workspaceId = requireUuid(String(body.workspaceId ?? ""), "workspace id");
  const metric = oneOf(String(body.metric ?? ""), ["leads_used", "searches", "exports", "ai_runs"] as const);
  if (!metric) throw badRequest("That usage metric doesn't exist.", "invalid_metric");
  const value = Number(body.value);
  if (!Number.isInteger(value) || value < 0 || value > 10_000_000) {
    throw badRequest("The new value must be a whole number of 0 or more.", "invalid_value");
  }
  const reason = String(body.reason ?? "").trim().slice(0, 300);
  if (reason.length < 4) throw badRequest("A short reason is required for a quota override.", "reason_required");

  const periodStart = /^\d{4}-\d{2}-01$/.test(String(body.periodStart ?? ""))
    ? String(body.periodStart)
    : currentUsagePeriod();

  const { data, error } = await sb.rpc("admin_adjust_usage_counter", {
    ws: workspaceId,
    p_period: periodStart,
    p_metric: metric,
    p_value: value,
  });
  if (error) throw dbError("usage.adjust", error);

  const result = (data ?? {}) as { old_value?: number; value?: number };
  const audited = await writeAuditLog(actor, {
    action: "usage.override",
    targetType: "workspace",
    targetId: workspaceId,
    summary: `${metric} for ${periodStart}: ${result.old_value ?? 0} → ${result.value ?? value}`,
    before: { [metric]: result.old_value ?? 0, period_start: periodStart },
    after: { [metric]: result.value ?? value, period_start: periodStart },
    metadata: { reason },
  });
  return { usage: result, audited };
}

/* ================================================================== */
/* AI                                                                  */
/* ================================================================== */
export async function ai({ sb, query }: Ctx): Promise<Json> {
  const range = period(query);
  const summary = rpcOrThrow("ai.overview", await sb.rpc("admin_ai_overview", { p_from: range.from, p_to: range.to }));

  const p = paging(query, 25, 100);
  let q = sb
    .from("ai_requests")
    .select("id, workspace_id, user_id, kind, status, model, tokens, error, created_at", { count: "exact" })
    .gte("created_at", range.from)
    .lt("created_at", range.to)
    .order("created_at", { ascending: false })
    .range(p.from, p.to);
  const status = oneOf(str(query, "status"), AI_STATUSES, null);
  if (status) q = q.eq("status", status);
  const kind = oneOf(str(query, "kind"), AI_KINDS, null);
  if (kind) q = q.eq("kind", kind);
  const workspaceId = str(query, "workspaceId");
  if (workspaceId) q = q.eq("workspace_id", requireUuid(workspaceId, "workspace id"));

  const { data, error, count } = await q;
  if (error) throw dbError("ai.list", error);
  const rows = data ?? [];
  const [identities, workspaceNames] = await Promise.all([
    resolveIdentities(sb, rows.map((r) => String(r.user_id ?? ""))),
    resolveWorkspaces(sb, rows.map((r) => String(r.workspace_id ?? ""))),
  ]);

  return {
    period: range,
    summary,
    // Provider configuration status only — the key itself is never read into
    // a response, only its presence and the configured model name.
    config: {
      provider: "openrouter",
      configured: Boolean((process.env.OPENROUTER_API_KEY ?? "").trim()),
      model: (process.env.OPENROUTER_MODEL ?? "").trim() || null,
      referer: (process.env.OPENROUTER_HTTP_REFERER ?? "").trim() || null,
    },
    rows: rows.map((r) => ({
      ...r,
      owner: identities[String(r.user_id ?? "")] ?? null,
      workspace_name: workspaceNames[String(r.workspace_id ?? "")] ?? null,
    })),
    page: p.page,
    pageSize: p.pageSize,
    total: count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / p.pageSize)),
  };
}

/* ================================================================== */
/* WEBHOOKS                                                            */
/* ================================================================== */
export async function webhooks({ sb, query, segments }: Ctx): Promise<Json> {
  if (segments.length >= 2) {
    const id = requireUuid(segments[1]!, "event id");
    const { data, error } = await sb
      .from("webhook_events")
      .select("id, provider, event_id, event_type, status, attempts, error, received_at, processed_at, payload")
      .eq("id", id)
      .maybeSingle();
    if (error) throw dbError("webhooks.detail", error);
    if (!data) throw notFound("webhook event");
    return { event: { ...data, payload: redactPayload(data.payload) } };
  }

  const p = paging(query, 25, 100);
  const range = period(query);
  let q = sb
    .from("webhook_events")
    .select("id, provider, event_id, event_type, status, attempts, error, received_at, processed_at", { count: "exact" })
    .gte("received_at", range.from)
    .lt("received_at", range.to)
    .order("received_at", { ascending: false })
    .range(p.from, p.to);

  const status = oneOf(str(query, "status"), WEBHOOK_STATUSES, null);
  if (status) q = q.eq("status", status);
  const type = str(query, "type");
  if (type) q = q.eq("event_type", type.slice(0, 80));
  const search = likeTerm(str(query, "q"));
  if (search) q = q.ilike("event_id", `%${search}%`);

  const { data, error, count } = await q;
  if (error) throw dbError("webhooks.list", error);

  const { data: types, error: typeError } = await sb
    .from("webhook_events")
    .select("event_type")
    .gte("received_at", range.from)
    .limit(2000);
  if (typeError) throw dbError("webhooks.types", typeError);

  const counts: Record<string, number> = {};
  for (const row of types ?? []) counts[String(row.event_type)] = (counts[String(row.event_type)] ?? 0) + 1;

  // Status totals for the window — three HEAD counts, no rows transferred.
  const statusCount = async (value: (typeof WEBHOOK_STATUSES)[number]) => {
    const { count: n, error: statusError } = await sb
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .gte("received_at", range.from)
      .lt("received_at", range.to)
      .eq("status", value);
    if (statusError) throw dbError("webhooks.count", statusError);
    return n ?? 0;
  };
  const [received, processed, failed] = await Promise.all([
    statusCount("received"),
    statusCount("processed"),
    statusCount("failed"),
  ]);

  const { data: latest, error: latestError } = await sb
    .from("webhook_events")
    .select("received_at, processed_at")
    .order("received_at", { ascending: false })
    .limit(1);
  if (latestError) throw dbError("webhooks.latest", latestError);

  const { data: failures, error: failureError } = await sb
    .from("webhook_events")
    .select("error")
    .eq("status", "failed")
    .gte("received_at", range.from)
    .lt("received_at", range.to)
    .not("error", "is", null)
    .limit(500);
  if (failureError) throw dbError("webhooks.errors", failureError);
  const errorCounts: Record<string, number> = {};
  for (const row of failures ?? []) {
    const key = String(row.error ?? "").slice(0, 120);
    if (!key) continue;
    errorCounts[key] = (errorCounts[key] ?? 0) + 1;
  }

  const byProvider: Record<string, number> = {};
  for (const row of data ?? []) byProvider[String(row.provider)] = (byProvider[String(row.provider)] ?? 0) + 1;

  return {
    period: range,
    summary: {
      total: received + processed + failed,
      received,
      processed,
      failed,
      by_type: counts,
      by_provider: byProvider,
      last_received_at: latest?.[0]?.received_at ?? null,
      last_processed_at: latest?.[0]?.processed_at ?? null,
      top_errors: Object.entries(errorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([error, count]) => ({ error, count })),
    },
    rows: data ?? [],
    eventTypes: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([type_, n]) => ({ type: type_, count: n })),
    page: p.page,
    pageSize: p.pageSize,
    total: count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / p.pageSize)),
    // There is no idempotent server-side replay path for a stored Razorpay
    // event in this codebase: the webhook handler verifies an HMAC over the
    // raw request body, which is not retained. Rather than ship a button that
    // only pretends to retry, the UI shows the diagnosis and points at the
    // reconciliation action, which IS safe and idempotent.
    retrySupported: false,
  };
}

/** Webhook payloads can carry provider identifiers; never echo signatures. */
function redactPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const clone = JSON.parse(JSON.stringify(payload)) as Json;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Json = {};
      for (const [key, value] of Object.entries(node as Json)) {
        if (/signature|secret|token|password/i.test(key)) {
          out[key] = "[redacted]";
          continue;
        }
        out[key] = walk(value);
      }
      return out;
    }
    return node;
  };
  return walk(clone);
}

/* ================================================================== */
/* AUDIT LOGS                                                          */
/* ================================================================== */
export async function auditLogs({ sb, query }: Ctx): Promise<Json> {
  const p = paging(query, 50, 100);
  const range = period(query);

  let q = sb
    .from("admin_audit_logs")
    .select("id, admin_user_id, admin_email, action, target_type, target_id, summary, before, after, metadata, ip, created_at", { count: "exact" })
    .gte("created_at", range.from)
    .lt("created_at", range.to)
    .order("created_at", { ascending: false })
    .range(p.from, p.to);

  const action = str(query, "action");
  if (action) q = q.eq("action", action.slice(0, 80));
  const targetType = str(query, "targetType");
  if (targetType) q = q.eq("target_type", targetType.slice(0, 40));
  const targetId = str(query, "targetId");
  if (targetId) q = q.eq("target_id", targetId.slice(0, 80));
  const adminId = str(query, "adminId");
  if (adminId) q = q.eq("admin_user_id", requireUuid(adminId, "admin id"));

  const { data, error, count } = await q;
  if (error) throw dbError("audit.list", error);

  const { data: facets, error: facetError } = await sb
    .from("admin_audit_logs")
    .select("action, target_type, admin_email")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (facetError) throw dbError("audit.facets", facetError);

  return {
    period: range,
    rows: data ?? [],
    actions: [...new Set((facets ?? []).map((r) => String(r.action)))].sort(),
    targetTypes: [...new Set((facets ?? []).map((r) => String(r.target_type)))].sort(),
    admins: [...new Set((facets ?? []).map((r) => String(r.admin_email ?? "")).filter(Boolean))].sort(),
    page: p.page,
    pageSize: p.pageSize,
    total: count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / p.pageSize)),
  };
}

/* ================================================================== */
/* SYSTEM HEALTH                                                       */
/* ================================================================== */
type CheckStatus = "healthy" | "degraded" | "failing" | "unknown";
type Check = { id: string; label: string; status: CheckStatus; detail: string; source: string };

export async function system({ sb, query }: Ctx): Promise<Json> {
  const windowMinutes = int(query, "window", 60, 5, 1440);
  const { data, error } = await sb.rpc("admin_system_health", { p_window_minutes: windowMinutes });
  if (error) throw dbError("system.health", error);
  const health = (data ?? {}) as Json;

  const checks: Check[] = [];

  // 1) Database — the RPC above only returned because Postgres answered.
  checks.push({
    id: "database",
    label: "Supabase Postgres",
    status: "healthy",
    detail: `Aggregate query over the last ${windowMinutes} minute(s) completed.`,
    source: "admin_system_health() RPC round trip",
  });

  // 2) Edge/API liveness — a real same-origin request to the deployed probe.
  checks.push(await probeHealthEndpoint());

  const rate = (node: unknown, totalKey = "total", failedKey = "failed") => {
    const n = (node ?? {}) as Record<string, number>;
    const total = Number(n[totalKey] ?? 0);
    const failed = Number(n[failedKey] ?? 0);
    return { total, failed, pct: total > 0 ? (failed / total) * 100 : 0 };
  };

  const searchRate = rate(health.searches);
  const stuckSearches = Number(((health.searches ?? {}) as Record<string, number>).stuck ?? 0);
  checks.push({
    id: "search",
    label: "Search pipeline",
    status:
      searchRate.total === 0 && stuckSearches === 0
        ? "unknown"
        : stuckSearches > 0 || searchRate.pct >= 25
          ? "failing"
          : searchRate.pct > 5
            ? "degraded"
            : "healthy",
    detail:
      searchRate.total === 0 && stuckSearches === 0
        ? "No searches ran in this window, so there is nothing to measure."
        : `${searchRate.failed}/${searchRate.total} failed` + (stuckSearches ? `, ${stuckSearches} job(s) stuck over 15 min` : ""),
    source: "lead_searches.status + lead_search_jobs.status",
  });

  const exportRate = rate(health.exports);
  const stuckExports = Number(((health.exports ?? {}) as Record<string, number>).stuck ?? 0);
  checks.push({
    id: "exports",
    label: "Export pipeline",
    status:
      exportRate.total === 0 && stuckExports === 0
        ? "unknown"
        : stuckExports > 0 || exportRate.pct >= 25
          ? "failing"
          : exportRate.pct > 5
            ? "degraded"
            : "healthy",
    detail:
      exportRate.total === 0 && stuckExports === 0
        ? "No exports ran in this window."
        : `${exportRate.failed}/${exportRate.total} failed` + (stuckExports ? `, ${stuckExports} stuck` : ""),
    source: "exports.status",
  });

  const aiRate = rate(health.ai);
  checks.push({
    id: "ai",
    label: "AI (OpenRouter)",
    status: !(process.env.OPENROUTER_API_KEY ?? "").trim()
      ? "failing"
      : aiRate.total === 0
        ? "unknown"
        : aiRate.pct >= 25
          ? "failing"
          : aiRate.pct > 5
            ? "degraded"
            : "healthy",
    detail: !(process.env.OPENROUTER_API_KEY ?? "").trim()
      ? "OPENROUTER_API_KEY is not configured on this deployment."
      : aiRate.total === 0
        ? "No AI requests in this window."
        : `${aiRate.failed}/${aiRate.total} failed`,
    source: "ai_requests.status + server environment presence check",
  });

  const hookRate = rate(health.webhooks);
  const unprocessed = Number(((health.webhooks ?? {}) as Record<string, number>).unprocessed ?? 0);
  checks.push({
    id: "webhooks",
    label: "Razorpay webhooks",
    status:
      hookRate.total === 0 && unprocessed === 0
        ? "unknown"
        : unprocessed > 0 || hookRate.pct >= 10
          ? "failing"
          : hookRate.failed > 0
            ? "degraded"
            : "healthy",
    detail:
      hookRate.total === 0 && unprocessed === 0
        ? "No webhook deliveries in this window."
        : `${hookRate.failed}/${hookRate.total} failed` + (unprocessed ? `, ${unprocessed} stuck unprocessed` : ""),
    source: "webhook_events.status",
  });

  const payRate = rate(health.payments);
  checks.push({
    id: "billing",
    label: "Billing",
    status: !(process.env.RAZORPAY_KEY_ID ?? "").trim()
      ? "failing"
      : payRate.total === 0
        ? "unknown"
        : payRate.pct >= 20
          ? "failing"
          : payRate.failed > 0
            ? "degraded"
            : "healthy",
    detail: !(process.env.RAZORPAY_KEY_ID ?? "").trim()
      ? "RAZORPAY_KEY_ID is not configured on this deployment."
      : payRate.total === 0
        ? "No payment attempts in this window."
        : `${payRate.failed}/${payRate.total} failed`,
    source: "payments.status + server environment presence check",
  });

  // Provider configuration presence. Booleans only — values are never read.
  const config = {
    supabase_url: Boolean((process.env.SUPABASE_URL ?? "").trim()),
    supabase_publishable: Boolean((process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim()),
    supabase_service_role: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEYS ?? "").trim()),
    serpapi: Boolean((process.env.SERPAPI_API_KEY ?? "").trim()),
    openrouter: Boolean((process.env.OPENROUTER_API_KEY ?? "").trim()),
    razorpay: Boolean((process.env.RAZORPAY_KEY_ID ?? "").trim() && (process.env.RAZORPAY_KEY_SECRET ?? "").trim()),
    razorpay_webhook_secret: Boolean((process.env.RAZORPAY_WEBHOOK_SECRET ?? "").trim()),
    razorpay_plans: Boolean(
      (process.env.RAZORPAY_PLAN_GROWTH_ID ?? "").trim() &&
        (process.env.RAZORPAY_PLAN_AGENCY_ID ?? "").trim() &&
        (process.env.RAZORPAY_PLAN_SCALE_ID ?? "").trim(),
    ),
    resend: Boolean((process.env.RESEND_API_KEY ?? "").trim()),
    app_url: Boolean((process.env.APP_URL ?? "").trim()),
  };

  const worst: CheckStatus = checks.some((c) => c.status === "failing")
    ? "failing"
    : checks.some((c) => c.status === "degraded")
      ? "degraded"
      : checks.every((c) => c.status === "unknown")
        ? "unknown"
        : "healthy";

  return { windowMinutes, overall: worst, checks, health, config };
}

/** Real HTTP probe of the deployed liveness route — never a hardcoded "ok". */
async function probeHealthEndpoint(): Promise<Check> {
  const base =
    (process.env.APP_URL ?? "").trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!base) {
    return {
      id: "api",
      label: "Vercel API (/api/health)",
      status: "unknown",
      detail: "Neither APP_URL nor VERCEL_URL is set, so the probe has no origin to call.",
      source: "GET /api/health",
    };
  }
  const started = Date.now();
  try {
    const response = await fetch(new URL("/api/health", base).toString(), {
      signal: AbortSignal.timeout(5_000),
    });
    const ms = Date.now() - started;
    if (!response.ok) {
      return {
        id: "api",
        label: "Vercel API (/api/health)",
        status: "failing",
        detail: `Responded ${response.status} in ${ms}ms.`,
        source: "GET /api/health",
      };
    }
    return {
      id: "api",
      label: "Vercel API (/api/health)",
      status: ms > 2000 ? "degraded" : "healthy",
      detail: `Responded 200 in ${ms}ms.`,
      source: "GET /api/health",
    };
  } catch {
    return {
      id: "api",
      label: "Vercel API (/api/health)",
      status: "failing",
      detail: "The liveness probe did not respond within 5s.",
      source: "GET /api/health",
    };
  }
}

/* ================================================================== */
/* SETTINGS                                                            */
/* ================================================================== */
export async function settings({ sb }: Ctx): Promise<Json> {
  const { data, error } = await sb.rpc("admin_list_users", {
    p_search: "",
    p_plan: "",
    p_role: "admin",
    p_status: "",
    p_sub_status: "",
    p_from: null,
    p_to: null,
    p_sort: "created_at",
    p_dir: "asc",
    p_limit: 100,
    p_offset: 0,
  });
  if (error) throw dbError("settings.admins", error);

  const { data: recent, error: recentError } = await sb
    .from("admin_audit_logs")
    .select("id, admin_email, action, target_type, target_id, summary, created_at")
    .in("action", ["user.role_changed", "user.suspended", "user.reactivated"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (recentError) throw dbError("settings.recent", recentError);

  return {
    admins: ((data ?? []) as (Json & { total_count?: number })[]).map(({ total_count: _i, ...rest }) => rest),
    recentAccessChanges: recent ?? [],
    // Honest capability report rather than toggles that do nothing.
    capabilities: {
      featureFlags: false,
      maintenanceMode: false,
      impersonation: false,
      webhookRetry: false,
    },
    notes: {
      featureFlags:
        "No feature-flag table or runtime evaluator exists in this codebase. Adding a toggle here would be cosmetic, so the surface is withheld until a real flag model ships.",
      maintenanceMode:
        "Maintenance mode would need enforcement in every API route and the SPA shell. Not implemented, so it is not offered.",
      impersonation:
        "Logging in as a customer is not implemented. The read-only Customer 360 at /admin/users/:id exists instead and is sufficient for support.",
      webhookRetry:
        "Razorpay webhooks are verified by HMAC over the raw request body, which is not retained. A replay could not be verified, so no retry button is offered. Use billing reconciliation instead.",
    },
  };
}
