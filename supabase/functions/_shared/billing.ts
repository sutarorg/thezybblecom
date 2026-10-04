// ============================================================================
// Shared Razorpay billing helpers for the Supabase Edge Functions.
//
// Mirrors api/_lib/billing-core.ts (the Vercel/Node implementation) so both
// deployment targets apply EXACTLY the same rules: INR-only amounts in the
// smallest unit, the same status mapping, the same signature algorithms, and
// the same payment-method restriction. Secrets are read from Deno.env here
// and never returned to a caller.
// ============================================================================

export const BILLING_CURRENCY = "INR";

export type PaidPlanId = "growth" | "agency" | "scale";

export const PLAN_LABELS: Record<PaidPlanId, string> = {
  growth: "Growth",
  agency: "Agency",
  scale: "Scale",
};

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

/** See api/_lib/billing-core.ts — identical semantics. */
export function checkoutMethodConfig(raw: string | undefined | null): Record<string, boolean> {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "all" || value === "*") return {};
  const requested = (value || "card,wallet").split(/[,\s]+/).map((m) => m.trim()).filter(Boolean);
  const allowed = requested.filter((m) => (KNOWN_METHODS as readonly string[]).includes(m));
  if (allowed.length === 0) return {};
  const config: Record<string, boolean> = {};
  for (const method of KNOWN_METHODS) config[method] = allowed.includes(method);
  return config;
}

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

export function statusEntitles(status: string): boolean {
  return status === "active" || status === "trialing";
}

export function epochToIso(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

export function invoiceNumber(paymentId: string, issuedAt: Date = new Date()): string {
  const suffix = paymentId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase() || "00000000";
  return `ZB-${issuedAt.getUTCFullYear()}-${suffix}`;
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

/** Razorpay subscription callback signature: `payment_id|subscription_id`. */
export async function verifySubscriptionSignature(input: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
  secret: string;
}): Promise<boolean> {
  const expected = await hmacHex(input.secret, `${input.paymentId}|${input.subscriptionId}`);
  return safeEqual(expected, input.signature);
}

/** Razorpay webhook signature: HMAC-SHA256 over the raw request body. */
export async function webhookSignatureMatches(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  return safeEqual(await hmacHex(secret, rawBody), signature);
}
