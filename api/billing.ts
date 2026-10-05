// ============================================================================
// /api/billing — Paddle Billing actions for the authenticated user.
//
//   checkout → validate the plan + upgrade path, create (or reuse) a
//              server-generated checkout intent, and return ONLY browser-safe
//              data: the PUBLIC Paddle price id for the plan, the checkout
//              token, the display amount and the server's Paddle environment.
//              Nothing is granted here — Paddle Checkout creates the
//              subscription only when the customer pays, and the entitlement
//              lands through verified webhooks / server-side provider reads.
//
//   upgrade  → for a user who already has an active Paddle subscription:
//              server-side PATCH of the EXISTING subscription to the next
//              plan's price (prorated_immediately, on_payment_failure=
//              prevent_change). Never creates a second subscription.
//
//   sync     → reconcile from the Paddle API (optionally seeded with the
//              transaction id the browser saw at checkout completion).
//
//   cancel   → cancel at the end of the paid period; access is kept until
//              current_period_end, then subscription.canceled finalizes.
//
// Security model: the browser is never the source of truth. A plan only
// changes after the SERVER verified provider state (webhook signature or a
// fresh read from the Paddle API with the server-only key). The browser
// supplies at most a plan name and its own session token.
// ============================================================================
import { randomBytes } from "node:crypto";
import { type SupabaseClient, type User } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SupabaseServerConfigError } from "./_lib/supabase-server.js";
import { createServiceClient } from "./_lib/supabase-service.js";
import {
  paddleCancelSubscription,
  paddleGetSubscription,
  paddleGetTransaction,
  paddlePriceMap,
  paddleUpdateSubscriptionPrice,
  PaddleError,
  requirePaddleCredentials,
  requirePriceIdForPlan,
} from "./_lib/paddle.js";
import {
  applyPaddleSubscription,
  effectivePlanOf,
  logBillingActivity,
  paidPlanLabel,
  recordPaddleTransaction,
  resolveSubscriptionOwner,
  type SubscriptionRow,
} from "./_lib/paddle-apply.js";
import {
  nextPlan,
  normalizePaddleSubscription,
  planForPriceId,
  statusEntitles,
  type PaidPlanId,
  type PricePlanMap,
} from "./_lib/paddle-core.js";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };
type Json = Record<string, unknown>;

export const maxDuration = 60;

type BillingAction = "checkout" | "upgrade" | "sync" | "cancel";

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "billing_error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Privileged Supabase client. Billing is the one customer-facing route that
 * needs write access (it persists verified Paddle state), and it only ever
 * touches the authenticated caller's own rows. Configuration and the
 * "never accept a publishable key here" guard live in _lib/supabase-service.
 */
function serviceClient(): SupabaseClient {
  return createServiceClient("billing", "/api/billing");
}

function bodyOf(req: VercelRequest): Json {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body as Json;
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
    } catch {
      throw new ApiError(400, "The billing request wasn't valid JSON.", "invalid_json");
    }
  }
  throw new ApiError(400, "A billing request is required.", "missing_body");
}

function tokenOf(req: VercelRequest) {
  const value = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const token = value?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new ApiError(401, "Your session expired — sign in again.", "auth_missing");
  return token;
}

function actionOf(input: unknown): BillingAction {
  const action = String(input ?? "");
  if (action === "checkout" || action === "upgrade" || action === "sync" || action === "cancel") return action;
  throw new ApiError(400, "Unknown billing action.", "action_invalid");
}

/** A paid plan name from the browser is only ever a HINT — validated below. */
function planOf(input: unknown): PaidPlanId {
  const plan = String(input ?? "").toLowerCase();
  if (plan === "growth" || plan === "agency" || plan === "scale") return plan;
  throw new ApiError(400, "That plan doesn't exist.", "plan_invalid");
}

async function requireCaller(sb: SupabaseClient, token: string): Promise<User> {
  const {
    data: { user },
    error,
  } = await sb.auth.getUser(token);
  if (error || !user) throw new ApiError(401, "Your session expired — sign in again.", "auth_invalid");
  return user;
}

function dbFailed(message: string, code: string) {
  return new ApiError(500, message, code);
}

