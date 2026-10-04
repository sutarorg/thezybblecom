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

type BillingAction = "checkout" | "sync" | "cancel";

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
  if (action === "checkout" || action === "sync" || action === "cancel") return action;
  throw new ApiError(400, "Unknown billing action.", "action_invalid");
}

function planOf(input: unknown): "growth" | "agency" | "scale" {
  const plan = String(input ?? "").toLowerCase();
  if (plan === "growth" || plan === "agency" || plan === "scale") return plan;
  throw new ApiError(400, "That plan doesn't exist.", "plan_invalid");
}

function requirePlanId(plan: "growth" | "agency" | "scale") {
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

function mapStatus(remote: unknown, fallback: string) {
  const status = String(remote ?? "");
  if (["active", "trialing", "paused", "cancelled"].includes(status)) return status;
  if (status === "expired" || status === "halted") return "failed";
  if (status === "pending") return "past_due";
  return fallback;
}

async function checkout(sb: SupabaseClient, user: User, body: Json) {
  const planId = planOf(body.plan);
  const razorpayPlan = requirePlanId(planId);

  const { data: existingSub, error: existingSubError } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingSubError) throw dbFailed("Couldn't read your current subscription. Please try again.", "subscription_read_failed");

  let customerId = typeof existingSub?.razorpay_customer_id === "string" ? existingSub.razorpay_customer_id : null;
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
      notify_info: { notify_email: user.email ? [user.email] : [] },
    }),
  });

  const subscriptionId = typeof subscription.id === "string" ? subscription.id : "";
  if (!subscriptionId) throw new ApiError(502, "The payment provider didn't return a subscription id. Please try again.", "provider_malformed");

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
    { onConflict: "user_id" },
  );
  if (upsertError) throw dbFailed("Checkout started, but we couldn't save your billing details. Please contact support@zybble.com.", "subscription_write_failed");

  const appUrl = readServerEnv("APP_URL") || "https://zybble.com";
  const url = typeof subscription.short_url === "string"
    ? subscription.short_url
    : typeof subscription.auth_link === "string"
      ? subscription.auth_link
      : `${appUrl}/billing`;
  return { url, subscriptionId };
}

async function sync(sb: SupabaseClient, user: User) {
  const { data: sub, error: subError } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (subError) throw dbFailed("Couldn't read your current subscription. Please try again.", "subscription_read_failed");
  if (!sub?.razorpay_subscription_id) return { ok: true, status: sub?.status ?? "active" };

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
  if (updateError) throw dbFailed("Couldn't update your billing status. Please try again.", "subscription_write_failed");

  return { ok: true, status };
}

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
    .update({ status: "cancelled", cancel_at: new Date().toISOString() })
    .eq("id", sub.id);
  if (updateError) throw dbFailed("Couldn't update your cancellation status. Please contact support@zybble.com.", "subscription_write_failed");

  const { data: workspace } = await sb.from("workspaces").select("id").eq("owner_id", user.id).limit(1).single();
  if (workspace?.id) {
    await sb.from("activity_logs").insert({
      workspace_id: workspace.id,
      actor_id: user.id,
      kind: "billing",
      text: "Subscription cancellation requested (effective cycle end)",
    }).then(() => undefined);
  }

  return { ok: true };
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

    const result = action === "checkout"
      ? await checkout(sb, user, body)
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
