import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  BILLING_CURRENCY,
  checkoutMethodConfig,
  epochToIso,
  invoiceNumber,
  mapSubscriptionStatus,
  statusEntitles,
  subscriptionSignature,
  verifySubscriptionSignature,
  verifyWebhookSignature,
} from "../_lib/billing-core.js";

describe("billing currency", () => {
  it("is INR only", () => {
    expect(BILLING_CURRENCY).toBe("INR");
  });
});

describe("checkoutMethodConfig", () => {
  it("defaults to cards and digital wallets, disabling everything else", () => {
    const config = checkoutMethodConfig(undefined);
    expect(config.card).toBe(true);
    expect(config.wallet).toBe(true);
    expect(config.upi).toBe(false);
    expect(config.netbanking).toBe(false);
    expect(config.paylater).toBe(false);
    expect(config.emi).toBe(false);
  });

  it("lets an operator widen the list (e.g. UPI mandates) from configuration", () => {
    const config = checkoutMethodConfig("card, upi");
    expect(config.card).toBe(true);
    expect(config.upi).toBe(true);
    expect(config.wallet).toBe(false);
  });

  it("imposes no restriction when set to all, so the Razorpay account decides", () => {
    expect(checkoutMethodConfig("all")).toEqual({});
    expect(checkoutMethodConfig("*")).toEqual({});
  });

  it("ignores unknown method names rather than inventing them", () => {
    const config = checkoutMethodConfig("card,crypto,teleport");
    expect(config.card).toBe(true);
    expect(Object.keys(config)).not.toContain("crypto");
    expect(Object.keys(config)).not.toContain("teleport");
  });
});

describe("mapSubscriptionStatus", () => {
  it("maps the Razorpay lifecycle onto Zybble statuses", () => {
    expect(mapSubscriptionStatus("created", "x")).toBe("created");
    expect(mapSubscriptionStatus("authenticated", "x")).toBe("authenticated");
    expect(mapSubscriptionStatus("active", "x")).toBe("active");
    expect(mapSubscriptionStatus("pending", "x")).toBe("past_due");
    expect(mapSubscriptionStatus("halted", "x")).toBe("halted");
    expect(mapSubscriptionStatus("paused", "x")).toBe("paused");
    expect(mapSubscriptionStatus("cancelled", "x")).toBe("cancelled");
    expect(mapSubscriptionStatus("completed", "x")).toBe("completed");
    expect(mapSubscriptionStatus("expired", "x")).toBe("expired");
    expect(mapSubscriptionStatus("something-new", "fallback")).toBe("fallback");
  });

  it("only entitles on active/trialing", () => {
    expect(statusEntitles("active")).toBe(true);
    expect(statusEntitles("trialing")).toBe(true);
    for (const status of ["created", "authenticated", "past_due", "halted", "paused", "cancelled", "expired"]) {
      expect(statusEntitles(status)).toBe(false);
    }
  });
});

describe("signatures", () => {
  const secret = "razorpay-key-secret";

  it("computes the subscription signature as payment_id|subscription_id", () => {
    const expected = createHmac("sha256", secret).update("pay_1|sub_1").digest("hex");
    expect(subscriptionSignature("pay_1", "sub_1", secret)).toBe(expected);
  });

  it("accepts a genuine callback and rejects tampering", () => {
    const signature = subscriptionSignature("pay_1", "sub_1", secret);
    expect(verifySubscriptionSignature({ paymentId: "pay_1", subscriptionId: "sub_1", signature, secret })).toBe(true);
    // a different payment, a different subscription, or a different secret
    expect(verifySubscriptionSignature({ paymentId: "pay_2", subscriptionId: "sub_1", signature, secret })).toBe(false);
    expect(verifySubscriptionSignature({ paymentId: "pay_1", subscriptionId: "sub_2", signature, secret })).toBe(false);
    expect(verifySubscriptionSignature({ paymentId: "pay_1", subscriptionId: "sub_1", signature, secret: "other" })).toBe(false);
  });

  it("rejects empty or malformed signatures without throwing", () => {
    expect(verifySubscriptionSignature({ paymentId: "pay_1", subscriptionId: "sub_1", signature: "", secret })).toBe(false);
    expect(verifySubscriptionSignature({ paymentId: "pay_1", subscriptionId: "sub_1", signature: "zz", secret })).toBe(false);
  });

  it("verifies webhook signatures over the raw body", () => {
    const body = JSON.stringify({ event: "subscription.charged" });
    const signature = createHmac("sha256", "webhook-secret").update(body).digest("hex");
    expect(verifyWebhookSignature(body, signature, "webhook-secret")).toBe(true);
    expect(verifyWebhookSignature(`${body} `, signature, "webhook-secret")).toBe(false);
    expect(verifyWebhookSignature(body, signature, "wrong-secret")).toBe(false);
  });
});

describe("helpers", () => {
  it("converts Razorpay epoch seconds, tolerating missing values", () => {
    expect(epochToIso(1700000000)).toBe(new Date(1700000000 * 1000).toISOString());
    expect(epochToIso(null)).toBeNull();
    expect(epochToIso(0)).toBeNull();
    expect(epochToIso("1700000000")).toBeNull();
  });

  it("derives a stable invoice number from the payment id (duplicate-safe)", () => {
    const first = invoiceNumber("pay_ABC12345", new Date("2026-02-01T00:00:00Z"));
    const second = invoiceNumber("pay_ABC12345", new Date("2026-02-01T00:00:00Z"));
    expect(first).toBe(second);
    expect(first).toMatch(/^ZB-2026-[A-Z0-9]{8}$/);
  });
});
