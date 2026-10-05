// ============================================================================
// Paddle Billing REST client for the Vercel (Node) functions.
//
// Extracted so /api/billing, /api/paddle-webhook and /api/admin talk to the
// provider through ONE implementation: same base-URL selection (sandbox vs
// production can never be mixed up), same timeouts, same "never leak the
// provider body into a customer-facing message" policy.
//
// The PADDLE_API_KEY is used only for the Bearer auth header. It is never
// logged, never returned, and never reaches the browser. Client-side tokens
// (test_/live_) are a different credential and belong to the frontend only.
//
// NOTE: imported with the emitted ".js" extension (see
// api/_tests/module-resolution.test.ts) because Vercel compiles api/**/*.ts to
// .js without rewriting import specifiers.
// ============================================================================
import { missingEnvMessage, readServerEnv } from "./supabase-server.js";
import {
  isPaidPlan,
  priceMapFromEnv,
  type PaidPlanId,
  type PricePlanMap,
} from "./paddle-core.js";

export type PaddleJson = Record<string, unknown>;

export const PADDLE_PRODUCTION_BASE = "https://api.paddle.com";
export const PADDLE_SANDBOX_BASE = "https://sandbox-api.paddle.com";

export type PaddleEnvironment = "sandbox" | "production";

export class PaddleError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "PaddleError";
    this.status = status;
    this.code = code;
  }
}

/** Resolve the server-side Paddle environment. Default: production. */
export function paddleEnvironment(): PaddleEnvironment {
  const value = readServerEnv("PADDLE_ENVIRONMENT").toLowerCase();
  if (value === "sandbox" || value === "test") return "sandbox";
  return "production";
}

export function paddleApiBase(environment: PaddleEnvironment = paddleEnvironment()): string {
  return environment === "sandbox" ? PADDLE_SANDBOX_BASE : PADDLE_PRODUCTION_BASE;
}

export function requirePaddleCredentials(label: string): { apiKey: string; environment: PaddleEnvironment } {
  const apiKey = readServerEnv("PADDLE_API_KEY");
  if (!apiKey) {
    throw new PaddleError(
      500,
      `Paddle isn't configured on the ${label} server. ${missingEnvMessage(["PADDLE_API_KEY"])} Add the server-only API key, then redeploy.`,
      "billing_config",
    );
  }
  return { apiKey, environment: paddleEnvironment() };
}

/** True when the server-side Paddle API key is present (no value revealed). */
export function hasPaddleCredentials(): boolean {
  return Boolean(readServerEnv("PADDLE_API_KEY"));
}

/** True when the Paddle webhook secret is present (no value revealed). */
export function hasPaddleWebhookSecret(): boolean {
  return Boolean(readServerEnv("PADDLE_WEBHOOK_SECRET"));
}

/** The server-side plan → Paddle price id map (authoritative mapping). */
export function paddlePriceMap(): PricePlanMap {
  return priceMapFromEnv(process.env as Record<string, string | undefined>);
}

/** The configured Paddle price id for a paid plan, with a friendly error. */
export function requirePriceIdForPlan(plan: PaidPlanId): string {
  const map = paddlePriceMap();
  const priceId = map[plan] ?? null;
  if (!priceId) {
    const variable = `PADDLE_PRICE_${plan.toUpperCase()}_ID`;
    throw new PaddleError(
      500,
      `The ${plan} plan isn't wired up for payments yet. ${missingEnvMessage([variable])} The value is the Paddle price id (starts with pri_) for the monthly ${plan} price.`,
      "billing_config",
    );
  }
  return priceId;
}

/** Presence of each paid plan's Paddle price id (for the admin console). */
export function paddlePricePresence(): Record<string, boolean> {
  const map = paddlePriceMap();
  return {
    growth: isPaidPlan("growth") && Boolean(map.growth),
    agency: Boolean(map.agency),
    scale: Boolean(map.scale),
  };
}

