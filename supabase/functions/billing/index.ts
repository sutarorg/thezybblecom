// ============================================================================
// billing — Paddle Billing lifecycle for the Supabase Edge fallback.
//
// Contract is identical to the same-origin /api/billing route:
//   checkout → validate the plan + upgrade ladder, create/reuse a
//              server-generated checkout intent, return ONLY browser-safe
//              data (public price id, checkout token, amount, environment).
//              Nothing is granted here — Paddle Checkout only creates the
//              subscription when the customer pays.
//   upgrade  → PATCH the EXISTING Paddle subscription to the next plan's
//              price (prorated_immediately + on_payment_failure=
//              prevent_change). Never a second subscription.
//   sync     → reconcile from the Paddle API (optionally seeded with the
//              transaction id the browser saw at checkout completion).
//   cancel   → cancel at period end (access until current_period_end).
//
// The browser is never the source of truth: a plan only changes after the
// server verified provider state (webhook signature or a fresh API read).
// ============================================================================
import {
  HttpError,
  callerFromRequest,
  corsHeaders,
  errorJson,
  handleError,
  json,
  logActivity,
  serviceClient,
} from "../_shared/index.ts";
import {
  applyPaddleSubscription,
  effectivePlanOf,
  hasPaddleCredentials,
  normalizePaddleSubscription,
  paddlePriceMap,
  paddleRequest,
  planForPriceId,
  planLabel,
  recordPaddleTransaction,
  requirePriceIdForPlan,
  resolveSubscriptionOwner,
  statusEntitles,
  type PaidPlanId,
} from "../_shared/billing.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

