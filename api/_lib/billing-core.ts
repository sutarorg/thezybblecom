// ============================================================================
// Shared, dependency-free billing helpers for the Node (Vercel) billing route.
//
// Everything here is pure so it can be unit-tested without Razorpay, Supabase
// or a running server. No secret ever leaves this process: the key secret is
// only used to COMPUTE a signature, never returned.
//
// NOTE: imported with the emitted ".js" extension (see
// api/_tests/module-resolution.test.ts) because Vercel compiles api/**/*.ts to
// .js without rewriting import specifiers.
// ============================================================================
import { createHmac, timingSafeEqual } from "node:crypto";

/** Zybble bills in INR only. Razorpay amounts are always in paise. */
export const BILLING_CURRENCY = "INR";

export type PaidPlanId = "growth" | "agency" | "scale";

export const PAID_PLANS: PaidPlanId[] = ["growth", "agency", "scale"];

export const PLAN_LABELS: Record<PaidPlanId, string> = {
  growth: "Growth",
  agency: "Agency",
  scale: "Scale",
};

/** Payment methods Razorpay Checkout may offer, in Checkout's own naming. */
const KNOWN_METHODS = [
  "card",
  "wallet",
  "upi",
  "netbanking",
  "emi",
  "cardless_emi",
  "paylater",
  "bank_transfer",
] as const;

/**
 * Build the Checkout `method` restriction from configuration.
 *
 *  • unset            → "card,wallet" (cards + eligible digital wallets such
 *                        as Apple Pay, which Razorpay surfaces as a wallet /
 *                        card-sheet option on supported devices)
 *  • "all"            → {} — show whatever the Razorpay account has enabled
 *  • "card,upi,…"     → only those are enabled, everything else is disabled
 *
 * Razorpay still decides what is actually eligible for the merchant account
 * and for a recurring mandate; this only ever narrows the list, it can never
 * enable a method the account does not support.
 */
export function checkoutMethodConfig(raw: string | undefined | null): Record<string, boolean> {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "all" || value === "*") return {};
  const requested = (value || "card,wallet")
    .split(/[,\s]+/)
    .map((m) => m.trim())
    .filter(Boolean);
  const allowed = requested.filter((m) => (KNOWN_METHODS as readonly string[]).includes(m));
  if (allowed.length === 0) return {};
  const config: Record<string, boolean> = {};
  for (const method of KNOWN_METHODS) config[method] = allowed.includes(method);
  return config;
}

/**
 * Razorpay subscription status → Zybble subscription status.
 * Only `active`/`trialing` entitle a paid plan (see effective_plan_for_user()).
 */
export function mapSubscriptionStatus(remote: unknown, fallback: string): string {
  switch (String(remote ?? "")) {
    case "created":
      return "created";
    case "authenticated":
      return "authenticated";
    case "active":
      return "active";
    case "pending":
      return "past_due";
    case "halted":
      return "halted";
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    case "expired":
      return "expired";
    default:
      return fallback;
  }
}

/** True when a Razorpay subscription status means "paid access is live". */
export function statusEntitles(status: string): boolean {
  return status === "active" || status === "trialing";
}

export function epochToIso(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

/**
 * Razorpay subscription signature: HMAC-SHA256 of
 *   `${razorpay_payment_id}|${razorpay_subscription_id}`
 * keyed with the Razorpay key SECRET. (Order-based checkout uses
 * `order_id|payment_id`; subscriptions are the other way round.)
 */
export function subscriptionSignature(paymentId: string, subscriptionId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");
}

/** Constant-time comparison that never throws on malformed input. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifySubscriptionSignature(input: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
  secret: string;
}): boolean {
  return safeEqual(
    subscriptionSignature(input.paymentId, input.subscriptionId, input.secret),
    input.signature,
  );
}

/** Razorpay webhook signature: HMAC-SHA256 of the raw body, webhook secret. */
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  return safeEqual(createHmac("sha256", secret).update(rawBody).digest("hex"), signature);
}

/** Stable invoice number derived from the payment, so retries can't duplicate. */
export function invoiceNumber(paymentId: string, issuedAt: Date = new Date()): string {
  const suffix = paymentId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase() || "00000000";
  return `ZB-${issuedAt.getUTCFullYear()}-${suffix}`;
}
