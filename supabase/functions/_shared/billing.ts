// ============================================================================
// Shared Paddle Billing helpers for the Supabase Edge Functions.
//
// Mirrors api/_lib/paddle-core.ts (the Vercel/Node implementation) so both
// deployment targets apply EXACTLY the same rules: signature verification
// over the RAW body with a replay window, the same status mapping, the same
// price-id → plan mapping, and the same upgrade ladder. Secrets are read
// from Deno.env by the callers and never returned to a caller.
//
// Paddle docs (source of truth):
//   • Paddle-Signature: `ts=<unix>;h1=<hex>` (extra h1= during secret
//     rotation), signed material is `${ts}:${rawBody}`, HMAC-SHA256 with the
//     notification-destination secret, compared in constant time.
//   • Subscription statuses: active | trialing | past_due | paused | canceled.
//   • Price ids look like pri_…, products pro_…, transactions txn_….
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./index.ts";

export const PAID_PLANS = ["growth", "agency", "scale"] as const;
export type PaidPlanId = (typeof PAID_PLANS)[number];

export const PLAN_LABELS: Record<PaidPlanId, string> = {
  growth: "Growth",
  agency: "Agency",
  scale: "Scale",
};

/** The single immediate upgrade target, or null on the highest plan. */
export function nextPlan(plan: string): PaidPlanId | null {
  const ladder = ["free", ...PAID_PLANS] as const;
  const index = ladder.indexOf(plan as (typeof ladder)[number]);
  if (index === -1 || index >= ladder.length - 1) return null;
  return ladder[index + 1] as PaidPlanId;
}

export function planLabel(plan: string): string {
  if (plan === "free") return "Free";
  return (PLAN_LABELS as Record<string, string>)[plan] ?? "Plan";
}

/* ------------------------------------------------------------------ */
/* Provider configuration                                             */
/* ------------------------------------------------------------------ */

export function paddleEnvironment(): "sandbox" | "production" {
  const value = (Deno.env.get("PADDLE_ENVIRONMENT") ?? "").trim().toLowerCase();
  return value === "sandbox" || value === "test" ? "sandbox" : "production";
}

export function paddleApiBase(): string {
  return paddleEnvironment() === "sandbox"
    ? "https://sandbox-api.paddle.com"
    : "https://api.paddle.com";
}

export function requirePaddleCredentials(functionName: string): { apiKey: string; environment: "sandbox" | "production" } {
  const apiKey = Deno.env.get("PADDLE_API_KEY")?.trim() ?? "";
  if (!apiKey) {
    throw new HttpError(
      500,
      `Paddle isn't configured on the ${functionName} server. Set the PADDLE_API_KEY secret (see README → Deploy the Edge Functions), then redeploy.`,
      "billing_config",
    );
  }
  return { apiKey, environment: paddleEnvironment() };
}

export function hasPaddleCredentials(): boolean {
  return Boolean(Deno.env.get("PADDLE_API_KEY")?.trim());
}

export function hasPaddleWebhookSecret(): boolean {
  return Boolean(Deno.env.get("PADDLE_WEBHOOK_SECRET")?.trim());
}

export function paddlePriceMap(): Partial<Record<PaidPlanId, string>> {
  const map: Partial<Record<PaidPlanId, string>> = {};
  for (const plan of PAID_PLANS) {
    const value = Deno.env.get(`PADDLE_PRICE_${plan.toUpperCase()}_ID`)?.trim() ?? "";
    if (value) map[plan] = value;
  }
  return map;
}

export function planForPriceId(priceId: unknown, map: Partial<Record<PaidPlanId, string>>): PaidPlanId | null {
  if (typeof priceId !== "string" || !priceId) return null;
  for (const plan of PAID_PLANS) {
    if (map[plan] === priceId) return plan;
  }
  return null;
}

export function requirePriceIdForPlan(plan: PaidPlanId, functionName: string): string {
  const priceId = paddlePriceMap()[plan] ?? null;
  if (!priceId) {
    const variable = `PADDLE_PRICE_${plan.toUpperCase()}_ID`;
    throw new HttpError(
      500,
      `The ${plan} plan isn't wired up for payments yet. Set the ${variable} secret to the Paddle price id (starts with pri_) for the monthly ${plan} price.`,
      "billing_config",
    );
  }
  return priceId;
}

/* ------------------------------------------------------------------ */
/* Status + payload normalization (mirrors api/_lib/paddle-core.ts)    */
/* ------------------------------------------------------------------ */

/**
 * Paddle → Zybble status. Paddle spells it "canceled"; the database and
 * effective_plan_for_user() expect "cancelled".
 */
export function mapPaddleSubscriptionStatus(remote: unknown, fallback = "active"): string {
  switch (String(remote ?? "")) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
      return "cancelled";
    default:
      return fallback;
  }
}

export function statusEntitles(status: string): boolean {
  return status === "active" || status === "trialing";
}