function planOf(raw: unknown): PaidPlanId {
  const plan = String(raw ?? "").toLowerCase();
  if (plan === "growth" || plan === "agency" || plan === "scale") return plan;
  throw new HttpError(400, "That plan doesn't exist.", "plan_invalid");
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function nextPlanFor(plan: string): PaidPlanId | null {
  const ladder = ["free", "growth", "agency", "scale"];
  const index = ladder.indexOf(plan);
  if (index === -1 || index >= ladder.length - 1) return null;
  return ladder[index + 1] as PaidPlanId;
}

async function subscriptionRow(sb: Sb, userId: string) {
  const { data, error } = await sb
    .from("subscriptions")
    .select("id, plan_id, status, billing_provider, provider_subscription_id, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Couldn't read your current subscription. Please try again.", "subscription_read_failed");
  return data ?? null;
}

/**
 * A checkout may only be prepared for the immediate next plan and only when
 * no live Paddle subscription exists. Legacy Razorpay subscribers keep their
 * recorded entitlement until the paid period ends; no Razorpay API call is
 * ever made.
 */
async function assertCheckoutAllowed(sb: Sb, userId: string, planId: PaidPlanId) {
  const sub = await subscriptionRow(sb, userId);

  if (sub?.billing_provider === "razorpay" && effectivePlanOf(sub) !== "free") {
    throw new HttpError(
      409,
      "Your current subscription is on our legacy billing provider and runs until the end of its billing period. After that you can subscribe again here — nothing new was charged.",
      "legacy_provider_active",
    );
  }

  if (sub?.provider_subscription_id) {
    const status = String(sub.status ?? "");
    if (statusEntitles(status) || status === "past_due") {
      throw new HttpError(
        409,
        "You already have an active subscription. Use the upgrade action to change your plan — you'll never be charged twice.",
        "upgrade_required",
      );
    }
  }

  const allowedTarget = nextPlanFor(effectivePlanOf(sub));
  if (allowedTarget !== planId) {
    if (allowedTarget === null) throw new HttpError(400, "You're already on the highest available plan.", "highest_plan");
    throw new HttpError(
      400,
      `Upgrade one step at a time — from the ${planLabel(effectivePlanOf(sub))} plan the next plan is ${planLabel(allowedTarget)}.`,
      "plan_not_next",
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  const startedAt = Date.now();
  try {
    const sb = serviceClient();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const user = await callerFromRequest(req, sb);
    const priceMap = paddlePriceMap();

    /* ---------------------------------------------------------------- */
    if (action === "checkout") {
      const planId = planOf(body.plan);
      if (!hasPaddleCredentials()) {
        throw new HttpError(
          500,
          "Paddle isn't configured on this server. Set the PADDLE_API_KEY secret (see README → Deploy the Edge Functions), then redeploy.",
          "billing_config",
        );
      }
      const priceId = requirePriceIdForPlan(planId, "billing");
      const { data: plan } = await sb.from("plans").select("price_cents, currency").eq("id", planId).maybeSingle();
      await assertCheckoutAllowed(sb, user.id, planId);

      // Reuse a pending intent from the last hour (same plan) so reopening
      // the Paddle modal doesn't pile up intents.
      const { data: reusable } = await sb
        .from("subscription_checkouts")
        .select("checkout_token")
        .eq("user_id", user.id)
        .eq("plan_id", planId)
        .eq("billing_provider", "paddle")
        .eq("status", "pending")
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let checkoutToken = typeof reusable?.checkout_token === "string" ? reusable.checkout_token : null;
      if (!checkoutToken) {
        checkoutToken = randomToken();
        const { error: writeError } = await sb.from("subscription_checkouts").insert({
          user_id: user.id,
          plan_id: planId,
          billing_provider: "paddle",
          checkout_token: checkoutToken,
          provider_price_id: priceId,
          status: "pending",
          amount_cents: plan?.price_cents ?? 0,
          currency: plan?.currency ?? "USD",
        });
        if (writeError) throw new HttpError(500, "Couldn't start checkout. Please try again.", "checkout_write_failed");
      }

      // Browser-safe payload ONLY: the PUBLIC price id, the checkout intent
      // token, display amount, and which Paddle environment to load. No
      // server credentials ever appear here.
      return json({
        checkoutToken,
        priceId,
        planId,
        planLabel: planLabel(planId),
        amount: plan?.price_cents ?? 0,
        currency: plan?.currency ?? "USD",
        description: `${planLabel(planId)} plan · monthly`,
        customerEmail: user.email ?? "",
      });
    }

    /* ---------------------------------------------------------------- */
    if (action === "upgrade") {
      const planId = planOf(body.plan);
  const sub = await subscriptionRow(sb, user.id);
  if (sub?.billing_provider === "razorpay" && effectivePlanOf(sub) !== "free") {
    throw new HttpError(
      409,
      "Your current subscription is on our legacy billing provider and runs until the end of its billing period. After that you can subscribe again here — nothing new was charged.",
      "legacy_provider_active",
    );
  }
  if (!sub?.provider_subscription_id || sub.billing_provider !== "paddle") {
    throw new HttpError(404, "You don't have an active subscription to upgrade. Start one from the plans below.", "subscription_missing");
  }
      if (!statusEntitles(String(sub.status ?? ""))) {
        throw new HttpError(409, "Your subscription can't be upgraded right now. Refresh this page in a moment.", "subscription_not_upgradable");
      }

      const allowedTarget = nextPlanFor(String(sub.plan_id ?? "free"));
      if (allowedTarget === null) throw new HttpError(400, "Scale is the highest available plan.", "highest_plan");
      if (allowedTarget !== planId) {
        throw new HttpError(
          400,
          `Upgrade one step at a time — from the ${planLabel(String(sub.plan_id))} plan the next plan is ${planLabel(allowedTarget)}.`,
          "plan_not_next",
        );
      }
      const priceId = requirePriceIdForPlan(planId, "billing");

      // Re-read from Paddle so the change applies to actual provider state.
      const remote = await paddleRequest(`/subscriptions/${encodeURIComponent(sub.provider_subscription_id)}`, {}, "billing");
      const remoteSub = normalizePaddleSubscription(remote);
      if (!remoteSub) throw new HttpError(502, "Our payment provider returned an unreadable subscription.", "provider_malformed");
      const remotePlan = planForPriceId(remoteSub.providerPriceId, priceMap);
      if (!remotePlan || remotePlan !== sub.plan_id) {
        throw new HttpError(409, "Your subscription changed recently. Refresh this page and try again.", "subscription_changed");
      }

      // The plan change itself: replace the base price on the EXISTING
      // subscription, bill the prorated difference immediately, refuse the
      // whole change when the payment fails (prevent_change).
      const updated = await paddleRequest(
        `/subscriptions/${encodeURIComponent(sub.provider_subscription_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            items: [{ price_id: priceId, quantity: 1 }],
            proration_billing_mode: "prorated_immediately",
            on_payment_failure: "prevent_change",
            scheduled_change: null,
          }),
        },
        "billing",
      );
      const updatedSub = normalizePaddleSubscription(updated);
      if (!updatedSub) throw new HttpError(502, "Our payment provider returned an unreadable subscription.", "provider_malformed");

      const result = await applyPaddleSubscription(sb, {
        userId: user.id,
        sub: updatedSub,
        priceMap,
        skipDuplicateGuard: true,
      });
      if (!result.applied) {
        throw new HttpError(500, "Your payment went through, but we couldn't update your plan. Contact support@zybble.com.", "subscription_write_failed");
      }

      const { data: workspace } = await sb
        .from("workspaces")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (workspace?.id) {
        await logActivity(sb, {
          workspaceId: workspace.id,
          actorId: user.id,
          kind: "billing",
          text: `${planLabel(planId)} plan upgrade confirmed`,
        });
      }

      return json({ ok: true, planId: result.planId, status: result.status, currentPeriodEnd: updatedSub.currentPeriodEnd });
    }

    /* ---------------------------------------------------------------- */
    if (action === "sync") {
      const sub = await subscriptionRow(sb, user.id);

      const transactionHint = typeof body.transactionId === "string" ? body.transactionId.trim() : "";
      if (!sub?.provider_subscription_id) {
        if (transactionHint.startsWith("txn_")) {
          const txn = await paddleRequest(`/transactions/${encodeURIComponent(transactionHint)}`, {}, "billing");
          const raw = txn as Record<string, unknown>;
          const status = String(raw.status ?? "");
          if (status === "paid" || status === "completed") {
            const customData = (raw.custom_data ?? {}) as Record<string, unknown>;
            const token = typeof customData.zybble_token === "string" ? customData.zybble_token : "";
            const { userId } = await resolveSubscriptionOwner(sb, {
              providerSubscriptionId: typeof raw.subscription_id === "string" ? String(raw.subscription_id) : null,
              checkoutToken: token || null,
            });
            if (userId !== user.id) {
              throw new HttpError(403, "That payment doesn't belong to your account.", "checkout_mismatch");
            }
            await recordPaddleTransaction(sb, { userId: user.id, entity: txn, settled: true });

            const subscriptionId = typeof raw.subscription_id === "string" ? String(raw.subscription_id) : null;
            if (subscriptionId) {
              const remote = await paddleRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {}, "billing");
              const remoteSub = normalizePaddleSubscription(remote);
              if (remoteSub) {
                const result = await applyPaddleSubscription(sb, { userId: user.id, sub: remoteSub, priceMap });
                return json({ ok: true, planId: result.planId, status: result.status, entitled: statusEntitles(result.status ?? "") });
              }
            }
          }
          return json({ ok: true, status: "processing" });
        }
        return json({ ok: true, status: sub?.status ?? "free" });
      }

      if (sub.billing_provider !== "paddle") {
        return json({ ok: true, status: sub?.status ?? "free" });
      }

      const remote = await paddleRequest(`/subscriptions/${encodeURIComponent(sub.provider_subscription_id)}`, {}, "billing");
      const remoteSub = normalizePaddleSubscription(remote);
      if (!remoteSub) throw new HttpError(502, "Our payment provider returned an unreadable subscription.", "provider_malformed");

      const result = await applyPaddleSubscription(sb, {
        userId: user.id,
        sub: remoteSub,
        priceMap,
        skipDuplicateGuard: true,
      });
      return json({ ok: true, planId: result.planId, status: result.status, entitled: statusEntitles(result.status ?? "") });
    }

    /* ---------------------------------------------------------------- */
    if (action === "cancel") {
      const sub = await subscriptionRow(sb, user.id);
      if (!sub?.provider_subscription_id || sub.billing_provider !== "paddle") {
        throw new HttpError(404, "You don't have an active paid subscription.", "subscription_missing");
      }

      const remote = await paddleRequest(`/subscriptions/${encodeURIComponent(sub.provider_subscription_id)}/cancel`, {
        method: "POST",
        body: JSON.stringify({ effective_from: "next_billing_period" }),
      }, "billing");
      const scheduled = (remote as Record<string, unknown>).scheduled_change as Record<string, unknown> | undefined;
      const effectiveAt = typeof scheduled?.effective_at === "string"
        ? scheduled.effective_at
        : sub.current_period_end ?? null;

      const { error: updateError } = await sb
        .from("subscriptions")
        .update({
          cancel_at_cycle_end: true,
          cancel_at: effectiveAt,
          last_event_at: new Date().toISOString(),
        })
        .eq("id", sub.id);
      if (updateError) {
        throw new HttpError(500, "Couldn't update your cancellation status. Please contact support@zybble.com.", "subscription_write_failed");
      }

      const { data: workspace } = await sb
        .from("workspaces")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (workspace?.id) {
        await logActivity(sb, {
          workspaceId: workspace.id,
          actorId: user.id,
          kind: "billing",
          text: "Subscription cancellation requested (effective cycle end)",
        });
      }

      return json({ ok: true, cancelAtCycleEnd: true, accessUntil: sub.current_period_end ?? effectiveAt });
    }

    throw new HttpError(400, "Unknown billing action.", "action_invalid");
  } catch (e) {
    return handleError(e, { functionName: "billing", startedAt });
  }
});
