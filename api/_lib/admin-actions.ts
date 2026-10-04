// ============================================================================
// Admin console — privileged mutations.
//
// Every function here follows the same five steps, in this order:
//
//   1. authorization  — already done by requireAdmin() before dispatch
//   2. validation     — inputs are parsed and bounded, never trusted
//   3. operation      — performed with the privileged client
//   4. audit          — an immutable admin_audit_logs row, old → new
//   5. sanitized result — exactly what the UI needs, nothing else
//
// A failure never produces a success response: the UI only shows "done" when
// the database (or Razorpay) actually confirmed the change.
//
// NOTE: imported with the emitted ".js" extension (see
// api/_tests/module-resolution.test.ts).
// ============================================================================
import {
  AdminApiError,
  notFound,
  requireUuid,
  writeAudit,
  type AdminContext,
  type Json,
} from "./admin-core.js";
import { epochToIso, mapSubscriptionStatus } from "./billing-core.js";
import { razorpayRequest, RazorpayError } from "./razorpay.js";

function requireReason(body: Json, min = 3): string {
  const reason = String(body.reason ?? "").trim();
  if (reason.length < min) {
    throw new AdminApiError(400, "Give a short reason — it is recorded in the audit log.", "reason_required");
  }
  return reason.slice(0, 500);
}

function requireConfirmation(body: Json) {
  if (body.confirm !== true) {
    throw new AdminApiError(400, "That action needs an explicit confirmation.", "confirmation_required");
  }
}

/* ------------------------------------------------------------------ */
/* Role management                                                     */
/* ------------------------------------------------------------------ */

/**
 * Grant or revoke the `admin` role.
 *
 * The write goes through `admin_grant_role()` (migration 0008) rather than a
 * plain UPDATE because `profiles` carries the protect_profile_role trigger —
 * the same trigger that stops a customer promoting themselves. The function
 * refuses to remove the last administrator, so the console cannot lock the
 * company out of its own operations.
 */
export async function setUserRole(ctx: AdminContext, userId: string, body: Json) {
  const id = requireUuid(userId, "user");
  const role = String(body.role ?? "").trim();
  if (role !== "admin" && role !== "user") {
    throw new AdminApiError(400, "A role must be either 'admin' or 'user'.", "invalid_role");
  }
  const reason = requireReason(body);
  requireConfirmation(body);

  if (id === ctx.user.id && role === "user") {
    throw new AdminApiError(
      400,
      "You can't remove your own admin access — ask another administrator to do it.",
      "self_demotion",
    );
  }

  const { data, error } = await ctx.sb.rpc("admin_grant_role", { p_user: id, p_role: role });
  if (error) {
    const message =
      error.message?.includes("last_admin")
        ? "That is the last administrator — promote somebody else first."
        : error.message?.includes("user_not_found")
          ? "That customer doesn't exist."
          : "We couldn't change that role. Please try again.";
    await writeAudit(ctx, {
      action: role === "admin" ? "user.role.grant" : "user.role.revoke",
      targetType: "user",
      targetId: id,
      summary: `Failed to set role to ${role}`,
      metadata: { reason },
      result: "failure",
      error: error.code ?? "rpc_error",
    });
    console.error("admin action failed", { action: "user.role", code: error.code });
    throw new AdminApiError(error.message?.includes("last_admin") ? 409 : 400, message, "role_change_failed");
  }

  const result = (data ?? {}) as { before?: string; after?: string; email?: string; name?: string };
  await writeAudit(ctx, {
    action: role === "admin" ? "user.role.grant" : "user.role.revoke",
    targetType: "user",
    targetId: id,
    targetLabel: result.email ?? result.name ?? id,
    summary: `Role changed from ${result.before ?? "user"} to ${result.after ?? role}`,
    before: { role: result.before ?? null },
    after: { role: result.after ?? role },
    metadata: { reason },
  });

  return { ok: true, userId: id, role: result.after ?? role, previousRole: result.before ?? null };
}

/* ------------------------------------------------------------------ */
/* Account suspension                                                  */
/* ------------------------------------------------------------------ */

/**
 * Suspend / restore an account.
 *
 * This uses Supabase Auth's own ban mechanism (`ban_duration`), which is the
 * only suspension the product can actually ENFORCE: GoTrue refuses to issue
 * or refresh tokens for a banned user, so the customer is signed out
 * everywhere and the API rejects their requests. Inventing a
 * `profiles.status` column instead would be cosmetic — nothing reads it.
 */