/** Mirror of the SQL effective_plan_for_user() for the billing function. */
export function effectivePlanOf(row: { plan_id: string | null; status: string | null; current_period_end: string | null } | null | undefined): string {
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

function paddleString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function paddleObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type NormalizedPaddleSubscription = {
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  providerPriceId: string | null;
  paddleStatus: string;
  status: string;
  currency: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBilledAt: string | null;
  canceledAt: string | null;
  scheduledAction: "cancel" | "pause" | "resume" | null;
  scheduledEffectiveAt: string | null;
  checkoutToken: string | null;
};

export function normalizePaddleSubscription(sub: unknown): NormalizedPaddleSubscription | null {
  const raw = paddleObject(sub);
  const id = paddleString(raw.id);
  if (!id) return null;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const basePriceId =
    paddleString(paddleObject(items[0]).price_id) ??
    paddleString(paddleObject(paddleObject(items[0]).price).id);
  const period = paddleObject(raw.current_billing_period);
  const scheduled = paddleObject(raw.scheduled_change);
  const action = paddleString(scheduled.action);
  const customData = paddleObject(raw.custom_data);
  return {
    providerSubscriptionId: id,
    providerCustomerId: paddleString(raw.customer_id),
    providerPriceId: basePriceId,
    paddleStatus: paddleString(raw.status) ?? "",
    status: mapPaddleSubscriptionStatus(paddleString(raw.status), "active"),
    currency: paddleString(raw.currency_code),
    currentPeriodStart: paddleString(period.starts_at),
    currentPeriodEnd: paddleString(period.ends_at),
    nextBilledAt: paddleString(raw.next_billed_at),
    canceledAt: paddleString(raw.canceled_at),
    scheduledAction: action === "cancel" || action === "pause" || action === "resume" ? action : null,
    scheduledEffectiveAt: paddleString(scheduled.effective_at),
    checkoutToken: paddleString(paddleObject(customData).zybble_token),
  };
}

export type NormalizedPaddleTransaction = {
  providerTransactionId: string;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  status: string;
  currency: string | null;
  amountMinor: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  paymentMethod: string | null;
  checkoutToken: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  occurredAt: string | null;
};

export function normalizePaddleTransaction(txn: unknown): NormalizedPaddleTransaction | null {
  const raw = paddleObject(txn);
  const id = paddleString(raw.id);
  if (!id) return null;
  const totals = paddleObject(raw.totals);
  const amount = Number(totals.total ?? raw.total ?? 0);
  const payments = Array.isArray(raw.payments) ? raw.payments : [];
  const methodDetails = paddleObject(paddleObject(payments[0]).method_details);
  const period = paddleObject(raw.billing_period);
  return {
    providerTransactionId: id,
    providerSubscriptionId: paddleString(raw.subscription_id),
    providerCustomerId: paddleString(raw.customer_id),
    status: paddleString(raw.status) ?? "",
    currency: paddleString(raw.currency_code),
    amountMinor: Number.isFinite(amount) ? Math.round(amount) : 0,
    invoiceId: paddleString(raw.invoice_id),
    invoiceNumber: paddleString(raw.invoice_number),
    paymentMethod: paddleString(methodDetails.type),
    checkoutToken: paddleString(paddleObject(raw.custom_data).zybble_token),
    billingPeriodStart: paddleString(period.starts_at),
    billingPeriodEnd: paddleString(period.ends_at),
    occurredAt: paddleString(raw.created_at) ?? paddleString(raw.billed_at),
  };
}

export function invoiceNumber(providerTransactionId: string, issuedAt: Date = new Date()): string {
  const suffix = providerTransactionId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase() || "00000000";
  return `ZB-${issuedAt.getUTCFullYear()}-${suffix}`;
}

/* ------------------------------------------------------------------ */
/* Signature verification (RAW body required)                         */
/* ------------------------------------------------------------------ */

export function parsePaddleSignature(header: string | null): { timestamp: number; signatures: string[] } | null {
  if (typeof header !== "string" || !header.trim()) return null;
  let timestamp = Number.NaN;
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) timestamp = Math.floor(parsed);
    } else if (key === "h1" && /^[a-f0-9]{64}$/i.test(value)) {
      signatures.push(value.toLowerCase());
    }
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison (no early exit on first difference). */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(String(a ?? ""));
  const right = new TextEncoder().encode(String(b ?? ""));
  if (left.length === 0 || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function verifyPaddleWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const parsed = parsePaddleSignature(input.signatureHeader);
  if (!parsed) return false;
  /* Replay window: the signed timestamp bounds how old a delivery may be. */
  const tolerance = input.toleranceSeconds ?? 300;
  const age = Math.floor(Date.now() / 1000) - parsed.timestamp;
  if (age < -tolerance || age > tolerance) return false;
  const digest = await hmacHex(input.secret, `${parsed.timestamp}:${input.rawBody}`);
  /* Accept when ANY h1 matches (Paddle sends extra signatures while you
     rotate the webhook secret). */
  for (const signature of parsed.signatures) {
    if (safeEqual(digest, signature)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Paddle API client                                                  */
/* ------------------------------------------------------------------ */

export async function paddleRequest(
  path: string,
  init: RequestInit = {},
  functionName = "billing",
): Promise<Record<string, unknown>> {
  const { apiKey } = requirePaddleCredentials(functionName);
  let response: Response;
  try {
    response = await fetch(`${paddleApiBase()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new HttpError(
      timedOut ? 504 : 502,
      timedOut
        ? "Our payment provider took too long to respond."
        : "Our payment provider couldn't be reached. Please try again shortly.",
      timedOut ? "provider_timeout" : "provider_unreachable",
    );
  }

  const bodyText = await response.text().catch(() => "");
  let body: unknown = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = paddleObject(body).detail;
    const hints = Array.isArray(detail)
      ? detail
        .map((item) => {
          const obj = paddleObject(item);
          return String(obj.hint ?? obj.message ?? "").slice(0, 120);
        })
        .filter(Boolean)
      : [];
    console.error("paddle request failed", {
      status: response.status,
      hints: hints.slice(0, 3),
      responseKind: bodyText ? "json" : "empty",
    });
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, "Our payment provider rejected the server credentials.", "provider_auth");
    }
    if (response.status === 404) {
      throw new HttpError(404, "Our payment provider no longer has that subscription.", "provider_not_found");
    }
    if (response.status === 409) {
      throw new HttpError(502, "Our payment provider refused that change. Try again in a moment.", "provider_conflict");
    }
    if (response.status === 422 && hints.length) {
      throw new HttpError(502, "Our payment provider rejected that billing change.", "provider_invalid");
    }
    throw new HttpError(502, "Our payment provider couldn't complete that action.", "provider_error");
  }

  const data = paddleObject(paddleObject(body).data);
  return data;
}

/* ------------------------------------------------------------------ */
/* State application (mirrors api/_lib/paddle-apply.ts)               */
/* ------------------------------------------------------------------ */

/**
 * Resolve the Zybble user for a Paddle subscription: the server-generated
 * checkout-intent token first, then an existing provider-subscription row.
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
    userId = checkout?.user_id ?? null;
    intendedPlanId = checkout?.plan_id ?? null;
  }

  if (!userId && input.providerSubscriptionId) {
    const { data: sub } = await sb
      .from("subscriptions")
      .select("user_id")
      .eq("provider_subscription_id", input.providerSubscriptionId)
      .maybeSingle();
    userId = sub?.user_id ?? null;
  }

  return { userId, intendedPlanId };
}

/** Apply a normalized, VERIFIED Paddle subscription to the user's row. */
export async function applyPaddleSubscription(
  sb: SupabaseClient,
  input: {
    userId: string;
    sub: NormalizedPaddleSubscription;
    priceMap: Partial<Record<PaidPlanId, string>>;
    eventAt?: string | null;
    skipDuplicateGuard?: boolean;
  },
): Promise<{ applied: boolean; planId: string | null; status: string | null; reason?: string }> {
  const { userId, sub } = input;
  const eventAt = input.eventAt ?? new Date().toISOString();

  const paidPlan = planForPriceId(sub.providerPriceId, input.priceMap);

  const { data: existing } = await sb
    .from("subscriptions")
    .select("id, plan_id, status, provider_subscription_id, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (
    !input.skipDuplicateGuard &&
    existing?.provider_subscription_id &&
    existing.provider_subscription_id !== sub.providerSubscriptionId &&
    statusEntitles(String(existing.status ?? ""))
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
    current_period_end:
      sub.currentPeriodEnd ??
      (existing?.current_period_end && sub.status === "cancelled" ? existing.current_period_end : null),
    charge_at: sub.nextBilledAt,
    cancel_at: sub.scheduledAction === "cancel" ? sub.scheduledEffectiveAt : sub.canceledAt,
    cancel_at_cycle_end: sub.scheduledAction === "cancel",
    last_event_at: eventAt,
  };

  if (paidPlan) {
    patch.plan_id = paidPlan;
  } else if (existing?.plan_id) {
    patch.plan_id = existing.plan_id;
  } else {
    return { applied: false, planId: null, status: sub.status, reason: "unknown_price_id" };
  }

  const periodEnd = (patch.current_period_end as string | null) ?? null;
  if (
    sub.status === "cancelled" &&
    (!periodEnd || new Date(periodEnd).getTime() <= Date.now())
  ) {
    patch.status = "expired";
    patch.plan_id = "free";
    patch.cancel_at_cycle_end = false;
  }

  const { error } = await sb
    .from("subscriptions")
    .upsert(patch, { onConflict: "user_id" });
  if (error) {
    console.error("billing write failed", { code: "subscription_write_failed" });
    throw new HttpError(500, "Couldn't update your subscription. Please try again.", "subscription_write_failed");
  }

  /* Best-effort intent completion: never blocks the subscription write. */
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

  return { applied: true, planId: String(patch.plan_id), status: String(patch.status) };
}

/** Record a transaction as payment (+invoice when settled). Idempotent. */
export async function recordPaddleTransaction(
  sb: SupabaseClient,
  input: { userId: string; entity: unknown; settled: boolean; failureStatus?: "failed" | "canceled" },
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
    console.error("billing write failed", { code: "payment_write_failed", detail: String(error).slice(0, 120) });
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
    console.error("billing write failed", { code: "invoice_write_failed", detail: String(error).slice(0, 120) });
  }
}
