import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Architectural guards for the checkout flow.
 *
 * The production bug was that the server returned Razorpay's hosted
 * subscription page (`short_url` / `auth_link`, i.e.
 * https://api.razorpay.com/v1/l/subscriptions/…) and the browser opened it in
 * a new tab, where Razorpay answered "Hosted page is not available". These
 * tests fail the build if that architecture ever comes back.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

const apiBilling = read("api", "billing.ts");
const edgeBilling = read("supabase", "functions", "billing", "index.ts");
const webhook = read("supabase", "functions", "razorpay-webhook", "index.ts");
const frontendApi = read("src", "app", "services", "api.ts");
const checkoutClient = read("src", "app", "services", "razorpay.ts");
const billingPage = read("src", "app", "pages", "Billing.tsx");

describe("no hosted-page redirect anywhere", () => {
  for (const [name, source] of Object.entries({ apiBilling, edgeBilling, frontendApi, checkoutClient, billingPage })) {
    it(`${name} never uses short_url / auth_link / /v1/l/`, () => {
      const code = source
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
        })
        .join("\n");
      expect(code).not.toMatch(/short_url/);
      expect(code).not.toMatch(/auth_link/);
      expect(code).not.toMatch(/v1\/l\//);
    });
  }

  it("the Billing page no longer opens checkout in another tab", () => {
    expect(billingPage).not.toMatch(/window\.open\(/);
    expect(billingPage).not.toMatch(/window\.location\.(assign|href)\s*=/);
    expect(billingPage).toContain("openRazorpayCheckout");
  });

  it("checkout.js is loaded on demand from Razorpay's official host", () => {
    expect(checkoutClient).toContain("https://checkout.razorpay.com/v1/checkout.js");
    expect(checkoutClient).toContain("subscription_id");
    // `redirect: false` keeps the overlay on zybble.com.
    expect(checkoutClient).toMatch(/redirect:\s*false/);
  });
});

describe("secrets stay on the server", () => {
  it("the browser bundle never references the Razorpay secret or webhook secret", () => {
    for (const source of [frontendApi, checkoutClient, billingPage]) {
      expect(source).not.toContain("RAZORPAY_KEY_SECRET");
      expect(source).not.toContain("RAZORPAY_WEBHOOK_SECRET");
      expect(source).not.toContain("SERVICE_ROLE");
    }
  });

  it("only the public key id is handed to the browser", () => {
    const checkoutFn = apiBilling.slice(
      apiBilling.indexOf("async function checkout("),
      apiBilling.indexOf("async function verify("),
    );
    const start = checkoutFn.lastIndexOf("return {");
    const returned = checkoutFn.slice(start, checkoutFn.indexOf("\n  };", start));
    expect(returned).toContain("keyId,");
    expect(returned).not.toMatch(/secret/i);
    expect(returned).not.toMatch(/url/i);
  });
});

describe("entitlement is never granted by the browser", () => {
  it("the checkout action parks the provider subscription instead of upgrading", () => {
    const checkoutFn = apiBilling.slice(
      apiBilling.indexOf("async function checkout("),
      apiBilling.indexOf("async function verify("),
    );
    expect(checkoutFn).toContain("subscription_checkouts");
    expect(checkoutFn).not.toMatch(/from\("subscriptions"\)\s*\.upsert/);
  });

  it("the verify action checks signature, ownership, subscription and payment", () => {
    const verifyFn = apiBilling.slice(apiBilling.indexOf("async function verify("), apiBilling.indexOf("type ApplyInput"));
    expect(verifyFn).toContain("verifySubscriptionSignature");
    expect(verifyFn).toContain("checkout_mismatch");
    expect(verifyFn).toContain("subscription_not_active");
    expect(verifyFn).toContain("payment_not_captured");
    expect(verifyFn).toContain("currency_invalid");
  });

  it("both billing implementations expose the same actions", () => {
    for (const action of ["checkout", "verify", "sync", "cancel"]) {
      expect(apiBilling).toContain(`"${action}"`);
      expect(edgeBilling).toContain(`"${action}"`);
    }
  });
});

describe("webhook", () => {
  it("verifies the signature before touching the database", () => {
    const verifyAt = webhook.indexOf("verifyRazorpaySignature");
    const firstWrite = webhook.indexOf('from("webhook_events")');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(firstWrite);
  });

  it("is idempotent on Razorpay's event id", () => {
    expect(webhook).toContain("x-razorpay-event-id");
    expect(webhook).toContain("deduplicated: true");
  });

  it("handles the whole subscription lifecycle", () => {
    for (const event of [
      "subscription.authenticated",
      "subscription.activated",
      "subscription.charged",
      "subscription.updated",
      "subscription.pending",
      "subscription.halted",
      "subscription.paused",
      "subscription.resumed",
      "subscription.cancelled",
      "subscription.completed",
      "subscription.expired",
      "payment.captured",
      "payment.failed",
      "refund.processed",
    ]) {
      expect(webhook).toContain(event);
    }
  });

  it("stores INR amounts in the smallest unit and never defaults to USD", () => {
    expect(webhook).not.toContain("USD");
    expect(webhook).toContain("BILLING_CURRENCY");
  });
});