export async function setUserSuspension(ctx: AdminContext, userId: string, body: Json) {
  const id = requireUuid(userId, "user");
  const suspend = body.suspend === true;
  const reason = requireReason(body);
  requireConfirmation(body);

  if (id === ctx.user.id) {
    throw new AdminApiError(400, "You can't suspend your own account.", "self_suspend");
  }

  const { data: existing, error: lookupError } = await ctx.sb.auth.admin.getUserById(id);
  if (lookupError || !existing?.user) throw notFound("That customer");
  const before = (existing.user as unknown as { banned_until?: string | null }).banned_until ?? null;

  // 100 years ≈ indefinite; restoring clears it. GoTrue accepts "none".
  const banDuration = suspend ? "876000h" : "none";
  const { data, error } = await ctx.sb.auth.admin.updateUserById(id, { ban_duration: banDuration });
  if (error) {
    await writeAudit(ctx, {
      action: suspend ? "user.suspend" : "user.restore",
      targetType: "user",
      targetId: id,
      targetLabel: existing.user.email ?? id,
      summary: suspend ? "Failed to suspend account" : "Failed to restore account",
      metadata: { reason },
      result: "failure",
      error: "auth_admin_error",
    });
    console.error("admin action failed", { action: "user.suspend", status: error.status });
    throw new AdminApiError(502, "We couldn't update that account's access. Please try again.", "suspend_failed");
  }

  const after = (data?.user as unknown as { banned_until?: string | null })?.banned_until ?? null;
  await writeAudit(ctx, {
    action: suspend ? "user.suspend" : "user.restore",
    targetType: "user",
    targetId: id,
    targetLabel: existing.user.email ?? id,
    summary: suspend ? "Account suspended (sign-in blocked)" : "Account restored",
    before: { banned_until: before },
    after: { banned_until: after },
    metadata: { reason },
  });

  return { ok: true, userId: id, suspended: suspend, bannedUntil: after };
}

/* ------------------------------------------------------------------ */
/* Billing reconciliation                                              */
/* ------------------------------------------------------------------ */

/**
 * Re-read a customer's subscription from Razorpay and store the provider's
 * answer. This is the read-then-reconcile half of /api/billing `sync` — it
 * never creates, cancels or charges anything, so it is safe to run while a
 * customer is on the phone.
 */
