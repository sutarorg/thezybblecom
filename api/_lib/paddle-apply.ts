// ============================================================================
// Applies VERIFIED Paddle state to the Zybble database.
//
// One implementation, three callers — /api/billing (checkout preparation
// never writes here; sync/upgrade do), /api/paddle-webhook, and the admin
// reconciliation action — so the entitlement rules can never drift between
// the webhook path and the API path:
//
//   • Entitlement comes ONLY from a provider-confirmed subscription status
//     (`active` / `trialing`), or a `cancelled` subscription whose paid
//     period has not ended yet (effective_plan_for_user(), migration 0006).
//   • The Zybble plan is derived from the PAID Paddle price id through the
//     server-side price map — never from a browser-supplied plan name.
//   • One subscription row per user (UNIQUE(user_id)); one user per provider
//     subscription (subscriptions_provider_sub_uidx, migration 0009).
//
// NOTE: imported with the emitted ".js" extension (see
// api/_tests/module-resolution.test.ts) because Vercel compiles api/**/*.ts
// to .js without rewriting import specifiers.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  invoiceNumber,
  normalizePaddleSubscription,
  normalizePaddleTransaction,
  paddleObject,
  planForPriceId,
  statusEntitles,
  type NormalizedPaddleSubscription,
  type PaidPlanId,
  type PricePlanMap,
} from "./paddle-core.js";

export type SubscriptionRow = {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  billing_provider: string | null;
  provider_subscription_id: string | null;
  current_period_end: string | null;
};

export type ApplyResult = {
  applied: boolean;
  planId: string | null;
  status: string | null;
  /** Set when the event was deliberately not applied (reason code). */
  reason?: string;
};

/* ------------------------------------------------------------------ */
/* Owner resolution                                                   */
/* ------------------------------------------------------------------ */

/**
 * Resolve the Zybble user for a Paddle subscription.
 *
 * Priority:
 *   1. The server-generated checkout token in `custom_data.zybble_token`
 *      (bound to the authenticated user who prepared the checkout — this is
 *      the purchase-intent pattern; the browser can't forge someone else's
 *      token because it is only ever returned to its owner).
 *   2. An existing subscriptions row carrying this provider subscription id.
 *
 * The resolved plan is ONLY a hint for logging/auditing — the granted plan is
 * always re-derived from the paid price id by the caller.
 */
export async function resolveSubscriptionOwner(
  sb: SupabaseClient,
  input: { providerSubscriptionId: string | null; checkoutToken: string | null },
): Promise<{ userId: string | null; intendedPlanId: string | null }> {
  let userId: string | null = null;
  let intendedPlanId: string | null = null;

  if (input.checkoutToken) {
    const { data: checkout } = await sb
      .from("subscription_checkouts")
      .select("user_id, plan_id")
      .eq("checkout_token", input.checkoutToken)
      .maybeSingle();
    userId = typeof checkout?.user_id === "string" ? checkout.user_id : null;
    intendedPlanId = typeof checkout?.plan_id === "string" ? checkout.plan_id : null;
  }

  if (!userId && input.providerSubscriptionId) {
    const { data: sub } = await sb
      .from("subscriptions")
      .select("user_id")
      .eq("provider_subscription_id", input.providerSubscriptionId)
      .maybeSingle();
    userId = typeof sub?.user_id === "string" ? sub.user_id : null;
  }

  return { userId, intendedPlanId };
}

/* ------------------------------------------------------------------ */
/* Subscription state                                                 */
/* ------------------------------------------------------------------ */

/**
 * Upsert the user's subscription row from a normalized, VERIFIED Paddle
 * subscription. Never called with browser-supplied data.
 *
 * `eventAt` is the provider event time (webhook occurred_at / API read time)
 * used for `last_event_at` bookkeeping.
 */
