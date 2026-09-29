// ============================================================================
// razorpay-webhook — signature-verified, idempotent subscription sync.
// Deploy with verify_jwt = false (see config.toml / README).
// ============================================================================
import {
  errorJson,
  handleError,
  json,
  serviceClient,
  verifyRazorpaySignature,
} from "../_shared/index.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  try {
    const sb = serviceClient();
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");

    await verifyRazorpaySignature(rawBody, signature);

    const payload = JSON.parse(rawBody);
    const eventId = String(payload.event ?? "") + ":" + String(payload.payload?.payment?.entity?.id ?? payload.payload?.subscription?.entity?.id ?? payload.razorpay_trace_id ?? crypto.randomUUID());
    const eventType = String(payload.event ?? "unknown");

    /* idempotency — one event processed once */
    const { data: existing } = await sb
      .from("webhook_events")
      .select("id, status")
      .eq("provider", "razorpay")
      .eq("event_id", eventId)
      .maybeSingle();
    if (existing) {
      return json({ ok: true, deduplicated: true });
    }

    const { error: insertErr } = await sb.from("webhook_events").insert({
      provider: "razorpay",
      event_id: eventId,
      event_type: eventType,
      payload,
    });
    if (insertErr) {
      // concurrent duplicate delivery: treat as already received
      return json({ ok: true, deduplicated: true });
    }

    const subscription = payload.payload?.subscription?.entity;
    const payment = payload.payload?.payment?.entity;
    const notes = subscription?.notes ?? payment?.notes ?? {};
    const userId = notes?.user_id;

    if (userId) {
      try {
        switch (eventType) {
          case "subscription.activated":
          case "subscription.updated":
          case "subscription.resumed":
          case "subscription.completed": {
            const { data: sub } = await sb
              .from("subscriptions")
              .select("id, user_id, plan_id")
              .eq("razorpay_subscription_id", subscription.id)
              .maybeSingle();
            if (sub) {
              await sb.from("subscriptions").update({
                status: eventType === "subscription.completed" ? "cancelled" : "active",
                plan_id: notes.plan ?? sub.plan_id,
                current_period_start: subscription.current_start ? new Date(subscription.current_start * 1000).toISOString() : null,
                current_period_end: subscription.current_end ? new Date(subscription.current_end * 1000).toISOString() : null,
              }).eq("id", sub.id);
            }
            break;
          }
          case "subscription.cancelled": {
            await sb.from("subscriptions").update({ status: "cancelled", cancel_at: new Date().toISOString() }).eq("razorpay_subscription_id", subscription.id);
            break;
          }
          case "subscription.halted":
          case "subscription.paused": {
            await sb.from("subscriptions").update({ status: eventType.endsWith("halted") ? "failed" : "paused" }).eq("razorpay_subscription_id", subscription.id);
            break;
          }
          case "payment.captured": {
            const amount = payment.amount ?? 0;
            await sb.from("payments").upsert(
              {
                user_id: userId,
                razorpay_payment_id: payment.id,
                razorpay_subscription_id: payment.subscription_id ?? null,
                amount_cents: Math.round(amount / 100) * 100 === 0 ? amount : amount,
                currency: payment.currency ?? "USD",
                status: "captured",
                event_id: eventId,
              },
              { onConflict: "razorpay_payment_id" }
            );
            await sb.from("invoices").insert({
              user_id: userId,
              number: `inv-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
              description: `${(notes.plan ?? "Plan") as string} plan · ${new Date().toLocaleDateString("en-US", { month: "long" })}`,
              amount_cents: amount,
              currency: payment.currency ?? "USD",
              status: "paid",
              razorpay_invoice_id: payment.id,
            });
            break;
          }
          case "payment.failed": {
            await sb.from("payments").upsert(
              {
                user_id: userId,
                razorpay_payment_id: payment.id,
                razorpay_subscription_id: payment.subscription_id ?? null,
                amount_cents: payment.amount ?? 0,
                currency: payment.currency ?? "USD",
                status: "failed",
                event_id: eventId,
              },
              { onConflict: "razorpay_payment_id" }
            );
            break;
          }
          default:
            break;
        }
      } catch (e) {
        console.error("webhook handler error:", e);
        await sb.from("webhook_events").update({ status: "failed", error: String(e).slice(0, 400) }).eq("provider", "razorpay").eq("event_id", eventId);
        return json({ ok: true, received: true });
      }
    }

    await sb.from("webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("provider", "razorpay").eq("event_id", eventId);
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
});
