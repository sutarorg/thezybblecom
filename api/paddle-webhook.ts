// ============================================================================
// /api/paddle-webhook — Paddle Billing notification destination.
//
// Web-standard handler signature (Request → Response) on the Node runtime:
// `await request.text()` returns the EXACT bytes Paddle sent, which is a hard
// requirement for signature verification. The platform's automatic JSON body
// parsing (which would destroy the raw body) only applies to the legacy
// (req, res) signature, so this file deliberately uses the fetch-style export.
//
// Request flow, in order:
//   1. Read the RAW body BEFORE parsing anything.
//   2. Verify the `Paddle-Signature` header (ts + h1, HMAC-SHA256 over
//      `${ts}:${rawBody}`, constant-time compare, replay window) against the
//      server-only PADDLE_WEBHOOK_SECRET. Invalid → 401, nothing else runs.
//   3. Idempotency: insert (provider='paddle', Paddle event_id) into
//      webhook_events; a duplicate delivery returns 200 WITHOUT re-applying.
//   4. Handle the subscription/transaction lifecycle below.
//
// Never logged: the API key, the webhook secret, card numbers, or any
// Authorization header value.
// ============================================================================
import { createServiceClient } from "./_lib/supabase-service.js";
import { readServerEnv } from "./_lib/supabase-server.js";
import {
  hasPaddleCredentials,
  paddleCancelSubscription,
  paddleGetSubscription,
  paddlePriceMap,
} from "./_lib/paddle.js";
import {
  applyPaddleSubscription,
  logBillingActivity,
  paidPlanLabel,
  recordPaddleTransaction,
  resolveSubscriptionOwner,
} from "./_lib/paddle-apply.js";
import {
  normalizePaddleSubscription,
  normalizePaddleTransaction,
  paddleObject,
  planForPriceId,
  statusEntitles,
  verifyPaddleWebhookSignature,
} from "./_lib/paddle-core.js";

export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecord = Record<string, any>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

/** The Paddle events Zybble needs for its subscription lifecycle. */
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

async function handleSubscriptionEvent(sb: any, data: unknown, occurredAt: string, priceMap: any) {
  const sub = normalizePaddleSubscription(data);
  if (!sub) return { ignored: "malformed_subscription" };

  const { userId, intendedPlanId } = await resolveSubscriptionOwner(sb, {
    providerSubscriptionId: sub.providerSubscriptionId,
    checkoutToken: sub.checkoutToken,
  });
  if (!userId) return { ignored: "no_matching_user" };

  /* A plan the user PAID FOR but that doesn't match the checkout intent is
     recorded as an anomaly; entitlement still follows the paid price. */
  if (intendedPlanId && planForPriceId(sub.providerPriceId, priceMap) !== intendedPlanId) {
    console.warn("paddle webhook", {
      code: "intent_mismatch",
      intendedPlanId,
      paidPlanId: planForPriceId(sub.providerPriceId, priceMap),
    });
  }

  const result = await applyPaddleSubscription(sb, {
    userId,
    sub,
    priceMap,
    eventAt: occurredAt,
  });

  if (result.reason === "duplicate_subscription_blocked") {
    /* Two live Paddle subscriptions for one user (double checkout). The
       first one keeps the entitlement; the newcomer is canceled at Paddle
       immediately, best-effort, so the customer is not double-billed. */
    await paddleCancelSubscription(sub.providerSubscriptionId, "paddle-webhook").catch(() => undefined);
    console.warn("paddle webhook", { code: "duplicate_subscription_blocked", userIdPresent: true });
    return { ignored: "duplicate_subscription_blocked" };
  }

  if (result.applied && statusEntitles(result.status ?? "")) {
    const { data: row } = await sb
      .from("subscriptions")
      .select("plan_id, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (row?.plan_id && row.plan_id !== "free") {
      await logBillingActivity(sb, userId, `${paidPlanLabel(row.plan_id)} plan ${sub.status === "active" ? "active" : sub.status}`);
    }
  }

  return { applied: result.applied, planId: result.planId, status: result.status };
}

/* ------------------------------------------------------------------ */
/* Transaction lifecycle                                              */
/* ------------------------------------------------------------------ */

