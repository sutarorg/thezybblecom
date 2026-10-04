import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  looksLikeServiceRoleKey,
  missingEnvMessage,
  readServerEnv,
  SupabaseServerConfigError,
  SUPABASE_URL_VAR,
} from "./_lib/supabase-server.js";
import {
  BILLING_CURRENCY,
  checkoutMethodConfig,
  epochToIso,
  invoiceNumber,
  mapSubscriptionStatus,
  PLAN_LABELS,
  statusEntitles,
  verifySubscriptionSignature,
  type PaidPlanId,
} from "./_lib/billing-core.js";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };
type Json = Record<string, unknown>;

export const maxDuration = 60;

const SERVICE_ROLE_VARS = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"] as const;
const SECRET_KEYS_VAR = "SUPABASE_SECRET_KEYS";
const PLAN_ENV: Record<"growth" | "agency" | "scale", string> = {
  growth: "RAZORPAY_PLAN_GROWTH_ID",
  agency: "RAZORPAY_PLAN_AGENCY_ID",
  scale: "RAZORPAY_PLAN_SCALE_ID",
};

type BillingAction = "checkout" | "verify" | "sync" | "cancel";

type SupabaseServiceConfig = {
  url: string;
  key: string;
  keyVariable: string;
};

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

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function readSecretKeysDefault(): string {
  const raw = readServerEnv(SECRET_KEYS_VAR);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.default === "string" ? parsed.default.trim() : "";
  } catch {
    throw new SupabaseServerConfigError(
      `The billing server has invalid Supabase secret configuration. ${SECRET_KEYS_VAR} must be the JSON value Supabase provides, with a string default key.`,
      "invalid_url",
    );
  }
}

function requireSupabaseServiceConfig(): SupabaseServiceConfig {
  const url = readServerEnv(SUPABASE_URL_VAR);
  let key = readServerEnv(...SERVICE_ROLE_VARS);
  let keyVariable = key
    ? SERVICE_ROLE_VARS.find((name) => readServerEnv(name) === key) ?? SERVICE_ROLE_VARS[0]
    : "";

  if (!key) {
    key = readSecretKeysDefault();
    keyVariable = key ? SECRET_KEYS_VAR : "";
  }

  const missing: string[] = [];
  if (!url) missing.push(SUPABASE_URL_VAR);
  if (!key) missing.push(`${SERVICE_ROLE_VARS[0]} (or ${SERVICE_ROLE_VARS[1]} or ${SECRET_KEYS_VAR})`);

  if (missing.length > 0) {
    const message =
      `The billing server isn't connected to Supabase with write access. ${missingEnvMessage(missing)} ` +
      `Add the Supabase service-role/secret key only to the server environment, then redeploy. ` +
      `Do not use VITE_SUPABASE_* or the publishable key for billing writes.`;
    console.error("server config", { runtime: "vercel-function", route: "/api/billing", code: "supabase_config", problem: "missing", missing });
    throw new SupabaseServerConfigError(message, "missing", missing);
  }

  if (!isHttpUrl(url)) {
    const message =
      `The billing server has invalid Supabase configuration. ` +
      `${SUPABASE_URL_VAR} isn't a valid URL — it should be your project URL with the https scheme.`;
    console.error("server config", { runtime: "vercel-function", route: "/api/billing", code: "supabase_config", problem: "invalid_url" });
    throw new SupabaseServerConfigError(message, "invalid_url");
  }

  if (!looksLikeServiceRoleKey(key)) {
    const message =
      `The billing server has invalid Supabase configuration. ` +
      `${keyVariable || SERVICE_ROLE_VARS[0]} must be the Supabase service-role/secret key, not the publishable/anon key. ` +
      `Billing writes are server-only and never use VITE_SUPABASE_* values.`;
    console.error("server config", { runtime: "vercel-function", route: "/api/billing", code: "supabase_config", problem: "not_service_role", keyVariable });
    throw new SupabaseServerConfigError(message, "secret_key");
  }

  return { url, key, keyVariable };
}

