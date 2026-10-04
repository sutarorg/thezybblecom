// ============================================================================
// razorpay-webhook — signature-verified, idempotent subscription lifecycle.
// Deploy with verify_jwt = false (see config.toml / README): webhooks cannot
// carry a user JWT, so the HMAC signature IS the authentication boundary.
//
// This function is the authority for Zybble entitlement. The browser callback
// path (/api/billing action=verify) only short-circuits the wait; every state
// transition below is re-applied from the provider's own signed events.
//
// Handled: subscription.authenticated / activated / charged / updated /
// pending / halted / paused / resumed / cancelled / completed / expired,
// payment.captured, payment.failed, refund.processed.
//
// Idempotency: Razorpay's own `x-razorpay-event-id` header is the dedupe key
// (falling back to a derived key), stored in `webhook_events.event_id` with a
// UNIQUE constraint. A duplicate delivery returns 200 without re-applying.
// ============================================================================
import {
  BILLING_CURRENCY,
  PLAN_LABELS,
  epochToIso,
  errorJson,
  handleError,
  invoiceNumber,
  json,
  mapSubscriptionStatus,
  serviceClient,
  verifyRazorpaySignature,
  type PaidPlanId,
} from "../_shared/index.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const PAID_PLANS = ["growth", "agency", "scale"];

function planLabelFor(planId: string) {
  return PLAN_LABELS[planId as PaidPlanId] ?? "Plan";
}

/** Resolve the Zybble user + plan for a provider subscription id. */
async function resolveOwner(
  sb: Any,
  subscriptionId: string | null,
  notes: Record<string, unknown>,
): Promise<{ userId: string | null; planId: string | null }> {
  let userId = typeof notes?.user_id === "string" ? notes.user_id : null;
  let planId = typeof notes?.plan === "string" && PAID_PLANS.includes(notes.plan) ? notes.plan : null;

  if (subscriptionId) {
    const { data: checkout } = await sb
      .from("subscription_checkouts")
      .select("user_id, plan_id")
      .eq("razorpay_subscription_id", subscriptionId)
      .maybeSingle();
    userId = userId ?? checkout?.user_id ?? null;
    planId = planId ?? checkout?.plan_id ?? null;

    if (!userId || !planId) {
      const { data: sub } = await sb
        .from("subscriptions")
        .select("user_id, plan_id")
        .eq("razorpay_subscription_id", subscriptionId)
        .maybeSingle();
      userId = userId ?? sub?.user_id ?? null;
      planId = planId ?? sub?.plan_id ?? null;
    }
  }
  return { userId, planId };
}