async function handleTransactionEvent(sb: any, data: unknown, eventType: string, priceMap: any) {
  const txn = normalizePaddleTransaction(data);
  if (!txn) return { ignored: "malformed_transaction" };

  /* Resolve the owning user: the checkout-intent token on the transaction,
     or the subscription row for renewals/upgrades. */
  const { userId } = await resolveSubscriptionOwner(sb, {
    providerSubscriptionId: txn.providerSubscriptionId,
    checkoutToken: txn.checkoutToken,
  });
  if (!userId) return { ignored: "no_matching_user" };

  if (eventType === "transaction.paid" || eventType === "transaction.completed") {
    /* Record the payment + invoice (idempotent on the transaction id). */
    await recordPaddleTransaction(sb, { userId, entity: data, settled: true });

    /* If this transaction introduced a subscription our database hasn't
       applied yet (event ordering isn't guaranteed), pull the subscription
       entity from the Paddle API and apply it — the API key is server-side
       and the state is authoritative. */
    if (txn.providerSubscriptionId) {
      const { data: row } = await sb
        .from("subscriptions")
        .select("provider_subscription_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (row?.provider_subscription_id !== txn.providerSubscriptionId) {
        const remote = await paddleGetSubscription(txn.providerSubscriptionId, "paddle-webhook").catch(() => null);
        const remoteSub = remote ? normalizePaddleSubscription(remote) : null;
        if (remoteSub) {
          await applyPaddleSubscription(sb, { userId, sub: remoteSub, priceMap, eventAt: txn.occurredAt });
        }
      }
    }
    return { applied: true };
  }

  if (eventType === "transaction.payment_failed") {
    /* A failed charge on a subscription puts that subscription into dunning:
       Paddle also sends subscription.past_due, but representing the failure
       here too keeps the local row honest even if that event is delayed. */
    await recordPaddleTransaction(sb, { userId, entity: data, settled: false, failureStatus: "failed" });
    if (txn.providerSubscriptionId) {
      const { data: row } = await sb
        .from("subscriptions")
        .select("id, plan_id, status")
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

  /* transaction.canceled — e.g. an abandoned/expired checkout transaction.
     No entitlement was granted for it; mark any matching checkout intent
     canceled so the next attempt starts fresh. */
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

export async function POST(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  /* 1) RAW body first — before any JSON parsing. */
  const rawBody = await request.text();

  /* 2) Signature verification: the security boundary. */
  const secret = readServerEnv("PADDLE_WEBHOOK_SECRET");
  if (!secret) {
    console.error("paddle webhook", { code: "webhook_secret_missing" });
    return json({ error: "Webhook secret isn't configured on this server.", code: "webhook_config" }, 500);
  }
  const signature = request.headers.get("paddle-signature");
  if (!verifyPaddleWebhookSignature({ rawBody, signatureHeader: signature, secret })) {
    console.warn("paddle webhook", { code: "signature_invalid", hasHeader: Boolean(signature) });
    return json({ error: "Invalid signature.", code: "signature_invalid" }, 401);
  }

  /* 3) Parse — only after the signature over the raw bytes verified. */
  let event: AnyRecord;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    event = parsed as AnyRecord;
  } catch {
    return json({ error: "The webhook payload wasn't valid JSON.", code: "invalid_json" }, 400);
  }

  const eventId = String(event.event_id ?? "").trim();
  const eventType = String(event.event_type ?? "").trim();
  const occurredAt = typeof event.occurred_at === "string" ? event.occurred_at : new Date().toISOString();
  if (!eventId || !eventType) {
    return json({ error: "The webhook payload is missing its event id or type.", code: "event_invalid" }, 400);
  }

  const sb = createServiceClient("paddle-webhook", "/api/paddle-webhook");

  /* 4) Idempotency: the Paddle event_id is the dedupe key. A duplicate
     delivery returns 200 without applying anything twice. */
  const { error: insertError } = await sb.from("webhook_events").insert({
    provider: "paddle",
    event_id: eventId,
    event_type: eventType,
    payload: event,
    attempts: 1,
  });
  if (insertError) {
    if (/duplicate key|unique constraint/i.test(String(insertError.message ?? ""))) {
      return json({ ok: true, deduplicated: true });
    }
    console.error("paddle webhook", { code: "event_write_failed" });
    return json({ error: "Couldn't record the webhook event.", code: "event_write_failed" }, 500);
  }

  try {
    const data = paddleObject(event.data);
    const priceMap = paddlePriceMap();

    if (SUBSCRIPTION_EVENTS.has(eventType)) {
      await handleSubscriptionEvent(sb, data, occurredAt, priceMap);
    } else if (TRANSACTION_EVENTS.has(eventType)) {
      await handleTransactionEvent(sb, data, eventType, priceMap);
    }
    /* Other events (customer.*, adjustment.*, etc.) are recorded above but
       intentionally not applied — they carry no entitlement consequence. */

    await sb
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("provider", "paddle")
      .eq("event_id", eventId);
    return json({ ok: true });
  } catch (error) {
    console.error("paddle webhook handler error", { code: "handler_failed", detail: String(error).slice(0, 200) });
    await sb
      .from("webhook_events")
      .update({ status: "failed", error: String(error).slice(0, 400) })
      .eq("provider", "paddle")
      .eq("event_id", eventId);
    /* 200 so Paddle doesn't hot-loop; the row records the failure and
       action=sync / admin reconciliation re-reads the provider. */
    return json({ ok: true, received: true });
  }
}

/** Health probe convenience: the platform may issue GET / OPTIONS. */
export async function GET(): Promise<Response> {
  return json({
    ok: true,
    route: "/api/paddle-webhook",
    provider: "paddle",
    apiKeyConfigured: hasPaddleCredentials(),
  });
}
