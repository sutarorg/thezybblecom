// ============================================================================
// billing — Razorpay subscription lifecycle for the Supabase Edge fallback.
//
// Contract is identical to the same-origin /api/billing route:
//   checkout → prepare an ON-SITE Razorpay Standard Checkout (never a hosted
//              page URL; `short_url` / `auth_link` are deliberately ignored)
//   verify   → signature + provider re-read, THEN grant the plan
//   sync     → reconcile from Razorpay
//   cancel   → cancel at cycle end (access until current_period_end)
//
// The browser is never the source of truth: a plan only changes after a
// server-verified payment or a signature-verified webhook.
// ============================================================================
import {
  BILLING_CURRENCY,
  HttpError,
  PLAN_LABELS,
  callerFromRequest,
  checkoutMethodConfig,
  corsHeaders,
  epochToIso,
  errorJson,
  handleError,
  invoiceNumber,
  json,
  logActivity,
  mapSubscriptionStatus,
  razorpay,
  serviceClient,
  statusEntitles,
  verifySubscriptionSignature,
  type PaidPlanId,
} from "../_shared/index.ts";

/* Plan → Razorpay plan id mapping lives server-side. */
const RAZORPAY_PLANS: Record<string, string | undefined> = {
  growth: Deno.env.get("RAZORPAY_PLAN_GROWTH_ID"),
  agency: Deno.env.get("RAZORPAY_PLAN_AGENCY_ID"),
  scale: Deno.env.get("RAZORPAY_PLAN_SCALE_ID"),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

function requireKeys() {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
  const secret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
  if (!keyId || !secret) {
    throw new HttpError(500, "Razorpay isn't configured on the server.", "billing_config");
  }
  return { keyId, secret };
}

async function applyActiveSubscription(
  sb: Sb,
  input: {
    userId: string;
    planId: PaidPlanId;
    providerStatus: string;
    status: string;
    subscriptionId: string;
    customerId: string | null;
    razorpayPlanId: string | null;
    currentStart: string | null;
    currentEnd: string | null;
    chargeAt: string | null;
    paymentId: string | null;
    amountMinor: number;
    paymentMethod: string | null;
    paymentStatus: string;
  },
) {
  const entitled = input.providerStatus === "active" || input.providerStatus === "authenticated";
  const { data: previous } = await sb
    .from("subscriptions")
    .select("id, razorpay_subscription_id")
    .eq("user_id", input.userId)
    .maybeSingle();

  const { error: upsertError } = await sb.from("subscriptions").upsert(
    {
      user_id: input.userId,
      plan_id: input.planId,
      status: entitled ? "active" : input.status,
      currency: BILLING_CURRENCY,
      razorpay_customer_id: input.customerId,
      razorpay_subscription_id: input.subscriptionId,
      razorpay_plan_id: input.razorpayPlanId,
      current_period_start: input.currentStart,
      current_period_end: input.currentEnd,
      charge_at: input.chargeAt,
      cancel_at: null,
      cancel_at_cycle_end: false,
      latest_payment_id: input.paymentId,
      last_event_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upsertError) {
    throw new HttpError(500, "Your payment went through, but we couldn't update your plan. Contact support@zybble.com.", "subscription_write_failed");
  }

  const { data: saved } = await sb.from("subscriptions").select("id").eq("user_id", input.userId).maybeSingle();

  if (input.paymentId) {
    await sb.from("payments").upsert(
      {
        user_id: input.userId,
        subscription_id: saved?.id ?? null,
        razorpay_payment_id: input.paymentId,
        razorpay_subscription_id: input.subscriptionId,
        amount_cents: input.amountMinor,
        currency: BILLING_CURRENCY,
        status: input.paymentStatus === "refunded" ? "refunded" : "captured",
        method: input.paymentMethod,
        captured_at: new Date().toISOString(),
      },
      { onConflict: "razorpay_payment_id" },
    );
    await sb.from("invoices").upsert(
      {
        user_id: input.userId,
        subscription_id: saved?.id ?? null,
        number: invoiceNumber(input.paymentId),
        description: `${PLAN_LABELS[input.planId]} plan · monthly`,
        amount_cents: input.amountMinor,
        currency: BILLING_CURRENCY,
        status: "paid",
        razorpay_invoice_id: input.paymentId,
        razorpay_payment_id: input.paymentId,
        period_start: input.currentStart,
        period_end: input.currentEnd,
      },
      { onConflict: "razorpay_invoice_id" },
    );
  }

  await sb
    .from("subscription_checkouts")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("razorpay_subscription_id", input.subscriptionId);

  const replaced = previous?.razorpay_subscription_id;
  if (replaced && replaced !== input.subscriptionId) {
    await razorpay(`/subscriptions/${replaced}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancel_at_cycle_end: 0 }),
    }).catch(() => undefined);
  }

  const { data: workspace } = await sb
    .from("workspaces")
    .select("id")
    .eq("owner_id", input.userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (workspace?.id) {
    await logActivity(sb, {
      workspaceId: workspace.id,
      actorId: input.userId,
      kind: "billing",
      text: `${PLAN_LABELS[input.planId]} plan activated`,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  try {
    const sb = serviceClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const user = await callerFromRequest(req, sb);

    if (action === "checkout") {
      const planId = String(body.plan ?? "").toLowerCase() as PaidPlanId;
      const razorpayPlan = RAZORPAY_PLANS[planId];
      if (!["growth", "agency", "scale"].includes(planId)) throw new HttpError(400, "That plan doesn't exist.");
      if (!razorpayPlan) throw new HttpError(500, `The ${planId} plan isn't available in payments yet.`, "billing_config");
      const { keyId } = requireKeys();

      const { data: plan } = await sb.from("plans").select("price_cents").eq("id", planId).maybeSingle();

      const { data: existingSub, error: existingSubError } = await sb
        .from("subscriptions")
        .select("razorpay_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existingSubError) throw new HttpError(500, "Couldn't read your current subscription. Please try again.", "subscription_read_failed");

      let customerId: string | null = existingSub?.razorpay_customer_id ?? null;

      // Reuse an abandoned-but-still-`created` checkout so retries don't pile
      // up orphan subscriptions at the provider.
      const { data: reusable } = await sb
        .from("subscription_checkouts")
        .select("razorpay_subscription_id")
        .eq("user_id", user.id)
        .eq("plan_id", planId)
        .eq("status", "created")
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let subscriptionId = "";
      if (reusable?.razorpay_subscription_id) {
        const remote = await razorpay(`/subscriptions/${reusable.razorpay_subscription_id}`).catch(() => null);
        if (remote && String(remote.status ?? "") === "created") {
          subscriptionId = String(remote.id);
          customerId = customerId ?? (typeof remote.customer_id === "string" ? remote.customer_id : null);
        }
      }

      if (!subscriptionId) {
        if (!customerId) {
          const customer = await razorpay("/customers", {
            method: "POST",
            body: JSON.stringify({ email: user.email, fail_existing: 0 }),
          });
          customerId = typeof customer.id === "string" ? customer.id : null;
          if (!customerId) throw new HttpError(502, "The payment provider didn't return a customer id. Please try again.", "provider_malformed");
        }

        const subscription = await razorpay("/subscriptions", {
          method: "POST",
          body: JSON.stringify({
            plan_id: razorpayPlan,
            total_count: 120,
            quantity: 1,
            customer_notify: 0,
            customer_id: customerId,
            notes: { user_id: user.id, plan: planId },
          }),
        });
        subscriptionId = typeof subscription.id === "string" ? subscription.id : "";
        if (!subscriptionId) throw new HttpError(502, "The payment provider didn't return a subscription id. Please try again.", "provider_malformed");

        const { error: writeError } = await sb.from("subscription_checkouts").upsert(
          {
            user_id: user.id,
            plan_id: planId,
            razorpay_subscription_id: subscriptionId,
            razorpay_customer_id: customerId,
            razorpay_plan_id: typeof subscription.plan_id === "string" ? subscription.plan_id : razorpayPlan,
            status: "created",
            amount_cents: plan?.price_cents ?? 0,
            currency: BILLING_CURRENCY,
          },
          { onConflict: "razorpay_subscription_id" },
        );
        if (writeError) throw new HttpError(500, "Couldn't start checkout. Please try again.", "checkout_write_failed");
      }

      // Browser-safe payload ONLY. No short_url, no auth_link, no /v1/l/… .
      return json({
        keyId,
        subscriptionId,
        planId,
        planLabel: PLAN_LABELS[planId],
        amount: plan?.price_cents ?? 0,
        currency: BILLING_CURRENCY,
        name: "Zybble",
        description: `${PLAN_LABELS[planId]} plan · monthly`,
        prefill: { email: user.email ?? "" },
        method: checkoutMethodConfig(Deno.env.get("RAZORPAY_CHECKOUT_METHODS")),
        notes: { user_id: user.id, plan: planId },
        themeColor: "#0e7a52",
      });
    }

    if (action === "verify") {
      const { secret } = requireKeys();
      const paymentId = String(body.razorpay_payment_id ?? "").trim();
      const subscriptionId = String(body.razorpay_subscription_id ?? "").trim();
      const signature = String(body.razorpay_signature ?? "").trim();
      if (!paymentId || !subscriptionId || !signature) {
        throw new HttpError(400, "That payment confirmation was incomplete.", "verify_invalid");
      }
      if (!(await verifySubscriptionSignature({ paymentId, subscriptionId, signature, secret }))) {
        throw new HttpError(400, "We couldn't verify that payment. Nothing was changed on your account.", "signature_invalid");
      }

      const { data: pending } = await sb
        .from("subscription_checkouts")
        .select("*")
        .eq("razorpay_subscription_id", subscriptionId)
        .maybeSingle();
      if (!pending || pending.user_id !== user.id) {
        throw new HttpError(403, "That payment doesn't belong to your account.", "checkout_mismatch");
      }

      const remote = await razorpay(`/subscriptions/${subscriptionId}`);
      const providerStatus = String(remote.status ?? "");
      const status = mapSubscriptionStatus(providerStatus, "created");
      if (!["authenticated", "active", "completed"].includes(providerStatus)) {
        throw new HttpError(402, "That subscription isn't active yet. If you were charged, it will appear here shortly.", "subscription_not_active");
      }

      const payment = await razorpay(`/payments/${paymentId}`);
      const paymentStatus = String(payment.status ?? "");
      if (!["captured", "authorized", "refunded"].includes(paymentStatus)) {
        throw new HttpError(402, "That payment hasn't been captured. Nothing was changed on your account.", "payment_not_captured");
      }
      if (String(payment.currency ?? BILLING_CURRENCY).toUpperCase() !== BILLING_CURRENCY) {
        throw new HttpError(400, "That payment used an unsupported currency.", "currency_invalid");
      }

      const planId = String(pending.plan_id) as PaidPlanId;
      await applyActiveSubscription(sb, {
        userId: user.id,
        planId,
        providerStatus,
        status,
        subscriptionId,
        customerId: typeof remote.customer_id === "string" ? remote.customer_id : pending.razorpay_customer_id ?? null,
        razorpayPlanId: typeof remote.plan_id === "string" ? remote.plan_id : pending.razorpay_plan_id ?? null,
        currentStart: epochToIso(remote.current_start),
        currentEnd: epochToIso(remote.current_end),
        chargeAt: epochToIso(remote.charge_at),
        paymentId,
        amountMinor: Number(payment.amount ?? pending.amount_cents ?? 0),
        paymentMethod: typeof payment.method === "string" ? payment.method : null,
        paymentStatus,
      });

      return json({ ok: true, planId, status, entitled: statusEntitles(status) });
    }

    if (action === "sync") {
      const { data: sub, error: subError } = await sb
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (subError) throw new HttpError(500, "Couldn't read your current subscription. Please try again.", "subscription_read_failed");
      if (!sub?.razorpay_subscription_id) return json({ ok: true, status: sub?.status ?? "free" });

      const remote = await razorpay(`/subscriptions/${sub.razorpay_subscription_id}`);
      const providerStatus = String(remote.status ?? "");
      const status = mapSubscriptionStatus(providerStatus, sub.status);
      const currentEnd = epochToIso(remote.current_end);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: Record<string, any> = {
        status,
        current_period_start: epochToIso(remote.current_start),
        current_period_end: currentEnd,
        charge_at: epochToIso(remote.charge_at),
        cancel_at: epochToIso(remote.ended_at) ?? epochToIso(remote.end_at),
        last_event_at: new Date().toISOString(),
      };
      if (
        ["cancelled", "completed", "expired"].includes(status) &&
        (!currentEnd || new Date(currentEnd).getTime() <= Date.now())
      ) {
        patch.plan_id = "free";
        patch.status = "expired";
        patch.cancel_at_cycle_end = false;
      }

      const { error: updateError } = await sb.from("subscriptions").update(patch).eq("id", sub.id);
      if (updateError) throw new HttpError(500, "Couldn't update your billing status. Please try again.", "subscription_write_failed");

      return json({ ok: true, status: String(patch.status ?? status) });
    }

    if (action === "cancel") {
      const { data: sub, error: subError } = await sb
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (subError) throw new HttpError(500, "Couldn't read your current subscription. Please try again.", "subscription_read_failed");
      if (!sub?.razorpay_subscription_id) throw new HttpError(404, "You don't have an active paid subscription.");

      await razorpay(`/subscriptions/${sub.razorpay_subscription_id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ cancel_at_cycle_end: 1 }),
      });

      const { error: updateError } = await sb
        .from("subscriptions")
        .update({
          cancel_at_cycle_end: true,
          cancel_at: sub.current_period_end ?? new Date().toISOString(),
          last_event_at: new Date().toISOString(),
        })
        .eq("id", sub.id);
      if (updateError) throw new HttpError(500, "Couldn't update your cancellation status. Please contact support@zybble.com.", "subscription_write_failed");

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

      return json({ ok: true, cancelAtCycleEnd: true, accessUntil: sub.current_period_end ?? null });
    }

    throw new HttpError(400, "Unknown billing action.");
  } catch (e) {
    return handleError(e);
  }
});
