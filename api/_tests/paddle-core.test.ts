import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  invoiceNumber,
  isPaidPlan,
  looksLikePaddlePriceId,
  mapPaddleSubscriptionStatus,
  nextPlan,
  normalizePaddleSubscription,
  normalizePaddleTransaction,
  paddleSignatureDigest,
  parsePaddleSignature,
  planForPriceId,
  priceMapFromEnv,
  safeEqual,
  signatureIsFresh,
  statusEntitles,
  verifyPaddleWebhookSignature,
} from "../_lib/paddle-core.js";

const SECRET = "pdl_ntfset_test_webhook_secret";

function sign(rawBody: string, timestamp: number, secret = SECRET) {
  return `ts=${timestamp};h1=${createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex")}`;
}

describe("paddle-core — upgrade ladder", () => {
  it("walks free → growth → agency → scale one step at a time", () => {
    expect(nextPlan("free")).toBe("growth");
    expect(nextPlan("growth")).toBe("agency");
    expect(nextPlan("agency")).toBe("scale");
  });

  it("returns null on the highest plan (no higher plan exists)", () => {
    expect(nextPlan("scale")).toBeNull();
  });

  it("returns null for unknown plans", () => {
    expect(nextPlan("enterprise")).toBeNull();
    expect(nextPlan("")).toBeNull();
  });

  it("recognizes only the three paid plans", () => {
    expect(isPaidPlan("growth")).toBe(true);
    expect(isPaidPlan("agency")).toBe(true);
    expect(isPaidPlan("scale")).toBe(true);
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan("pro")).toBe(false);
  });
});

describe("paddle-core — price map", () => {
  it("maps environment price ids per plan", () => {
    const map = priceMapFromEnv({
      PADDLE_PRICE_GROWTH_ID: "pri_growth_1",
      PADDLE_PRICE_AGENCY_ID: "pri_agency_1",
      PADDLE_PRICE_SCALE_ID: "pri_scale_1",
    });
    expect(planForPriceId("pri_growth_1", map)).toBe("growth");
    expect(planForPriceId("pri_agency_1", map)).toBe("agency");
    expect(planForPriceId("pri_scale_1", map)).toBe("scale");
  });

  it("never maps an unknown or missing price id to a plan", () => {
    const map = priceMapFromEnv({ PADDLE_PRICE_GROWTH_ID: "pri_growth_1" });
    expect(planForPriceId("pri_unknown", map)).toBeNull();
    expect(planForPriceId("", map)).toBeNull();
    expect(planForPriceId(undefined, map)).toBeNull();
    expect(planForPriceId(null, map)).toBeNull();
  });

  it("ignores blank environment values", () => {
    const map = priceMapFromEnv({ PADDLE_PRICE_GROWTH_ID: "   ", PADDLE_PRICE_AGENCY_ID: "pri_agency_1" });
    expect(map.growth).toBeUndefined();
    expect(map.agency).toBe("pri_agency_1");
  });

  it("recognizes the pri_ price-id shape (products are pro_)", () => {
    expect(looksLikePaddlePriceId("pri_01gsz8x8sawmvhz1pv30nge1ke")).toBe(true);
    expect(looksLikePaddlePriceId("pro_01gsz8")).toBe(false);
  });
});

describe("paddle-core — status mapping", () => {
  it("maps Paddle's vocabulary onto the stored Zybble spellings", () => {
    expect(mapPaddleSubscriptionStatus("active")).toBe("active");
    expect(mapPaddleSubscriptionStatus("trialing")).toBe("trialing");
    expect(mapPaddleSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapPaddleSubscriptionStatus("paused")).toBe("paused");
    // Paddle uses one 'l'; the database constraint uses two.
    expect(mapPaddleSubscriptionStatus("canceled")).toBe("cancelled");
  });

  it("falls back for unknown statuses", () => {
    expect(mapPaddleSubscriptionStatus("whatever", "active")).toBe("active");
    expect(mapPaddleSubscriptionStatus(undefined, "active")).toBe("active");
  });

  it("entitles only active and trialing", () => {
    expect(statusEntitles("active")).toBe(true);
    expect(statusEntitles("trialing")).toBe(true);
    expect(statusEntitles("past_due")).toBe(false);
    expect(statusEntitles("paused")).toBe(false);
    expect(statusEntitles("cancelled")).toBe(false);
  });
});