async function subscriptionRow(sb: SupabaseClient, userId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await sb
    .from("subscriptions")
    .select(
      "id, user_id, plan_id, status, billing_provider, provider_subscription_id, provider_customer_id, provider_price_id, current_period_start, current_period_end, cancel_at_cycle_end, currency",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbFailed("Couldn't read your current subscription. Please try again.", "subscription_read_failed");
  return (data as SubscriptionRow | null) ?? null;
}

/* ------------------------------------------------------------------ */
/* checkout — prepare a Paddle Checkout for a FIRST paid subscription */
/* ------------------------------------------------------------------ */

type PlanRow = { id: string; price_cents: number; currency: string | null };

async function planRow(sb: SupabaseClient, planId: PaidPlanId): Promise<PlanRow> {
  const { data, error } = await sb
    .from("plans")
    .select("id, price_cents, currency")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw dbFailed("Couldn't read the plan catalog. Please try again.", "plan_read_failed");
  if (!data) throw new ApiError(500, `The ${planId} plan isn't configured yet.`, "billing_config");
  return data as PlanRow;
}

/**
 * A checkout may only be prepared for the immediate next plan on the ladder
 * (free → growth → agency → scale) and only when no live Paddle subscription
 * exists. Users with an active subscription must use `upgrade`; users with a
 * legacy Razorpay subscription keep their recorded entitlement until its
 * period ends (no Razorpay API call is ever made again).
 */
async function assertCheckoutAllowed(sb: SupabaseClient, user: User, planId: PaidPlanId): Promise<void> {
  const sub = await subscriptionRow(sb, user.id);

  /* Legacy Razorpay subscriber: the migration (0009) marked their row
     billing_provider='razorpay'. Their recorded entitlement is preserved
     until current_period_end; a new checkout would double-bill them. */
  if (sub?.billing_provider === "razorpay" && effectivePlanOf(sub) !== "free") {
    throw new ApiError(
      409,
      "Your current subscription is on our legacy billing provider and runs until the end of its billing period. After that you can subscribe again here — nothing new was charged.",
      "legacy_provider_active",
    );
  }

  if (sub?.provider_subscription_id) {
    const status = String(sub.status ?? "");
    if (statusEntitles(status) || status === "past_due") {
      throw new ApiError(
        409,
        "You already have an active subscription. Use the upgrade action to change your plan — you'll never be charged twice.",
        "upgrade_required",
      );
    }
  }

  const currentPlan = effectivePlanOf(sub);
  const allowedTarget = nextPlan(currentPlan);
  if (allowedTarget !== planId) {
    if (allowedTarget === null) {
      throw new ApiError(400, "You're already on the highest available plan.", "highest_plan");
    }
    throw new ApiError(
      400,
      `Upgrade one step at a time — from the ${paidPlanLabel(currentPlan)} plan the next plan is ${paidPlanLabel(allowedTarget)}.`,
      "plan_not_next",
    );
  }
}

async function checkout(sb: SupabaseClient, user: User, body: Json) {
  const planId = planOf(body.plan);
  const { environment } = requirePaddleCredentials("billing");
  const priceId = requirePriceIdForPlan(planId);
  const plan = await planRow(sb, planId);
  await assertCheckoutAllowed(sb, user, planId);

  /* Retry-friendly: a pending checkout intent from the last hour is reused
     (same token, same price) instead of piling up new intents when someone
     closes the Paddle modal and clicks Upgrade again. */
  const { data: reusable, error: reuseError } = await sb
    .from("subscription_checkouts")
    .select("checkout_token, provider_price_id, created_at")
    .eq("user_id", user.id)
    .eq("plan_id", planId)
    .eq("billing_provider", "paddle")
    .eq("status", "pending")
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reuseError) throw dbFailed("Couldn't start checkout. Please try again.", "checkout_read_failed");

  let checkoutToken = typeof reusable?.checkout_token === "string" ? reusable.checkout_token : null;
  if (!checkoutToken) {
    checkoutToken = randomBytes(24).toString("hex");
    const { error: writeError } = await sb.from("subscription_checkouts").insert({
      user_id: user.id,
      plan_id: planId,
      billing_provider: "paddle",
      checkout_token: checkoutToken,
      provider_price_id: priceId,
      status: "pending",
      amount_cents: plan.price_cents,
      currency: plan.currency ?? "USD",
    });
    if (writeError) throw dbFailed("Couldn't start checkout. Please try again.", "checkout_write_failed");
  }

  return {
    checkoutToken,
    priceId,
    planId,
    planLabel: paidPlanLabel(planId),
    amount: plan.price_cents,
    currency: plan.currency ?? "USD",
    description: `${paidPlanLabel(planId)} plan · monthly`,
    customerEmail: user.email ?? "",
    environment,
  };
}

/* ------------------------------------------------------------------ */
/* upgrade — change the EXISTING Paddle subscription to the next plan */
/* ------------------------------------------------------------------ */

