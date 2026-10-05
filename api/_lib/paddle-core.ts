// ============================================================================
// Pure Paddle Billing helpers — no I/O, no secrets, fully unit-testable.
//
// Shared by /api/billing, /api/paddle-webhook and /api/admin so every runtime
// applies EXACTLY the same rules: signature verification over the RAW body,
// status mapping, price-id → plan mapping, and the upgrade ladder.
//
// The Paddle API key and webhook secret are read by the CALLER (api/_lib/
// paddle.ts or the Edge _shared module) and only ever used to COMPUTE or CALL
// — never logged, never returned, never bundled into the client.
//
// NOTE: imported with the emitted ".js" extension (see
// api/_tests/module-resolution.test.ts) because Vercel compiles api/**/*.ts to
// .js without rewriting import specifiers.
// ============================================================================
import { createHmac, timingSafeEqual } from "node:crypto";

/** Zybble's paid plans, in upgrade order. Free is handled separately. */
export const PLAN_LADDER = ["free", "growth", "agency", "scale"] as const;

export type PlanId = (typeof PLAN_LADDER)[number];
export type PaidPlanId = Exclude<PlanId, "free">;

export const PAID_PLANS: PaidPlanId[] = ["growth", "agency", "scale"];

export const PLAN_LABELS: Record<PlanId, string> = {
  free: "Free",
  growth: "Growth",
  agency: "Agency",
  scale: "Scale",
};

/**
 * The single immediate upgrade target for a plan, or null when the plan is
 * the highest available. Zybble has NO downgrade flow and NO skipped steps:
 *   free → growth → agency → scale
 */
export function nextPlan(plan: string): PaidPlanId | null {
  const index = PLAN_LADDER.indexOf(plan as PlanId);
  if (index === -1 || index >= PLAN_LADDER.length - 1) return null;
  return PLAN_LADDER[index + 1] as PaidPlanId;
}

/** True for the paid plan ids only. */
export function isPaidPlan(plan: unknown): plan is PaidPlanId {
  return typeof plan === "string" && (PAID_PLANS as string[]).includes(plan);
}

/* ------------------------------------------------------------------ */
/* Price-id ↔ plan mapping (server-side only, authoritative)          */
/* ------------------------------------------------------------------ */

export type PricePlanMap = Partial<Record<PaidPlanId, string>>;

/** Build the plan → Paddle price id map from environment values. */
export function priceMapFromEnv(env: Record<string, string | undefined>): PricePlanMap {
  const map: PricePlanMap = {};
  for (const plan of PAID_PLANS) {
    const key = `PADDLE_PRICE_${plan.toUpperCase()}_ID`;
    const value = (env[key] ?? "").trim();
    if (value) map[plan] = value;
  }
  return map;
}

/**
 * Map a PAID Paddle price id to the canonical Zybble plan. This is the only
 * direction entitlement ever flows: the browser never tells the server which
 * plan a checkout was "for" — the server derives it from the price that
 * Paddle says was actually purchased.
 */
export function planForPriceId(priceId: unknown, map: PricePlanMap): PaidPlanId | null {
  if (typeof priceId !== "string" || !priceId) return null;
  for (const plan of PAID_PLANS) {
    if (map[plan] === priceId) return plan;
  }
  return null;
}

/** The configured Paddle price id for a paid plan, or null. */
export function priceIdForPlan(plan: PaidPlanId, map: PricePlanMap): string | null {
  return map[plan] ?? null;
}

/* ------------------------------------------------------------------ */
/* Status mapping                                                     */
/* ------------------------------------------------------------------ */

/**
 * Paddle Billing subscription status → Zybble subscription status.
 * Paddle vocabulary: active | canceled | past_due | paused | trialing.
 * (Paddle uses the single-letter spelling "canceled"; Zybble's database
 * historically stores "cancelled" — keep the stored spelling so the 0001
 * check constraint and effective_plan_for_user() keep working.)
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

/**
 * True when a mapped Zybble status means "paid access is live". Zybble does
 * not offer trials today, so `trialing` only ever entitles if Paddle actually
 * starts one — the mapping is kept symmetrical with
 * effective_plan_for_user() in migration 0006.
 */
export function statusEntitles(status: string): boolean {
  return status === "active" || status === "trialing";
}

/* ------------------------------------------------------------------ */
/* Webhook signature verification                                     */
/* ------------------------------------------------------------------ */

export type PaddleSignature = {
  timestamp: number;
  /** All h1 digests in the header (Paddle sends >1 while rotating secrets). */
  signatures: string[];
};

