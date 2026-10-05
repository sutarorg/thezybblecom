// ============================================================================
// paddle-webhook — Paddle Billing notification destination (Edge fallback
// for /api/paddle-webhook).
//
// Flow, in order:
//   1. Read the RAW body BEFORE parsing anything (`await req.text()`).
//   2. Verify `Paddle-Signature` (ts + h1, HMAC-SHA256 over `${ts}:${rawBody}`,
//      constant-time compare, replay window) against the server-only
//      PADDLE_WEBHOOK_SECRET. Invalid → 401, nothing else runs.
//   3. Idempotency: insert (provider='paddle', Paddle event_id) into
//      webhook_events; a duplicate delivery returns 200 WITHOUT re-applying.
//   4. Apply the subscription/transaction lifecycle.
//
// This function is deployed with verify_jwt = false (see supabase/config.toml)
// because Paddle calls it unauthenticated — the signature IS the
// authentication. No Authorization header is ever read here.
// ============================================================================
import { HttpError, handleError, serviceClient } from "../_shared/index.ts";
import {
  applyPaddleSubscription,
  normalizePaddleSubscription,
  normalizePaddleTransaction,
  paddleObject,
  paddlePriceMap,
  paddleRequest,
  planForPriceId,
  recordPaddleTransaction,
  resolveSubscriptionOwner,
  statusEntitles,
  verifyPaddleWebhookSignature,
} from "../_shared/billing.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.canceled",
]);

const TRANSACTION_EVENTS = new Set([
  "transaction.paid",
  "transaction.completed",
  "transaction.payment_failed",
  "transaction.canceled",
]);

/* ------------------------------------------------------------------ */
/* Subscription lifecycle                                             */
/* ------------------------------------------------------------------ */

async function handleSubscriptionEvent(sb: Sb, data: unknown, occurredAt: string, priceMap: Parameters<typeof planForPriceId>[1]) {
  const sub = normalizePaddleSubscription(data);
  if (!sub) return { ignored: "malformed_subscription" };

  const { userId, intendedPlanId } = await resolveSubscriptionOwner(sb, {
    providerSubscriptionId: sub.providerSubscriptionId,
    checkoutToken: sub.checkoutToken,
  });
  if (!userId) return { ignored: "no_matching_user" };

  if (intendedPlanId && planForPriceId(sub.providerPriceId, priceMap) !== intendedPlanId) {
    console.warn("paddle webhook", {
      code: "intent_mismatch",
      intendedPlanId,
      paidPlanId: planForPriceId(sub.providerPriceId, priceMap),
    });
  }

  const result = await applyPaddleSubscription(sb, { userId, sub, priceMap, eventAt: occurredAt });

  if (result.reason === "duplicate_subscription_blocked") {
    // Two live Paddle subscriptions for one user: the first keeps the
    // entitlement; the newcomer is canceled at Paddle immediately
    // (best-effort) so the customer is not double-billed.
    await paddleRequest(
      `/subscriptions/${encodeURIComponent(sub.providerSubscriptionId)}/cancel`,
      { method: "POST", body: JSON.stringify({ effective_from: "immediately" }) },
      "paddle-webhook",
    ).catch(() => undefined);
    console.warn("paddle webhook", { code: "duplicate_subscription_blocked", userIdPresent: true });
    return { ignored: "duplicate_subscription_blocked" };
  }

  return { applied: result.applied, planId: result.planId, status: result.status };
}

/* ------------------------------------------------------------------ */
/* Transaction lifecycle                                              */
/* ------------------------------------------------------------------ */

async function handleTransactionEvent(sb: Sb, data: unknown, eventType: string, priceMap: Parameters<typeof planForPriceId>[1]) {
  const txn = normalizePaddleTransaction(data);
  if (!txn) return { ignored: "malformed_transaction" };

  const { userId } = await resolveSubscriptionOwner(sb, {
    providerSubscriptionId: txn.providerSubscriptionId,
    checkoutToken: txn.checkoutToken,
  });
  if (!userId) return { ignored: "no_matching_user" };

  if (eventType === "transaction.paid" || eventType === "transaction.completed") {
    await recordPaddleTransaction(sb, { userId, entity: data, settled: true });

    // Paddle doesn't guarantee event order: a completed transaction may
    // arrive before subscription.created. Pull the subscription entity from
    // the API and apply it if our row hasn't seen it yet.
    if (txn.providerSubscriptionId) {
      const { data: row } = await sb
        .from("subscriptions")
        .select("provider_subscription_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (row?.provider_subscription_id !== txn.providerSubscriptionId) {
        const remote = await paddleRequest(
          `/subscriptions/${encodeURIComponent(txn.providerSubscriptionId)}`,
          {},
          "paddle-webhook",
        ).catch(() => null);
        const remoteSub = remote ? normalizePaddleSubscription(remote) : null;
        if (remoteSub) {
          await applyPaddleSubscription(sb, { userId, sub: remoteSub, priceMap, eventAt: txn.occurredAt });
        }
      }
    }
    return { applied: true };
  }

  if (eventType === "transaction.payment_failed") {
    await recordPaddleTransaction(sb, { userId, entity: data, settled: false, failureStatus: "failed" });
    if (txn.providerSubscriptionId) {
      const { data: row } = await sb
        .from("subscriptions")
        .select("id, status")
        .eq("user_id", userId)
        .maybeSingle();
      if (row && statusEntitles(String(row.status ?? ""))) {
        await sb
          .from("subscriptions")
          .update({ status: "past_due", last_event_at: txn.occurredAt ?? new Date().toISOString() })
          .eq("id", row.id);
      }
    }
    return { applied: true };
  }

  // transaction.canceled — abandoned/expired checkout transaction. No
  // entitlement was granted; mark the matching intent canceled.
  if (txn.checkoutToken) {
    try {
      await sb
        .from("subscription_checkouts")
        .update({ status: "canceled", completed_at: new Date().toISOString() })
        .eq("checkout_token", txn.checkoutToken);
    } catch {
      /* best-effort */
    }
  }
  return { acknowledged: true };
}