export async function syncSubscription(ctx: AdminContext, body: Json) {
  const userId = requireUuid(body.userId, "user");
  const reason = requireReason(body);

  const { data: sub, error } = await ctx.sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new AdminApiError(500, "We couldn't read that subscription. Please try again.", "query_failed");
  if (!sub) throw notFound("That subscription");
  if (!sub.razorpay_subscription_id) {
    throw new AdminApiError(400, "That customer has no Razorpay subscription to reconcile.", "no_provider_subscription");
  }

  let remote: Record<string, unknown>;
  try {
    remote = await razorpayRequest(`/subscriptions/${sub.razorpay_subscription_id}`, {}, "admin");
  } catch (providerError) {
    const mapped =
      providerError instanceof RazorpayError
        ? new AdminApiError(providerError.status, providerError.message, providerError.code)
        : new AdminApiError(502, "Our payment provider couldn't be reached.", "provider_unreachable");
    await writeAudit(ctx, {
      action: "subscription.sync",
      targetType: "subscription",
      targetId: String(sub.id),
      targetLabel: String(sub.razorpay_subscription_id),
      summary: "Provider reconciliation failed",
      metadata: { reason, userId },
      result: "failure",
      error: mapped.code,
    });
    throw mapped;
  }

  const providerStatus = String(remote.status ?? "");
  const status = mapSubscriptionStatus(providerStatus, String(sub.status ?? "created"));
  const currentEnd = epochToIso(remote.current_end);

  const patch: Record<string, unknown> = {
    status,
    current_period_start: epochToIso(remote.current_start),
    current_period_end: currentEnd,
    charge_at: epochToIso(remote.charge_at),
    cancel_at: epochToIso(remote.ended_at) ?? (remote.end_at ? epochToIso(remote.end_at) : null),
    last_event_at: new Date().toISOString(),
  };

  // Same lapse rule as /api/billing: a finished paid period falls back to Free.
  if (
    ["cancelled", "completed", "expired"].includes(status) &&
    (!currentEnd || new Date(currentEnd).getTime() <= Date.now())
  ) {
    patch.plan_id = "free";
    patch.status = "expired";
    patch.cancel_at_cycle_end = false;
  }

  const { error: updateError } = await ctx.sb.from("subscriptions").update(patch).eq("id", sub.id);
  if (updateError) {
    await writeAudit(ctx, {
      action: "subscription.sync",
      targetType: "subscription",
      targetId: String(sub.id),
      summary: "Provider state read but the local write failed",
      metadata: { reason, userId, providerStatus },
      result: "failure",
      error: "subscription_write_failed",
    });
    throw new AdminApiError(500, "We read the provider but couldn't save the result.", "subscription_write_failed");
  }

  await writeAudit(ctx, {
    action: "subscription.sync",
    targetType: "subscription",
    targetId: String(sub.id),
    targetLabel: String(sub.razorpay_subscription_id),
    summary: `Reconciled with Razorpay (provider status: ${providerStatus || "unknown"})`,
    before: {
      status: sub.status,
      plan_id: sub.plan_id,
      current_period_end: sub.current_period_end,
      cancel_at_cycle_end: sub.cancel_at_cycle_end,
    },
    after: {
      status: patch.status,
      plan_id: patch.plan_id ?? sub.plan_id,
      current_period_end: patch.current_period_end,
      cancel_at_cycle_end: patch.cancel_at_cycle_end ?? sub.cancel_at_cycle_end,
    },
    metadata: { reason, userId, providerStatus },
  });

  return {
    ok: true,
    userId,
    providerStatus,
    status: String(patch.status ?? status),
    planId: String(patch.plan_id ?? sub.plan_id),
    currentPeriodEnd: patch.current_period_end ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Plan entitlements                                                   */
/* ------------------------------------------------------------------ */

type PlanPatch = {
  lead_allowance?: number;
  max_lists?: number;
  max_users?: number;
  has_ai?: boolean;
  client_workspaces?: boolean;
  priority_processing?: boolean;
  price_cents?: number;
};

function parsePlanPatch(body: Json): PlanPatch {
  const patch: PlanPatch = {};
  const integer = (value: unknown, field: string, min: number, max: number, allowNegativeOne = false) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw new AdminApiError(400, `${field} must be a whole number.`, "invalid_value");
    if (allowNegativeOne && parsed === -1) return -1;
    if (parsed < min || parsed > max) {
      throw new AdminApiError(400, `${field} must be between ${min} and ${max}${allowNegativeOne ? " (or -1 for unlimited)" : ""}.`, "invalid_value");
    }
    return parsed;
  };

  if (body.lead_allowance !== undefined) patch.lead_allowance = integer(body.lead_allowance, "Lead allowance", 0, 10_000_000);
  if (body.max_lists !== undefined) patch.max_lists = integer(body.max_lists, "Max lists", 0, 100_000, true);
  if (body.max_users !== undefined) patch.max_users = integer(body.max_users, "Max seats", 1, 1_000);
  if (body.price_cents !== undefined) patch.price_cents = integer(body.price_cents, "Price", 0, 100_000_000);
  for (const flag of ["has_ai", "client_workspaces", "priority_processing"] as const) {
    if (body[flag] !== undefined) {
      if (typeof body[flag] !== "boolean") throw new AdminApiError(400, `${flag} must be true or false.`, "invalid_value");
      patch[flag] = body[flag] as boolean;
    }
  }
  if (Object.keys(patch).length === 0) throw new AdminApiError(400, "Nothing to change.", "empty_patch");
  return patch;
}

/**
 * Edit a plan's entitlements. The `plans` table is the single source of truth
 * for every server-side limit (reserve_leads, enforce_list_limit,
 * enforce_seat_limit, client-workspace and AI gating), so this is a real
 * product change — guarded accordingly:
 *
 *  • an explicit confirmation and a reason are mandatory;
 *  • lowering the lead allowance below what live workspaces have ALREADY used
 *    this period is reported back and refused unless `force` is set, so an
 *    edit cannot silently lock paying customers out mid-cycle;
 *  • changing `price_cents` only changes what Zybble displays and charges for
 *    NEW checkouts — the Razorpay plan amount lives at the provider, so the
 *    response flags the drift instead of pretending they are in sync.
 */
export async function updatePlan(ctx: AdminContext, planId: string, body: Json) {
  const id = String(planId ?? "").trim().toLowerCase();
  if (!["free", "growth", "agency", "scale"].includes(id)) {
    throw new AdminApiError(404, "That plan doesn't exist.", "not_found");
  }
  const patch = parsePlanPatch(body);
  const reason = requireReason(body);
  requireConfirmation(body);

  const { data: before, error: readError } = await ctx.sb.from("plans").select("*").eq("id", id).maybeSingle();
  if (readError) throw new AdminApiError(500, "We couldn't read that plan. Please try again.", "query_failed");
  if (!before) throw notFound("That plan");

  const changed = Object.entries(patch).filter(([key, value]) => (before as Json)[key] !== value);
  if (changed.length === 0) {
    return { ok: true, planId: id, changed: [], impact: null, unchanged: true };
  }

  // Impact check: who is already over the proposed allowance right now?
  let impact: { workspacesOverAllowance: number; highestUsage: number } | null = null;
  if (patch.lead_allowance !== undefined && patch.lead_allowance < before.lead_allowance) {
    const period = new Date();
    const periodStart = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    const { data: counters } = await ctx.sb
      .from("usage_counters")
      .select("workspace_id, leads_used, workspaces!inner(owner_id, plan_id)")
      .eq("period_start", periodStart)
      .gt("leads_used", patch.lead_allowance);

    const rows = (counters ?? []) as { leads_used: number }[];
    impact = {
      workspacesOverAllowance: rows.length,
      highestUsage: rows.reduce((max, row) => Math.max(max, Number(row.leads_used ?? 0)), 0),
    };
    if (impact.workspacesOverAllowance > 0 && body.force !== true) {
      throw new AdminApiError(
        409,
        `${impact.workspacesOverAllowance} workspace${impact.workspacesOverAllowance === 1 ? " has" : "s have"} already used more than ${patch.lead_allowance} leads this period. Confirm again to apply anyway.`,
        "plan_change_blocked",
      );
    }
  }

  const { data: after, error: updateError } = await ctx.sb
    .from("plans")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (updateError || !after) {
    await writeAudit(ctx, {
      action: "plan.update",
      targetType: "plan",
      targetId: id,
      targetLabel: id,
      summary: "Plan update failed",
      metadata: { reason, patch },
      result: "failure",
      error: "plan_write_failed",
    });
    throw new AdminApiError(500, "We couldn't save that plan change. Please try again.", "plan_write_failed");
  }

  await writeAudit(ctx, {
    action: "plan.update",
    targetType: "plan",
    targetId: id,
    targetLabel: id,
    summary: changed.map(([key, value]) => `${key}: ${String((before as Json)[key])} → ${String(value)}`).join(", "),
    before: Object.fromEntries(changed.map(([key]) => [key, (before as Json)[key]])),
    after: Object.fromEntries(changed),
    metadata: { reason, forced: body.force === true, impact },
  });

  return {
    ok: true,
    planId: id,
    plan: after,
    changed: changed.map(([key]) => key),
    impact,
    priceDrift: patch.price_cents !== undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Quota override                                                      */
/* ------------------------------------------------------------------ */

/**
 * Adjust a workspace's consumed lead quota for a billing period.
 *
 * It writes `usage_counters.leads_used` — the exact counter `reserve_leads()`
 * reserves against and the customer's /usage page reads — so the override can
 * never produce two different "used" numbers. Nothing else is touched: the
 * allowance still comes from the plan, and future searches keep metering
 * normally.
 */
export async function overrideUsage(ctx: AdminContext, body: Json) {
  const workspaceId = requireUuid(body.workspaceId, "workspace");
  const leadsUsed = Number(body.leadsUsed);
  if (!Number.isInteger(leadsUsed) || leadsUsed < 0 || leadsUsed > 10_000_000) {
    throw new AdminApiError(400, "Leads used must be a whole number of 0 or more.", "invalid_value");
  }
  const reason = requireReason(body, 5);
  requireConfirmation(body);

  const rawPeriod = String(body.period ?? "").trim();
  const now = new Date();
  const period = /^\d{4}-\d{2}-\d{2}$/.test(rawPeriod)
    ? rawPeriod
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

  const { data: workspace, error: workspaceError } = await ctx.sb
    .from("workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError) throw new AdminApiError(500, "We couldn't read that workspace.", "query_failed");
  if (!workspace) throw notFound("That workspace");

  const { data: existing } = await ctx.sb
    .from("usage_counters")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("period_start", period)
    .maybeSingle();

  const previous = Number(existing?.leads_used ?? 0);

  const { error: writeError } = await ctx.sb.from("usage_counters").upsert(
    {
      workspace_id: workspaceId,
      period_start: period,
      leads_used: leadsUsed,
      searches: existing?.searches ?? 0,
      exports: existing?.exports ?? 0,
      ai_runs: existing?.ai_runs ?? 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,period_start" },
  );
  if (writeError) {
    await writeAudit(ctx, {
      action: "usage.override",
      targetType: "usage",
      targetId: workspaceId,
      targetLabel: String(workspace.name ?? workspaceId),
      summary: "Quota override failed",
      metadata: { reason, period, requested: leadsUsed },
      result: "failure",
      error: "usage_write_failed",
    });
    throw new AdminApiError(500, "We couldn't apply that quota change. Please try again.", "usage_write_failed");
  }

  await writeAudit(ctx, {
    action: "usage.override",
    targetType: "usage",
    targetId: workspaceId,
    targetLabel: String(workspace.name ?? workspaceId),
    summary: `Leads used for ${period}: ${previous} → ${leadsUsed}`,
    before: { period_start: period, leads_used: previous },
    after: { period_start: period, leads_used: leadsUsed },
    metadata: { reason },
  });

  return { ok: true, workspaceId, period, previous, leadsUsed };
}