describe("paddle-core — webhook signature verification", () => {
  const rawBody = JSON.stringify({ event_id: "evt_1", event_type: "transaction.paid", data: { id: "txn_1" } });
  const now = Math.floor(Date.now() / 1000);

  it("parses ts=…;h1=… headers, including rotation duplicates", () => {
    const parsed = parsePaddleSignature(`ts=${now};h1=${"a".repeat(64)};h1=${"b".repeat(64)}`);
    expect(parsed).not.toBeNull();
    expect(parsed!.timestamp).toBe(now);
    expect(parsed!.signatures).toEqual(["a".repeat(64), "b".repeat(64)]);
  });

  it("rejects malformed headers", () => {
    expect(parsePaddleSignature("")).toBeNull();
    expect(parsePaddleSignature(null)).toBeNull();
    expect(parsePaddleSignature(undefined)).toBeNull();
    expect(parsePaddleSignature("ts=abc;h1=zz")).toBeNull(); // non-numeric ts + short h1
    expect(parsePaddleSignature(`ts=${now}`)).toBeNull(); // no h1 at all
  });

  it("computes HMAC-SHA256 over `${ts}:${rawBody}` with the webhook secret", () => {
    const digest = paddleSignatureDigest(rawBody, now, SECRET);
    expect(digest).toBe(createHmac("sha256", SECRET).update(`${now}:${rawBody}`).digest("hex"));
  });

  it("verifies a correctly signed body over the RAW bytes", () => {
    expect(verifyPaddleWebhookSignature({
      rawBody,
      signatureHeader: sign(rawBody, now),
      secret: SECRET,
      nowMs: now * 1000,
    })).toBe(true);
  });

  it("rejects a signature computed over different bytes than the raw body", () => {
    // Same JSON values, different trailing bytes — the digest must not match.
    expect(`${JSON.stringify(JSON.parse(rawBody))} ` === rawBody).toBe(false);
    expect(verifyPaddleWebhookSignature({
      rawBody: `${JSON.stringify(JSON.parse(rawBody))} `,
      signatureHeader: sign(rawBody, now),
      secret: SECRET,
      nowMs: now * 1000,
    })).toBe(false);
  });

  it("rejects a tampered body", () => {
    const header = sign(rawBody, now);
    expect(verifyPaddleWebhookSignature({
      rawBody: rawBody.replace("txn_1", "txn_evil"),
      signatureHeader: header,
      secret: SECRET,
      nowMs: now * 1000,
    })).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyPaddleWebhookSignature({
      rawBody,
      signatureHeader: sign(rawBody, now, "other-secret"),
      secret: SECRET,
      nowMs: now * 1000,
    })).toBe(false);
  });

  it("rejects replayed events outside the tolerance window", () => {
    const oldTimestamp = now - 3600; // an hour old
    expect(signatureIsFresh(oldTimestamp, now * 1000, 300)).toBe(false);
    expect(verifyPaddleWebhookSignature({
      rawBody,
      signatureHeader: sign(rawBody, oldTimestamp),
      secret: SECRET,
      nowMs: now * 1000,
    })).toBe(false);
  });

  it("accepts any valid h1 during secret rotation", () => {
    const oldSecret = "pdl_ntfset_old_secret";
    const newSecret = SECRET;
    const digestOld = createHmac("sha256", oldSecret).update(`${now}:${rawBody}`).digest("hex");
    const digestNew = createHmac("sha256", newSecret).update(`${now}:${rawBody}`).digest("hex");
    const header = `ts=${now};h1=${digestOld};h1=${digestNew}`;
    expect(verifyPaddleWebhookSignature({
      rawBody,
      signatureHeader: header,
      secret: newSecret,
      nowMs: now * 1000,
    })).toBe(true);
  });

  it("never treats an empty digest as a match (constant-time compare guard)", () => {
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("paddle-core — payload normalization", () => {
  const subscription = {
    id: "sub_1",
    status: "active",
    customer_id: "ctm_1",
    currency_code: "USD",
    current_billing_period: { starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" },
    next_billed_at: "2026-02-01T00:00:00Z",
    scheduled_change: { action: "cancel", effective_at: "2026-02-01T00:00:00Z" },
    items: [{ price: { id: "pri_growth_1" }, quantity: 1 }],
    custom_data: { zybble_token: "tok_123" },
  };

  it("normalizes a subscription entity", () => {
    const n = normalizePaddleSubscription(subscription);
    expect(n).toMatchObject({
      providerSubscriptionId: "sub_1",
      providerCustomerId: "ctm_1",
      providerPriceId: "pri_growth_1",
      status: "active",
      currency: "USD",
      currentPeriodEnd: "2026-02-01T00:00:00Z",
      scheduledAction: "cancel",
      scheduledEffectiveAt: "2026-02-01T00:00:00Z",
      checkoutToken: "tok_123",
    });
  });

  it("also reads the flat price_id form on items", () => {
    const n = normalizePaddleSubscription({ ...subscription, items: [{ price_id: "pri_scale_1" }] });
    expect(n?.providerPriceId).toBe("pri_scale_1");
  });

  it("maps canceled and reads null periods safely", () => {
    const n = normalizePaddleSubscription({ id: "sub_2", status: "canceled", canceled_at: "2026-01-15T00:00:00Z" });
    expect(n?.status).toBe("cancelled");
    expect(n?.currentPeriodEnd).toBeNull();
    expect(n?.scheduledAction).toBeNull();
  });

  it("returns null without an id", () => {
    expect(normalizePaddleSubscription(null)).toBeNull();
    expect(normalizePaddleSubscription({ status: "active" })).toBeNull();
    expect(normalizePaddleSubscription("nope")).toBeNull();
  });

  it("normalizes a transaction: string minor units → numbers", () => {
    const n = normalizePaddleTransaction({
      id: "txn_1",
      subscription_id: "sub_1",
      customer_id: "ctm_1",
      status: "paid",
      currency_code: "USD",
      totals: { total: "4900" },
      invoice_id: "in_1",
      invoice_number: "1234-5678",
      billing_period: { starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" },
      payments: [{ method_details: { type: "card" } }],
      custom_data: { zybble_token: "tok_123" },
    });
    expect(n).toMatchObject({
      providerTransactionId: "txn_1",
      providerSubscriptionId: "sub_1",
      status: "paid",
      currency: "USD",
      amountMinor: 4900,
      invoiceId: "in_1",
      invoiceNumber: "1234-5678",
      paymentMethod: "card",
      checkoutToken: "tok_123",
    });
  });

  it("derives a stable invoice number from the transaction id", () => {
    expect(invoiceNumber("txn_abc1234567")).toMatch(/^ZB-\d{4}-[A-Z0-9]{8}$/);
    expect(invoiceNumber("txn_abc1234567")).toBe(invoiceNumber("txn_abc1234567"));
  });
});