/* ------------------------------------------------------------------ */
/* Handler                                                            */
/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed", code: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
    });
  }

  const startedAt = Date.now();
  let eventId = "";
  try {
    /* 1) RAW body first — before any JSON parsing. */
    const rawBody = await req.text();

    /* 2) Signature verification is the security boundary. */
    const secret = Deno.env.get("PADDLE_WEBHOOK_SECRET")?.trim() ?? "";
    if (!secret) {
      console.error("paddle webhook", { code: "webhook_secret_missing" });
      throw new HttpError(500, "Webhook secret isn't configured on this server.", "webhook_config");
    }
    if (!(await verifyPaddleWebhookSignature({ rawBody, signatureHeader: req.headers.get("Paddle-Signature"), secret }))) {
      console.warn("paddle webhook", { code: "signature_invalid", hasHeader: Boolean(req.headers.get("Paddle-Signature")) });
      throw new HttpError(401, "Invalid signature.", "signature_invalid");
    }

    /* 3) Parse — only after the signature over the raw bytes verified. */
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      event = parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "The webhook payload wasn't valid JSON.", "invalid_json");
    }

    eventId = String(event.event_id ?? "").trim();
    const eventType = String(event.event_type ?? "").trim();
    const occurredAt = typeof event.occurred_at === "string" ? event.occurred_at : new Date().toISOString();
    if (!eventId || !eventType) {
      throw new HttpError(400, "The webhook payload is missing its event id or type.", "event_invalid");
    }

    const sb = serviceClient();

    /* 4) Idempotency: Paddle event_id is the dedupe key. */
    const { error: insertError } = await sb.from("webhook_events").insert({
      provider: "paddle",
      event_id: eventId,
      event_type: eventType,
      payload: event,
      attempts: 1,
    });
    if (insertError) {
      if (/duplicate key|unique constraint/i.test(String((insertError as { message?: string }).message ?? ""))) {
        return new Response(JSON.stringify({ ok: true, deduplicated: true }), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }
      console.error("paddle webhook", { code: "event_write_failed" });
      throw new HttpError(500, "Couldn't record the webhook event.", "event_write_failed");
    }

    const data = paddleObject(event.data);
    const priceMap = paddlePriceMap();

    if (SUBSCRIPTION_EVENTS.has(eventType)) {
      await handleSubscriptionEvent(sb, data, occurredAt, priceMap);
    } else if (TRANSACTION_EVENTS.has(eventType)) {
      await handleTransactionEvent(sb, data, eventType, priceMap);
    }
    /* Other events (customer.*, adjustment.*, …) are recorded above but
       intentionally not applied — no entitlement consequence. */

    await sb
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("provider", "paddle")
      .eq("event_id", eventId);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    /* Signature failures and payload problems return their status; state
       application problems return 200 so Paddle doesn't hot-loop — the
       webhook_events row records the failure and action=sync re-reads the
       provider. */
    if (e instanceof HttpError && (e.code === "signature_invalid" || e.code === "invalid_json" || e.code === "event_invalid" || e.code === "webhook_config" || e.code === "supabase_config" || e.code === "event_write_failed")) {
      return handleError(e, { functionName: "paddle-webhook", startedAt });
    }
    console.error("paddle webhook handler error", { code: "handler_failed", detail: String(e).slice(0, 200) });
    if (eventId) {
      try {
        const sb = serviceClient();
        await sb
          .from("webhook_events")
          .update({ status: "failed", error: String(e).slice(0, 400) })
          .eq("provider", "paddle")
          .eq("event_id", eventId);
      } catch {
        /* best-effort bookkeeping */
      }
    }
    return new Response(JSON.stringify({ ok: true, received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
});