export async function applyPaddleSubscription(
  sb: SupabaseClient,
  input: {
    userId: string;
    sub: NormalizedPaddleSubscription;
    priceMap: PricePlanMap;
    eventAt?: string | null;
    /** Skip the duplicate-subscription guard (used when caller just verified it). */
    skipDuplicateGuard?: boolean;
  },
): Promise<ApplyResult> {
  const { userId, sub } = input;
  const eventAt = input.eventAt ?? new Date().toISOString();

  const paidPlan = planForPriceId(sub.providerPriceId, input.priceMap);

  const { data: existing } = await sb
    .from("subscriptions")
    .select("id, plan_id, status, provider_subscription_id, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  /* One live paid subscription per user: if a DIFFERENT Paddle subscription
     is already entitling this user, this event must not replace it. This is
     the guard against double-checkout races (two tabs, both completed). */
  if (
    !input.skipDuplicateGuard &&
    existing &&
    existing.provider_subscription_id &&
    existing.provider_subscription_id !== sub.providerSubscriptionId &&
    existing.status !== null &&
    statusEntitles(String(existing.status))
  ) {
    return { applied: false, planId: null, status: null, reason: "duplicate_subscription_blocked" };
  }

  const patch: Record<string, unknown> = {
    user_id: userId,
    billing_provider: "paddle",
    status: sub.status,
    provider_customer_id: sub.providerCustomerId,
    provider_subscription_id: sub.providerSubscriptionId,
    provider_price_id: sub.providerPriceId,
    ...(sub.currency ? { currency: sub.currency } : {}),
    current_period_start: sub.currentPeriodStart,
    /* A canceled Paddle subscription reports no current period; keep the last
       known end so entitlement runs to the end of the paid period
       (effective_plan_for_user honours `cancelled` + unexpired period). */
    current_period_end:
      sub.currentPeriodEnd ??
      (existing?.current_period_end && sub.status === "cancelled" ? existing.current_period_end : null),
    charge_at: sub.nextBilledAt,
    cancel_at: sub.scheduledAction === "cancel" ? sub.scheduledEffectiveAt : sub.canceledAt,
    cancel_at_cycle_end: sub.scheduledAction === "cancel",
    last_event_at: eventAt,
  };

  /* The stored plan only changes when the paid price maps to a known plan.
     An unrecognized price never silently upgrades or downgrades anyone. */
  if (paidPlan) {
    patch.plan_id = paidPlan;
  } else if (existing?.plan_id) {
    patch.plan_id = existing.plan_id;
  } else {
    // No prior plan and no recognizable price: nothing to entitle.
    return { applied: false, planId: null, status: sub.status, reason: "unknown_price_id" };
  }

  /* A finished paid period falls back to Free (mirrors the 0006 sync rule):
     entitlement already computes this live; normalizing the stored row keeps
     the Billing UI and reporting honest. */
  const periodEnd = (patch.current_period_end as string | null) ?? null;
  if (
    sub.status === "cancelled" &&
    (!periodEnd || new Date(periodEnd).getTime() <= Date.now()) &&
    !statusEntitles(sub.status)
  ) {
    patch.status = "expired";
    patch.plan_id = "free";
    patch.cancel_at_cycle_end = false;
  }

  const { error } = await sb
    .from("subscriptions")
    .upsert(patch, { onConflict: "user_id" });
  if (error) {
    console.error("billing write", { code: "subscription_write_failed" });
    throw new Error("subscription_write_failed");
  }

  /* The checkout intent that produced this subscription is complete.
     Best-effort: a failure here never blocks the subscription write above. */
  try {
    if (sub.checkoutToken) {
      await sb
        .from("subscription_checkouts")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          provider_subscription_id: sub.providerSubscriptionId,
          provider_customer_id: sub.providerCustomerId,
          provider_price_id: sub.providerPriceId,
        })
        .eq("checkout_token", sub.checkoutToken);
    } else if (sub.providerSubscriptionId) {
      await sb
        .from("subscription_checkouts")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("provider_subscription_id", sub.providerSubscriptionId);
    }
  } catch {
    /* best-effort */
  }

  return {
    applied: true,
    planId: String(patch.plan_id ?? (paidPlan ?? "free")),
    status: String(patch.status ?? sub.status),
  };
}

/** Convenience wrapper: normalize then apply a raw Paddle subscription. */
export async function applyPaddleSubscriptionEntity(
  sb: SupabaseClient,
  input: { userId: string; entity: unknown; priceMap: PricePlanMap; eventAt?: string | null },
): Promise<ApplyResult & { normalized: NormalizedPaddleSubscription | null }> {
  const normalized = normalizePaddleSubscription(input.entity);
  if (!normalized) return { applied: false, planId: null, status: null, reason: "malformed_subscription", normalized: null };
  const applied = await applyPaddleSubscription(sb, { ...input, sub: normalized });
  return { ...applied, normalized };
}