/**
 * Parse `Paddle-Signature: ts=1671552777;h1=eb4d…` (semicolon-separated
 * key=value pairs). Returns null for anything malformed.
 */
export function parsePaddleSignature(header: unknown): PaddleSignature | null {
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

/** HMAC-SHA256(`${ts}:${rawBody}`) keyed with the webhook secret, hex. */
export function paddleSignatureDigest(rawBody: string, timestamp: number | string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex");
}

/** Constant-time comparison that never throws on malformed input. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Reject events whose signed timestamp is too old (replay protection). */
export function signatureIsFresh(timestamp: number, nowMs = Date.now(), toleranceSeconds = 300): boolean {
  const age = Math.floor(nowMs / 1000) - timestamp;
  return age >= -toleranceSeconds && age <= toleranceSeconds;
}

/**
 * Verify a Paddle webhook signature against the RAW request body.
 *
 * The body must be the exact bytes Paddle sent — read it BEFORE parsing the
 * JSON and never re-stringify a parsed object (key order, escaping and
 * whitespace would change the digest). The timestamp is part of the signed
 * material, which is what makes replayed requests rejectable.
 */
export function verifyPaddleWebhookSignature(input: {
  rawBody: string;
  signatureHeader: unknown;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): boolean {
  const parsed = parsePaddleSignature(input.signatureHeader);
  if (!parsed) return false;
  if (!signatureIsFresh(parsed.timestamp, input.nowMs, input.toleranceSeconds)) return false;
  const digest = paddleSignatureDigest(input.rawBody, parsed.timestamp, input.secret);
  // Accept when ANY h1 matches (secret rotation sends old + new secret).
  return parsed.signatures.some((signature) => safeEqual(digest, signature));
}

/* ------------------------------------------------------------------ */
/* Paddle payload normalization                                       */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Safely read a nested object from an unknown payload. */
export function paddleObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function paddleString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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
  /** scheduled_change on the Paddle subscription, if any. */
  scheduledAction: "cancel" | "pause" | "resume" | null;
  scheduledEffectiveAt: string | null;
  checkoutToken: string | null;
};

/**
 * Normalize a Paddle subscription entity (from a webhook event or the
 * Paddle API) into the fields Zybble persists. Pure: no validation of
 * ownership, no entitlement decision — callers apply their own guards.
 */
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
  const paddleStatus = paddleString(raw.status) ?? "";
  return {
    providerSubscriptionId: id,
    providerCustomerId: paddleString(raw.customer_id),
    providerPriceId: basePriceId,
    paddleStatus,
    status: mapPaddleSubscriptionStatus(paddleStatus, "active"),
    currency: paddleString(raw.currency_code),
    currentPeriodStart: paddleString(period.starts_at),
    currentPeriodEnd: paddleString(period.ends_at),
    nextBilledAt: paddleString(raw.next_billed_at),
    canceledAt: paddleString(raw.canceled_at),
    scheduledAction:
      action === "cancel" || action === "pause" || action === "resume" ? action : null,
    scheduledEffectiveAt: paddleString(scheduled.effective_at),
    checkoutToken: paddleString(customData.zybble_token),
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

/** Normalize a Paddle transaction entity (webhook or API). */
export function normalizePaddleTransaction(txn: unknown): NormalizedPaddleTransaction | null {
  const raw = paddleObject(txn);
  const id = paddleString(raw.id);
  if (!id) return null;
  const totals = paddleObject(raw.totals);
  const amount = Number(totals.total ?? raw.total ?? 0);
  const payments = Array.isArray(raw.payments) ? raw.payments : [];
  const methodDetails = paddleObject(paddleObject(payments[0]).method_details);
  const customData = paddleObject(raw.custom_data);
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
    checkoutToken: paddleString(customData.zybble_token),
    billingPeriodStart: paddleString(period.starts_at),
    billingPeriodEnd: paddleString(period.ends_at),
    occurredAt: paddleString(raw.created_at) ?? paddleString(raw.billed_at),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Stable invoice number derived from the Paddle transaction id. */
export function invoiceNumber(providerTransactionId: string, issuedAt: Date = new Date()): string {
  const suffix = providerTransactionId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase() || "00000000";
  return `ZB-${issuedAt.getUTCFullYear()}-${suffix}`;
}

/**
 * A Paddle price id looks like `pri_01gsz8x8sawmvhz1pv30nge1ke`; product ids
 * start with `pro_`. Used for friendly configuration errors.
 */
export function looksLikePaddlePriceId(value: unknown): boolean {
  return typeof value === "string" && /^pri_[a-z\d]+$/i.test(value.trim());
}