async function upgrade(sb: SupabaseClient, user: User, body: Json, priceMap: PricePlanMap) {
  const planId = planOf(body.plan);
  requirePaddleCredentials("billing");

  const sub = await subscriptionRow(sb, user.id);
  if (sub?.billing_provider === "razorpay" && effectivePlanOf(sub) !== "free") {
    throw new ApiError(
      409,
      "Your current subscription is on our legacy billing provider and runs until the end of its billing period. After that you can subscribe again here — nothing new was charged.",
      "legacy_provider_active",
    );
  }
  if (!sub?.provider_subscription_id || sub.billing_provider !== "paddle") {
    throw new ApiError(404, "You don't have an active subscription to upgrade. Start one from the plans below.", "subscription_missing");
  }
  if (!statusEntitles(String(sub.status ?? ""))) {
    throw new ApiError(409, "Your subscription can't be upgraded right now. Refresh this page in a moment.", "subscription_not_upgradable");
  }

  const allowedTarget = nextPlan(sub.plan_id);
  if (allowedTarget === null) {
    throw new ApiError(400, "Scale is the highest available plan.", "highest_plan");
  }
  if (allowedTarget !== planId) {
    throw new ApiError(
      400,
      `Upgrade one step at a time — from the ${paidPlanLabel(sub.plan_id)} plan the next plan is ${paidPlanLabel(allowedTarget)}.`,
      "plan_not_next",
    );
  }
  const priceId = requirePriceIdForPlan(planId);

  /* Re-read the subscription from Paddle so the change is applied to the
     provider's actual state — our row could be a few seconds stale. */
  const remote = await paddleGetSubscription(sub.provider_subscription_id);
  const remoteSub = normalizePaddleSubscription(remote);
  if (!remoteSub) throw new ApiError(502, "Our payment provider returned an unreadable subscription.", "provider_malformed");
  const remotePlan = planForPriceId(remoteSub.providerPriceId, priceMap);
  if (!remotePlan || remotePlan !== sub.plan_id) {
    throw new ApiError(409, "Your subscription changed recently. Refresh this page and try again.", "subscription_changed");
  }

  /* The plan change itself: replace the base-plan price on the EXISTING
     subscription, bill the prorated difference immediately, and refuse the
     whole change when the immediate payment fails (prevent_change). */
  const updated = await paddleUpdateSubscriptionPrice(sub.provider_subscription_id, priceId);
  const updatedSub = normalizePaddleSubscription(updated);
  if (!updatedSub) throw new ApiError(502, "Our payment provider returned an unreadable subscription.", "provider_malformed");

  const result = await applyPaddleSubscription(sb, {
    userId: user.id,
    sub: updatedSub,
    priceMap,
    eventAt: new Date().toISOString(),
    skipDuplicateGuard: true,
  });
  if (!result.applied) throw dbFailed("Your payment went through, but we couldn't update your plan. Contact support@zybble.com.", "subscription_write_failed");

  await logBillingActivity(sb, user.id, `${paidPlanLabel(planId)} plan upgrade confirmed`);

  return {
    ok: true,
    planId: result.planId,
    status: result.status,
    currentPeriodEnd: updatedSub.currentPeriodEnd,
  };
}

/* ------------------------------------------------------------------ */
/* sync — reconcile from the Paddle API                               */
/* ------------------------------------------------------------------ */

/**
 * Pull the authoritative state from Paddle. The database stays the source of
 * truth for entitlement, but a webhook can be delayed or missed, so the
 * Billing page reconciles on load. Only provider state can move the plan.
 *
 * `transactionId` is an optional HINT the browser got from Paddle's
 * checkout.completed event. It is never trusted directly: the transaction is
 * re-read from the Paddle API, the checkout-intent token inside it must
 * belong to the caller, and the entitlement is applied from the subscription
 * entity the API returns.
 */