function serviceClient(): SupabaseClient {
  const config = requireSupabaseServiceConfig();
  try {
    return createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
      },
    });
  } catch {
    console.error("server config", { runtime: "vercel-function", route: "/api/billing", code: "supabase_config", problem: "client_creation", keyVariable: config.keyVariable });
    throw new SupabaseServerConfigError(
      "The billing server has invalid Supabase configuration. Check SUPABASE_URL and the service-role key for formatting errors.",
      "client_creation",
    );
  }
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
  if (action === "checkout" || action === "verify" || action === "sync" || action === "cancel") return action;
  throw new ApiError(400, "Unknown billing action.", "action_invalid");
}

function planOf(input: unknown): PaidPlanId {
  const plan = String(input ?? "").toLowerCase();
  if (plan === "growth" || plan === "agency" || plan === "scale") return plan;
  throw new ApiError(400, "That plan doesn't exist.", "plan_invalid");
}

function requirePlanId(plan: PaidPlanId) {
  const variable = PLAN_ENV[plan];
  const planId = readServerEnv(variable);
  if (!planId) throw new ApiError(500, `The ${plan} plan isn't available in payments yet.`, "billing_config");
  return planId;
}

function requireRazorpayConfig() {
  const keyId = readServerEnv("RAZORPAY_KEY_ID");
  const secret = readServerEnv("RAZORPAY_KEY_SECRET");
  if (!keyId || !secret) {
    const missing = [!keyId && "RAZORPAY_KEY_ID", !secret && "RAZORPAY_KEY_SECRET"].filter(Boolean) as string[];
    throw new ApiError(
      500,
      `Razorpay isn't configured on the billing server. ${missingEnvMessage(missing)} Add the missing server secret${missing.length > 1 ? "s" : ""}, then redeploy.`,
      "billing_config",
    );
  }
  return { keyId, secret };
}