/**
 * Call the Paddle Billing API. The environment is resolved from
 * PADDLE_ENVIRONMENT so sandbox credentials can never be sent to the
 * production API and vice versa. Throws PaddleError with a safe, generic
 * message on timeout / network failure / non-2xx; the provider's own body is
 * logged only as metadata, never surfaced.
 */
export async function paddleRequest(
  path: string,
  init: RequestInit = {},
  label = "billing",
): Promise<PaddleJson> {
  const { apiKey, environment } = requirePaddleCredentials(label);
  const base = paddleApiBase(environment);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
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
    throw new PaddleError(
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
    // Log only safe metadata. Paddle errors nest a `detail` array inside
    // `error`; include the machine-readable hint codes but never the request
    // body or the API key.
    const errorBody = body && typeof body === "object" ? (body as PaddleJson).error : null;
    const detail =
      errorBody && typeof errorBody === "object" && !Array.isArray(errorBody)
        ? (errorBody as PaddleJson).detail
        : null;
    const hints = Array.isArray(detail)
      ? detail
          .map((item) =>
            item && typeof item === "object"
              ? String((item as PaddleJson).hint ?? (item as PaddleJson).message ?? "").slice(0, 120)
              : "",
          )
          .filter(Boolean)
      : [];
    console.error("provider request", {
      provider: "paddle",
      status: response.status,
      hints: hints.slice(0, 3),
      responseKind: bodyText ? "json" : "empty",
    });

    if (response.status === 401 || response.status === 403) {
      throw new PaddleError(502, "Our payment provider rejected the server credentials.", "provider_auth");
    }
    if (response.status === 404) {
      throw new PaddleError(404, "Our payment provider no longer has that subscription.", "provider_not_found");
    }
    if (response.status === 409) {
      throw new PaddleError(502, "Our payment provider refused that change. Try again in a moment.", "provider_conflict");
    }
    if (response.status === 422 && hints.length) {
      throw new PaddleError(502, "Our payment provider rejected that billing change.", "provider_invalid");
    }
    throw new PaddleError(502, "Our payment provider couldn't complete that action.", "provider_error");
  }

  const data = body && typeof body === "object" ? (body as PaddleJson).data : null;
  return (data && typeof data === "object" ? data : {}) as PaddleJson;
}

/** GET a subscription entity. */
export function paddleGetSubscription(subscriptionId: string, label = "billing"): Promise<PaddleJson> {
  return paddleRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {}, label);
}

/** GET a transaction entity. */
export function paddleGetTransaction(transactionId: string, label = "billing"): Promise<PaddleJson> {
  return paddleRequest(`/transactions/${encodeURIComponent(transactionId)}`, {}, label);
}

/**
 * Update a subscription's base-plan price (one-time upgrade).
 *
 * `prorated_immediately` bills the prorated difference right away so the
 * higher plan is effective immediately; `on_payment_failure: prevent_change`
 * (Paddle's recommended failure-safe default, stated explicitly) means that
 * if the immediate payment cannot be collected the whole change is refused —
 * the user never lands on a higher plan (or loses their current one) because
 * a charge failed. `scheduled_change: null` clears a pending
 * cancel-at-period-end so an explicit upgrade also un-cancels.
 */
export function paddleUpdateSubscriptionPrice(
  subscriptionId: string,
  priceId: string,
  label = "billing",
): Promise<PaddleJson> {
  return paddleRequest(
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        proration_billing_mode: "prorated_immediately",
        on_payment_failure: "prevent_change",
        scheduled_change: null,
      }),
    },
    label,
  );
}

/**
 * Cancel a subscription at the end of the current billing period. Access is
 * retained until `current_period_end`; the final `subscription.canceled`
 * webhook lands when the period actually ends.
 */
export function paddleCancelSubscription(subscriptionId: string, label = "billing"): Promise<PaddleJson> {
  return paddleRequest(
    `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ effective_from: "next_billing_period" }),
    },
    label,
  );
}