async function sync(sb: SupabaseClient, user: User, body: Json, priceMap: PricePlanMap) {
  const sub = await subscriptionRow(sb, user.id);

  /* No provider subscription yet — maybe a checkout just completed and the
     webhook hasn't landed. Resolve through the transaction the browser saw. */
  const transactionHint = typeof body.transactionId === "string" ? body.transactionId.trim() : "";
  if (!sub?.provider_subscription_id) {
    if (transactionHint.startsWith("txn_")) {
      const txn = await paddleGetTransaction(transactionHint);
      const status = String((txn as Json).status ?? "");
      if (status === "paid" || status === "completed") {
        const token = String(((txn as Json).custom_data as Json | undefined)?.zybble_token ?? "");
        const { userId } = await resolveSubscriptionOwner(sb, {
          providerSubscriptionId: typeof (txn as Json).subscription_id === "string" ? String((txn as Json).subscription_id) : null,
          checkoutToken: token || null,
        });
        if (userId !== user.id) {
          throw new ApiError(403, "That payment doesn't belong to your account.", "checkout_mismatch");
        }
        await recordPaddleTransaction(sb, { userId: user.id, entity: txn, settled: true });

        const subscriptionId = typeof (txn as Json).subscription_id === "string" ? String((txn as Json).subscription_id) : null;
        if (subscriptionId) {
          const remote = await paddleGetSubscription(subscriptionId);
          const remoteSub = normalizePaddleSubscription(remote);
          if (remoteSub) {
            const result = await applyPaddleSubscription(sb, {
              userId: user.id,
              sub: remoteSub,
              priceMap,
              eventAt: new Date().toISOString(),
            });
            return { ok: true, planId: result.planId, status: result.status, entitled: statusEntitles(result.status ?? "") };
          }
        }
      }
      return { ok: true, status: "processing" };
    }
    return { ok: true, status: sub?.status ?? "free" };
  }

  if (sub.billing_provider !== "paddle" || !sub.provider_subscription_id) {
    return { ok: true, status: sub?.status ?? "free" };
  }

  const remote = await paddleGetSubscription(sub.provider_subscription_id);
  const remoteSub = normalizePaddleSubscription(remote);
  if (!remoteSub) throw new ApiError(502, "Our payment provider returned an unreadable subscription.", "provider_malformed");

  const result = await applyPaddleSubscription(sb, {
    userId: user.id,
    sub: remoteSub,
    priceMap,
    eventAt: new Date().toISOString(),
    skipDuplicateGuard: true,
  });
  return { ok: true, planId: result.planId, status: result.status, entitled: statusEntitles(result.status ?? "") };
}

/* ------------------------------------------------------------------ */
/* cancel — end of the paid period                                    */
/* ------------------------------------------------------------------ */

async function cancel(sb: SupabaseClient, user: User) {
  const sub = await subscriptionRow(sb, user.id);
  if (!sub?.provider_subscription_id || sub.billing_provider !== "paddle") {
    throw new ApiError(404, "You don't have an active paid subscription.", "subscription_missing");
  }

  const remote = await paddleCancelSubscription(sub.provider_subscription_id);
  const scheduled = (remote as Json).scheduled_change as Json | undefined;
  const effectiveAt =
    typeof scheduled?.effective_at === "string" ? scheduled.effective_at : sub.current_period_end ?? null;

  const { error: updateError } = await sb
    .from("subscriptions")
    .update({
      cancel_at_cycle_end: true,
      cancel_at: effectiveAt,
      last_event_at: new Date().toISOString(),
    })
    .eq("id", sub.id);
  if (updateError) throw dbFailed("Couldn't update your cancellation status. Please contact support@zybble.com.", "subscription_write_failed");

  await logBillingActivity(sb, user.id, "Subscription cancellation requested (effective cycle end)");

  return { ok: true, cancelAtCycleEnd: true, accessUntil: sub.current_period_end ?? effectiveAt };
}

/* ------------------------------------------------------------------ */
/* handler                                                            */
/* ------------------------------------------------------------------ */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed", code: "method_not_allowed" });
  }

  try {
    const body = bodyOf(req);
    const action = actionOf(body.action);
    const token = tokenOf(req);
    const sb = serviceClient();
    const user = await requireCaller(sb, token);
    const priceMap = paddlePriceMap();

    const result =
      action === "checkout"
        ? await checkout(sb, user, body)
        : action === "upgrade"
          ? await upgrade(sb, user, body, priceMap)
          : action === "sync"
            ? await sync(sb, user, body, priceMap)
            : await cancel(sb, user);

    return res.status(200).json(result);
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : error instanceof PaddleError
        ? new ApiError(error.status, error.message, error.code)
        : error instanceof SupabaseServerConfigError
          ? new ApiError(error.status, error.message, error.code)
          : new ApiError(500, "Billing couldn't complete that action. Please try again.", "unknown");
    if (!(error instanceof ApiError) && !(error instanceof PaddleError)) {
      console.error("api request", { route: "/api/billing", status: apiError.status, code: apiError.code });
    }
    return res.status(apiError.status).json({ error: apiError.message, code: apiError.code });
  }
}