export async function razorpay(path: string, init: RequestInit = {}) {
  const { keyId, secret } = requireRazorpayConfig();
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new ApiError(
      timedOut ? 504 : 502,
      timedOut ? "Our payment provider took too long to respond." : "Our payment provider couldn't be reached. Please try again shortly.",
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
    console.error("provider request", { provider: "razorpay", status: response.status, responseKind: bodyText ? "body" : "empty" });
    throw new ApiError(502, "Our payment provider couldn't complete that action.", "provider_error");
  }
  return body as Json;
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

const mapStatus = mapSubscriptionStatus;

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
 * Prepare an ON-SITE checkout.
 *
 * This creates (or reuses) the Razorpay subscription with the server-only key
 * secret and returns ONLY browser-safe data: the public key id, the
 * subscription id to hand to Razorpay Standard Checkout, and display copy.
 * It deliberately never returns `short_url`, `auth_link`, or any
 * api.razorpay.com/v1/l/... hosted page — the browser has nothing to redirect
 * to, so the payment always happens in the Checkout overlay on Zybble.
 *
 * It also never touches `subscriptions`: preparing a checkout must not grant
 * anything. The pending provider subscription is parked in
 * `subscription_checkouts` until a payment is verified or a signed webhook
 * arrives.
 */
async function checkout(sb: SupabaseClient, user: User, body: Json) {
  const planId = planOf(body.plan);
  const razorpayPlan = requirePlanId(planId);
  const { keyId } = requireRazorpayConfig();
  const plan = await planRow(sb, planId);

  const { data: existingSub, error: existingSubError } = await sb
    .from("subscriptions")
    .select("razorpay_customer_id, razorpay_subscription_id, plan_id, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingSubError) throw dbFailed("Couldn't read your current subscription. Please try again.", "subscription_read_failed");

  let customerId = typeof existingSub?.razorpay_customer_id === "string" ? existingSub.razorpay_customer_id : null;

  /* Retry-friendly: a checkout the user abandoned less than an hour ago is
     still in Razorpay's `created` state and can be reopened as-is. This
     prevents a pile of orphan subscriptions when someone closes the modal
     and clicks Upgrade again. */
  const { data: reusable } = await sb
    .from("subscription_checkouts")
    .select("razorpay_subscription_id, razorpay_customer_id, created_at")
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
      if (!customerId) throw new ApiError(502, "The payment provider didn't return a customer id. Please try again.", "provider_malformed");
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
    if (!subscriptionId) throw new ApiError(502, "The payment provider didn't return a subscription id. Please try again.", "provider_malformed");

    const { error: checkoutWriteError } = await sb.from("subscription_checkouts").upsert(
      {
        user_id: user.id,
        plan_id: planId,
        razorpay_subscription_id: subscriptionId,
        razorpay_customer_id: customerId,
        razorpay_plan_id: typeof subscription.plan_id === "string" ? subscription.plan_id : razorpayPlan,
        status: "created",
        amount_cents: plan.price_cents,
        currency: BILLING_CURRENCY,
      },
      { onConflict: "razorpay_subscription_id" },
    );
    if (checkoutWriteError) {
      throw dbFailed("Couldn't start checkout. Please try again.", "checkout_write_failed");
    }
  }

  return {
    keyId,
    subscriptionId,
    planId,
    planLabel: PLAN_LABELS[planId],
    amount: plan.price_cents,
    currency: BILLING_CURRENCY,
    name: "Zybble",
    description: `${PLAN_LABELS[planId]} plan · monthly`,
    prefill: { email: user.email ?? "" },
    method: checkoutMethodConfig(readServerEnv("RAZORPAY_CHECKOUT_METHODS")),
    notes: { user_id: user.id, plan: planId },
    themeColor: "#0e7a52",
  };
}

/**
 * Verify a completed on-site checkout and ONLY THEN grant the plan.
 *
 * Three independent checks must all pass before a single entitlement row is
 * written, so a forged browser callback cannot upgrade an account:
 *   1. the HMAC signature over `payment_id|subscription_id`, computed with
 *      the server-only key secret;
 *   2. the subscription must be one this very user started (looked up in
 *      `subscription_checkouts`);
 *   3. a fresh read of the subscription AND the payment from Razorpay must
 *      show a real, captured/authorized INR payment on an active mandate.
 */
async function verify(sb: SupabaseClient, user: User, body: Json) {
  const { secret } = requireRazorpayConfig();
  const paymentId = String(body.razorpay_payment_id ?? "").trim();
  const subscriptionId = String(body.razorpay_subscription_id ?? "").trim();
  const signature = String(body.razorpay_signature ?? "").trim();
  if (!paymentId || !subscriptionId || !signature) {
    throw new ApiError(400, "That payment confirmation was incomplete.", "verify_invalid");
  }

  if (!verifySubscriptionSignature({ paymentId, subscriptionId, signature, secret })) {
    console.error("billing verify", { code: "signature_mismatch" });
    throw new ApiError(400, "We couldn't verify that payment. Nothing was changed on your account.", "signature_invalid");
  }

  const { data: pending, error: pendingError } = await sb
    .from("subscription_checkouts")
    .select("*")
    .eq("razorpay_subscription_id", subscriptionId)
    .maybeSingle();
  if (pendingError) throw dbFailed("Couldn't confirm your checkout. Please refresh and try again.", "checkout_read_failed");
  if (!pending || pending.user_id !== user.id) {
    throw new ApiError(403, "That payment doesn't belong to your account.", "checkout_mismatch");
  }

  const remote = await razorpay(`/subscriptions/${subscriptionId}`);
  const providerStatus = String(remote.status ?? "");
  const status = mapStatus(providerStatus, "created");
  if (!["authenticated", "active", "completed"].includes(providerStatus)) {
    throw new ApiError(402, "That subscription isn't active yet. If you were charged, it will appear here shortly.", "subscription_not_active");
  }

  const payment = await razorpay(`/payments/${paymentId}`);
  const paymentStatus = String(payment.status ?? "");
  if (!["captured", "authorized", "refunded"].includes(paymentStatus)) {
    throw new ApiError(402, "That payment hasn't been captured. Nothing was changed on your account.", "payment_not_captured");
  }
  const currency = String(payment.currency ?? BILLING_CURRENCY).toUpperCase();
  if (currency !== BILLING_CURRENCY) {
    console.error("billing verify", { code: "currency_mismatch" });
    throw new ApiError(400, "That payment used an unsupported currency.", "currency_invalid");
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

  return { ok: true, planId, status, entitled: statusEntitles(status) };
}

type ApplyInput = {
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
};

/**
 * Single writer for "this verified Razorpay subscription is now the user's
 * plan". Idempotent: re-running with the same payment updates the same rows
 * and cannot duplicate payments or invoices (unique provider ids).
 */
async function applyActiveSubscription(sb: SupabaseClient, input: ApplyInput) {
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
    console.error("billing write", { code: "subscription_write_failed" });
    throw dbFailed("Your payment went through, but we couldn't update your plan. Contact support@zybble.com.", "subscription_write_failed");
  }

  const { data: saved } = await sb
    .from("subscriptions")
    .select("id")
    .eq("user_id", input.userId)
    .maybeSingle();

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

  /* Plan change: a user can only hold one live mandate, so the mandate that
     was replaced is cancelled at the provider. Best-effort — a failure here
     must never undo a verified upgrade. */
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
    await sb
      .from("activity_logs")
      .insert({
        workspace_id: workspace.id,
        actor_id: input.userId,
        kind: "billing",
        text: `${PLAN_LABELS[input.planId]} plan activated`,
      })
      .then(() => undefined);
  }
}

