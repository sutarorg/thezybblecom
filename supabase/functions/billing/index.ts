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

const PLAN_PRICES_USD: Record<string, number> = { growth: 4900, agency: 9900, scale: 19900 };

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
      const { data: existingSub } = await sb
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      let customerId = existingSub?.razorpay_customer_id ?? null;
      if (!customerId) {
        const customer = await razorpay("/customers", {
          method: "POST",
          body: JSON.stringify({ email: user.email, fail_existing: 0 }),
        });
        customerId = customer.id;
      }

      const appUrl = Deno.env.get("APP_URL") ?? "https://zybble.app";
      const subscription = await razorpay("/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          plan_id: razorpayPlan,
          total_count: 120,
          quantity: 1,
          customer_notify: 0,
          customer_id: customerId,
          notes: { user_id: user.id, plan: planId },
          notify_info: { notify_email: [user.email] },
        }),
      });

      await sb.from("subscriptions").upsert(
        {
          user_id: user.id,
          plan_id: planId,
          status: "trialing" === subscription.status ? "trialing" : "active",
          razorpay_customer_id: customerId,
          razorpay_subscription_id: subscription.id,
          razorpay_plan_id: subscription.plan_id,
        },
        { onConflict: "user_id" }
      );

      const shortUrl = subscription.short_url ?? subscription.auth_link;
      return json({ url: shortUrl ?? `${appUrl}/#/billing`, subscriptionId: subscription.id });
    }

    if (action === "sync") {
      const { data: sub } = await sb
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!sub?.razorpay_subscription_id) return json({ ok: true, status: sub?.status ?? "active" });

      const remote = await razorpay(`/subscriptions/${sub.razorpay_subscription_id}`);
      const status = mapStatus(remote.status, sub.status);
      await sb
        .from("subscriptions")
        .update({
          status,
          current_period_start: remote.current_start ? new Date(remote.current_start * 1000).toISOString() : null,
          current_period_end: remote.current_end ? new Date(remote.current_end * 1000).toISOString() : null,
          cancel_at: remote.schedule_end ? new Date(remote.schedule_end * 1000).toISOString() : null,
        })
        .eq("id", sub.id);

      return json({ ok: true, status });
    }

    if (action === "cancel") {
      const { data: sub } = await sb
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!sub?.razorpay_subscription_id) throw new HttpError(404, "You don't have an active paid subscription.");

      await razorpay(`/subscriptions/${sub.razorpay_subscription_id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ cancel_at_cycle_end: 1 }),
      });

      await sb.from("subscriptions").update({ status: "cancelled", cancel_at: new Date().toISOString() }).eq("id", sub.id);

      await logActivity(sb, {
        workspaceId: (await sb.from("workspaces").select("id").eq("owner_id", user.id).limit(1).single()).data?.id ?? "",
        actorId: user.id,
        kind: "billing",
        text: "Subscription cancellation requested (effective cycle end)",
      });

      return json({ ok: true });
    }

    throw new HttpError(400, "Unknown billing action.");
  } catch (e) {
    return handleError(e);
  }
});

function mapStatus(remote: string, fallback: string) {
  if (["active", "trialing", "paused", "cancelled"].includes(remote)) return remote as string;
  if (remote === "expired" || remote === "halted") return "failed";
  if (remote === "pending") return "past_due";
  return fallback;
}