/* ------------------------------------------------------------------ */
/* Transactions → payments / invoices                                */
/* ------------------------------------------------------------------ */

/**
 * Record a Paddle transaction as a `payments` row (and, when it settled, an
 * `invoices` row). Idempotent on the provider transaction id — Paddle retries
 * events, so this must be safe to run twice.
 */
export async function recordPaddleTransaction(
  sb: SupabaseClient,
  input: {
    userId: string;
    entity: unknown;
    settled: boolean;
    failureStatus?: "failed" | "canceled";
  },
): Promise<void> {
  const txn = normalizePaddleTransaction(input.entity);
  if (!txn) return;

  const { data: sub } = await sb
    .from("subscriptions")
    .select("id")
    .eq("user_id", input.userId)
    .maybeSingle();

  try {
    await sb.from("payments").upsert(
      {
        user_id: input.userId,
        subscription_id: sub?.id ?? null,
        billing_provider: "paddle",
        provider_payment_id: txn.providerTransactionId,
        provider_transaction_id: txn.providerTransactionId,
        provider_subscription_id: txn.providerSubscriptionId,
        amount_cents: txn.amountMinor,
        currency: txn.currency ?? "USD",
        status: input.settled ? "captured" : (input.failureStatus ?? "failed"),
        method: txn.paymentMethod,
        captured_at: input.settled ? (txn.occurredAt ?? new Date().toISOString()) : null,
      },
      { onConflict: "provider_payment_id" },
    );
  } catch (error) {
    console.error("billing write", { code: "payment_write_failed", detail: String(error).slice(0, 120) });
  }

  if (!input.settled) return;

  try {
    await sb.from("invoices").upsert(
      {
        user_id: input.userId,
        subscription_id: sub?.id ?? null,
        number: txn.invoiceNumber ?? invoiceNumber(txn.providerTransactionId),
        description: "Zybble plan · monthly",
        amount_cents: txn.amountMinor,
        currency: txn.currency ?? "USD",
        status: "paid",
        billing_provider: "paddle",
        provider_invoice_id: txn.invoiceId ?? txn.providerTransactionId,
        provider_transaction_id: txn.providerTransactionId,
        provider_subscription_id: txn.providerSubscriptionId,
        period_start: txn.billingPeriodStart,
        period_end: txn.billingPeriodEnd,
        issued_at: txn.occurredAt ?? new Date().toISOString(),
      },
      { onConflict: "provider_invoice_id" },
    );
  } catch (error) {
    console.error("billing write", { code: "invoice_write_failed", detail: String(error).slice(0, 120) });
  }
}

/* ------------------------------------------------------------------ */
/* Activity log (best-effort, never blocks a billing write)            */
/* ------------------------------------------------------------------ */

export async function logBillingActivity(sb: SupabaseClient, userId: string, text: string): Promise<void> {
  try {
    const { data: workspace } = await sb
      .from("workspaces")
      .select("id")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (workspace?.id) {
      await sb.from("activity_logs").insert({ workspace_id: workspace.id, actor_id: userId, kind: "billing", text });
    }
  } catch {
    /* activity logging is best-effort */
  }
}

/** The subscription fields effectivePlanOf needs (a subset of any row shape). */
export type EntitlementRow = {
  plan_id?: string | null;
  status?: string | null;
  current_period_end?: string | null;
};

/** Effective plan for a subscription row, mirroring effective_plan_for_user(). */
export function effectivePlanOf(row: EntitlementRow | null | undefined): string {
  if (!row?.plan_id) return "free";
  const status = String(row.status ?? "");
  if (status === "active" || status === "trialing") return row.plan_id;
  if (
    (status === "cancelled" || status === "completed") &&
    row.current_period_end &&
    new Date(row.current_period_end).getTime() > Date.now()
  ) {
    return row.plan_id;
  }
  return "free";
}

/** Read a paid plan label for activity text without importing the catalog. */
export function paidPlanLabel(plan: string | null | undefined): string {
  switch (plan) {
    case "growth":
      return "Growth";
    case "agency":
      return "Agency";
    case "scale":
      return "Scale";
    default:
      return "Plan";
  }
}

/** Extract the plan-ladder target for upgrade validation. */
export function isPaidPlanId(value: string | null | undefined): value is PaidPlanId {
  return value === "growth" || value === "agency" || value === "scale";
}

/** Narrow helper re-exported for webhook handlers. */
export { paddleObject };