async function recordPayment(
  sb: Any,
  input: {
    userId: string;
    payment: Any;
    subscriptionId: string | null;
    planId: string | null;
    status: "captured" | "failed" | "refunded";
    periodStart: string | null;
    periodEnd: string | null;
  },
) {
  const paymentId = String(input.payment?.id ?? "");
  if (!paymentId) return;
  const amount = Number(input.payment?.amount ?? 0);
  const currency = String(input.payment?.currency ?? BILLING_CURRENCY).toUpperCase();

  const { data: sub } = await sb
    .from("subscriptions")
    .select("id")
    .eq("user_id", input.userId)
    .maybeSingle();

  await sb.from("payments").upsert(
    {
      user_id: input.userId,
      subscription_id: sub?.id ?? null,
      razorpay_payment_id: paymentId,
      razorpay_subscription_id: input.subscriptionId,
      // Razorpay reports the smallest unit of `currency`; Zybble is INR-only.
      amount_cents: amount,
      currency: currency === BILLING_CURRENCY ? BILLING_CURRENCY : currency,
      status: input.status,
      method: typeof input.payment?.method === "string" ? input.payment.method : null,
      captured_at: input.status === "captured" ? new Date().toISOString() : null,
      notes: input.payment?.notes ?? {},
    },
    { onConflict: "razorpay_payment_id" },
  );

  if (input.status !== "captured") return;

  // One invoice per payment — the unique index makes a duplicate delivery a
  // no-op update instead of a second invoice line.
  await sb.from("invoices").upsert(
    {
      user_id: input.userId,
      subscription_id: sub?.id ?? null,
      number: invoiceNumber(paymentId),
      description: `${planLabelFor(input.planId ?? "")} plan · monthly`,
      amount_cents: amount,
      currency: BILLING_CURRENCY,
      status: "paid",
      razorpay_invoice_id: paymentId,
      razorpay_payment_id: paymentId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
    },
    { onConflict: "razorpay_invoice_id" },
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  try {
    const sb = serviceClient();
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");

    await verifyRazorpaySignature(rawBody, signature);

    const payload = JSON.parse(rawBody);
    const eventType = String(payload.event ?? "unknown");
    const subscription = payload.payload?.subscription?.entity ?? null;
    const payment = payload.payload?.payment?.entity ?? null;
    const refund = payload.payload?.refund?.entity ?? null;

    /* Razorpay's own event id is the most reliable dedupe key. */
    const headerEventId = req.headers.get("x-razorpay-event-id");
    const eventId =
      headerEventId?.trim() ||
      `${eventType}:${subscription?.id ?? payment?.id ?? refund?.id ?? payload.created_at ?? crypto.randomUUID()}`;

    const { error: insertErr } = await sb.from("webhook_events").insert({
      provider: "razorpay",
      event_id: eventId,
      event_type: eventType,
      payload,
      attempts: 1,
    });
    if (insertErr) {
      // UNIQUE violation == this exact event was already received. Never
      // re-apply: re-processing a renewal would duplicate invoices.
      return json({ ok: true, deduplicated: true });
    }

    const notes = subscription?.notes ?? payment?.notes ?? {};
    const subscriptionId: string | null =
      (typeof subscription?.id === "string" ? subscription.id : null) ??
      (typeof payment?.subscription_id === "string" ? payment.subscription_id : null);

    const { userId, planId } = await resolveOwner(sb, subscriptionId, notes);

    if (!userId) {
      await sb
        .from("webhook_events")
        .update({ status: "processed", processed_at: new Date().toISOString(), error: "no_matching_user" })
        .eq("provider", "razorpay")
        .eq("event_id", eventId);
      return json({ ok: true, ignored: true });
    }

    try {
      const periodStart = epochToIso(subscription?.current_start);
      const periodEnd = epochToIso(subscription?.current_end);

      switch (eventType) {
        /* ---- mandate authenticated, first charge imminent --------------- */
        case "subscription.authenticated":
        /* ---- live subscription ----------------------------------------- */
        case "subscription.activated":
        case "subscription.charged":
        case "subscription.resumed":
        case "subscription.updated": {
          const providerStatus = String(subscription?.status ?? "");
          const mapped = mapSubscriptionStatus(providerStatus, "active");
          const entitled = providerStatus === "active" || providerStatus === "authenticated";
          const effectivePlan = planId && PAID_PLANS.includes(planId) ? planId : null;

          await sb.from("subscriptions").upsert(
            {
              user_id: userId,
              ...(effectivePlan ? { plan_id: effectivePlan } : {}),
              status: entitled ? "active" : mapped,
              currency: BILLING_CURRENCY,
              razorpay_customer_id:
                typeof subscription?.customer_id === "string" ? subscription.customer_id : undefined,
              razorpay_subscription_id: subscriptionId,
              razorpay_plan_id: typeof subscription?.plan_id === "string" ? subscription.plan_id : undefined,
              current_period_start: periodStart,
              current_period_end: periodEnd,
              charge_at: epochToIso(subscription?.charge_at),
              // cancel_at_cycle_end is owned by the cancel action and the
              // cancellation events below; an activation/renewal must not
              // silently clear or set a pending cancellation.
              last_event_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );

          await sb
            .from("subscription_checkouts")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("razorpay_subscription_id", subscriptionId);

          // subscription.charged carries the renewal/first payment entity.
          if (payment?.id) {
            await recordPayment(sb, {
              userId,
              payment,
              subscriptionId,
              planId: effectivePlan,
              status: String(payment.status ?? "") === "failed" ? "failed" : "captured",
              periodStart,
              periodEnd,
            });
          }
          break;
        }

        /* ---- renewal charge failed; provider is retrying ---------------- */
        case "subscription.pending": {
          await sb
            .from("subscriptions")
            .update({ status: "past_due", last_event_at: new Date().toISOString() })
            .eq("razorpay_subscription_id", subscriptionId);
          break;
        }

        case "subscription.halted": {
          await sb
            .from("subscriptions")
            .update({ status: "halted", last_event_at: new Date().toISOString() })
            .eq("razorpay_subscription_id", subscriptionId);
          break;
        }

        case "subscription.paused": {
          await sb
            .from("subscriptions")
            .update({ status: "paused", last_event_at: new Date().toISOString() })
            .eq("razorpay_subscription_id", subscriptionId);
          break;
        }

        /* ---- end of life: entitlement runs out at period end ------------ */
        case "subscription.cancelled":
        case "subscription.completed":
        case "subscription.expired": {
          const endsAt = periodEnd ?? epochToIso(subscription?.ended_at) ?? new Date().toISOString();
          const lapsed = new Date(endsAt).getTime() <= Date.now();
          await sb
            .from("subscriptions")
            .update({
              status: lapsed ? "expired" : "cancelled",
              ...(lapsed ? { plan_id: "free" } : {}),
              current_period_end: periodEnd,
              cancel_at: endsAt,
              cancel_at_cycle_end: !lapsed,
              last_event_at: new Date().toISOString(),
            })
            .eq("razorpay_subscription_id", subscriptionId);
          break;
        }

        /* ---- standalone payment events ---------------------------------- */
        case "payment.captured": {
          await recordPayment(sb, {
            userId,
            payment,
            subscriptionId,
            planId,
            status: "captured",
            periodStart,
            periodEnd,
          });
          break;
        }

        case "payment.failed": {
          await recordPayment(sb, {
            userId,
            payment,
            subscriptionId,
            planId,
            status: "failed",
            periodStart,
            periodEnd,
          });
          break;
        }

        case "refund.processed":
        case "refund.created": {
          const refundedPaymentId =
            typeof refund?.payment_id === "string" ? refund.payment_id : String(payment?.id ?? "");
          if (refundedPaymentId) {
            await sb
              .from("payments")
              .update({ status: "refunded" })
              .eq("razorpay_payment_id", refundedPaymentId);
            await sb
              .from("invoices")
              .update({ status: "refunded" })
              .eq("razorpay_invoice_id", refundedPaymentId);
          }
          break;
        }

        default:
          break;
      }
    } catch (e) {
      console.error("webhook handler error:", e);
      await sb
        .from("webhook_events")
        .update({ status: "failed", error: String(e).slice(0, 400) })
        .eq("provider", "razorpay")
        .eq("event_id", eventId);
      // 200 so Razorpay does not hot-loop; the row records the failure and
      // /api/billing action=sync reconciles the user on their next visit.
      return json({ ok: true, received: true });
    }

    await sb
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("provider", "razorpay")
      .eq("event_id", eventId);
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
});
