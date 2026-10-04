// ============================================================================
// billing — Razorpay subscription lifecycle (checkout, sync, cancel).
// Browser is never the source of truth; subscription state comes from
// Razorpay events and server-side sync only.
// ============================================================================
import {
  HttpError,
  callerFromRequest,
  corsHeaders,
  errorJson,
  handleError,
  json,
  logActivity,
  razorpay,
  serviceClient,
} from "../_shared/index.ts";

/* Plan → Razorpay plan id mapping lives server-side. */
const RAZORPAY_PLANS: Record<string, string | undefined> = {
  growth: Deno.env.get("RAZORPAY_PLAN_GROWTH_ID"),
  agency: Deno.env.get("RAZORPAY_PLAN_AGENCY_ID"),
  scale: Deno.env.get("RAZORPAY_PLAN_SCALE_ID"),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  try {
    const sb = serviceClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const user = await callerFromRequest(req, sb);

    if (action === "checkout") {
      const planId = String(body.plan ?? "").toLowerCase();
      const razorpayPlan = RAZORPAY_PLANS[planId];
      if (!["growth", "agency", "scale"].includes(planId)) throw new HttpError(400, "That plan doesn't exist.");
      if (!razorpayPlan) throw new HttpError(500, `The ${planId} plan isn't available in payments yet.`);

      // reuse or create a Razorpay customer
      const { data: existingSub, error: existingSubError } = await sb
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existingSubError) throw new HttpError(500, "Couldn't read your current subscription. Please try again.", "subscription_read_failed");

      let customerId = existingSub?.razorpay_customer_id ?? null;
      if (!customerId) {
        const customer = await razorpay("/customers", {
          method: "POST",
          body: JSON.stringify({ email: user.email, fail_existing: 0 }),
        });
        customerId = typeof customer.id === "string" ? customer.id : null;
        if (!customerId) throw new HttpError(502, "The payment provider didn't return a customer id. Please try again.", "provider_malformed");
      }

      const appUrl = Deno.env.get("APP_URL") ?? "https://zybble.com";
      const subscription = await razorpay("/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          plan_id: razorpayPlan,
          total_count: 120,
          quantity: 1,
          customer_notify: 0,
          customer_id: customerId,
          notes: { user_id: user.id, plan: planId },
          notify_info: { notify_email: user.email ? [user.email] : [] },
        }),
      });

      const subscriptionId = typeof subscription.id === "string" ? subscription.id : "";
      if (!subscriptionId) throw new HttpError(502, "The payment provider didn't return a subscription id. Please try again.", "provider_malformed");

      const { error: upsertError } = await sb.from("subscriptions").upsert(
        {
          user_id: user.id,
          plan_id: planId,
          status: mapStatus(subscription.status, "active"),
          razorpay_customer_id: customerId,
          razorpay_subscription_id: subscriptionId,
          razorpay_plan_id: typeof subscription.plan_id === "string" ? subscription.plan_id : razorpayPlan,
          current_period_start: typeof subscription.current_start === "number" ? new Date(subscription.current_start * 1000).toISOString() : null,
          current_period_end: typeof subscription.current_end === "number" ? new Date(subscription.current_end * 1000).toISOString() : null,
        },
        { onConflict: "user_id" }
      );
      if (upsertError) throw new HttpError(500, "Checkout started, but we couldn't save your billing details. Please contact support@zybble.com.", "subscription_write_failed");

      const shortUrl = subscription.short_url ?? subscription.auth_link;
      return json({ url: shortUrl ?? `${appUrl}/billing`, subscriptionId });
    }

    if (action === "sync") {
      const { data: sub, error: subError } = await sb
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (subError) throw new HttpError(500, "Couldn't read your current subscription. Please try again.", "subscription_read_failed");
      if (!sub?.razorpay_subscription_id) return json({ ok: true, status: sub?.status ?? "active" });

      const remote = await razorpay(`/subscriptions/${sub.razorpay_subscription_id}`);
      const status = mapStatus(remote.status, sub.status);
      const { error: updateError } = await sb
        .from("subscriptions")
        .update({
          status,
          current_period_start: typeof remote.current_start === "number" ? new Date(remote.current_start * 1000).toISOString() : null,
          current_period_end: typeof remote.current_end === "number" ? new Date(remote.current_end * 1000).toISOString() : null,
          cancel_at: typeof remote.schedule_end === "number" ? new Date(remote.schedule_end * 1000).toISOString() : null,
        })
        .eq("id", sub.id);
      if (updateError) throw new HttpError(500, "Couldn't update your billing status. Please try again.", "subscription_write_failed");

      return json({ ok: true, status });
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

      const { error: updateError } = await sb.from("subscriptions").update({ status: "cancelled", cancel_at: new Date().toISOString() }).eq("id", sub.id);
      if (updateError) throw new HttpError(500, "Couldn't update your cancellation status. Please contact support@zybble.com.", "subscription_write_failed");

      const { data: workspace } = await sb.from("workspaces").select("id").eq("owner_id", user.id).limit(1).single();
      if (workspace?.id) {
        await logActivity(sb, {
          workspaceId: workspace.id,
          actorId: user.id,
          kind: "billing",
          text: "Subscription cancellation requested (effective cycle end)",
        });
      }

      return json({ ok: true });
    }

    throw new HttpError(400, "Unknown billing action.");
  } catch (e) {
    return handleError(e);
  }
});

function mapStatus(remote: unknown, fallback: string) {
  const status = String(remote ?? "");
  if (["active", "trialing", "paused", "cancelled"].includes(status)) return status;
  if (status === "expired" || status === "halted") return "failed";
  if (status === "pending") return "past_due";
  return fallback;
}