/**
 * Pull the authoritative state from Razorpay. The database stays the source
 * of truth for entitlement, but a webhook can be delayed or missed, so the
 * Billing page reconciles on load. Only provider state can move the plan.
 */
async function sync(sb: SupabaseClient, user: User) {
  const { data: sub, error: subError } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (subError) throw dbFailed("Couldn't read your current subscription. Please try again.", "subscription_read_failed");
  if (!sub?.razorpay_subscription_id) return { ok: true, status: sub?.status ?? "free" };

  const remote = await razorpay(`/subscriptions/${sub.razorpay_subscription_id}`);
  const providerStatus = String(remote.status ?? "");
  const status = mapStatus(providerStatus, sub.status);
  const currentEnd = epochToIso(remote.current_end);

  const patch: Record<string, unknown> = {
    status,
    current_period_start: epochToIso(remote.current_start),
    current_period_end: currentEnd,
    charge_at: epochToIso(remote.charge_at),
    cancel_at: epochToIso(remote.ended_at) ?? (remote.end_at ? epochToIso(remote.end_at) : null),
    last_event_at: new Date().toISOString(),
  };

  /* A subscription whose paid period has elapsed must fall back to Free.
     Entitlement is computed live from status + period end, and the stored
     plan is normalized here so reporting agrees with it. */
  if (
    ["cancelled", "completed", "expired"].includes(status) &&
    (!currentEnd || new Date(currentEnd).getTime() <= Date.now())
  ) {
    patch.plan_id = "free";
    patch.status = "expired";
    patch.cancel_at_cycle_end = false;
  }

  const { error: updateError } = await sb.from("subscriptions").update(patch).eq("id", sub.id);
  if (updateError) throw dbFailed("Couldn't update your billing status. Please try again.", "subscription_write_failed");

  return { ok: true, status: String(patch.status ?? status) };
}

/**
 * Cancel at the end of the paid cycle. The row stays entitled until
 * `current_period_end` (see effective_plan_for_user()), and Razorpay's
 * `subscription.cancelled` webhook finalizes it when the cycle actually ends.
 */
async function cancel(sb: SupabaseClient, user: User) {
  const { data: sub, error: subError } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (subError) throw dbFailed("Couldn't read your current subscription. Please try again.", "subscription_read_failed");
  if (!sub?.razorpay_subscription_id) throw new ApiError(404, "You don't have an active paid subscription.", "subscription_missing");

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
  if (updateError) throw dbFailed("Couldn't update your cancellation status. Please contact support@zybble.com.", "subscription_write_failed");

  const { data: workspace } = await sb
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (workspace?.id) {
    await sb.from("activity_logs").insert({
      workspace_id: workspace.id,
      actor_id: user.id,
      kind: "billing",
      text: "Subscription cancellation requested (effective cycle end)",
    }).then(() => undefined);
  }

  return { ok: true, cancelAtCycleEnd: true, accessUntil: sub.current_period_end ?? null };
}

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

    const result =
      action === "checkout"
        ? await checkout(sb, user, body)
        : action === "verify"
          ? await verify(sb, user, body)
          : action === "sync"
            ? await sync(sb, user)
            : await cancel(sb, user);

    return res.status(200).json(result);
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : error instanceof SupabaseServerConfigError
        ? new ApiError(error.status, error.message, error.code)
        : new ApiError(500, "Billing couldn't complete that action. Please try again.", "unknown");
    if (!(error instanceof ApiError)) {
      console.error("api request", { route: "/api/billing", status: apiError.status, code: apiError.code });
    }
    return res.status(apiError.status).json({ error: apiError.message, code: apiError.code });
  }
}
