import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-level guards for the Paddle checkout + webhook flow.
 *
 * These execute no server and no provider, but they lock in the security
 * architecture the whole billing migration stands on:
 *
 *   1. The browser opens Paddle.js Checkout with the PUBLIC client-side token
 *      only — it never sees the API key, the webhook secret or a server price
 *      map. Initial subscriptions are ONLY created by the customer completing
 *      a Paddle Checkout; the server never POSTs /subscriptions.
 *   2. The /api/paddle-webhook handler verifies the `Paddle-Signature` HMAC
 *      over the RAW body BEFORE parsing it, and deduplicates on the Paddle
 *      event id via webhook_events.
 *   3. No Razorpay code, keys, hosts or SDKs remain anywhere in active code.
 */

function read(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

const apiBilling = read("api", "billing.ts");
const apiPaddle = read("api", "_lib", "paddle.ts");
const apiPaddleCore = read("api", "_lib", "paddle-core.ts");
const apiPaddleApply = read("api", "_lib", "paddle-apply.ts");
const apiWebhook = read("api", "paddle-webhook.ts");
const apiClient = read("src", "app", "services", "api.ts");
const paddleClient = read("src", "app", "services", "paddle.ts");
const billingPage = read("src", "app", "pages", "Billing.tsx");
const edgeBilling = read("supabase", "functions", "billing", "index.ts");
const edgeSharedBilling = read("supabase", "functions", "_shared", "billing.ts");
const edgeWebhook = read("supabase", "functions", "paddle-webhook", "index.ts");

describe("browser side — Paddle.js with the public client token only", () => {
  it("uses the official @paddle/paddle-js package, not a CDN script tag", () => {
    expect(paddleClient).toContain('@paddle/paddle-js');
    expect(read("index.html")).not.toMatch(/paddle\.com\/paddle\.js|cdn\.paddle/i);
  });

  it("initializes with the CLIENT-side token env var and never a server secret", () => {
    expect(paddleClient).toContain("VITE_PADDLE_CLIENT_TOKEN");
    expect(paddleClient).not.toMatch(/PADDLE_API_KEY|PADDLE_WEBHOOK_SECRET/);
    // No VITE_ variable may ever hold a server credential.
    for (const source of [paddleClient, apiClient, billingPage]) {
      expect(source).not.toMatch(/VITE_PADDLE_(API_KEY|WEBHOOK_SECRET)/);
      expect(source).not.toMatch(/VITE_[A-Z_]*SECRET/);
    }
  });

  it("opens checkout with ONLY the server-prepared public price id and intent token", () => {
    expect(paddleClient).toMatch(/items: \[\{ priceId: options\.priceId, quantity: 1 \}\]/);
    expect(paddleClient).toMatch(/customData: \{ zybble_token: options\.checkoutToken \}/);
  });

  it("never claims a plan from the browser: completion is handed to the server sync", () => {
    expect(paddleClient).not.toMatch(/planId\s*=\s*[^s]/);
    expect(apiClient).toContain('action: "sync"');
    expect(apiClient).toContain("transactionId");
    // A completed checkout is explicitly framed as a hint, not a grant.
    expect(billingPage).toContain("Completed ≠ granted");
  });

  it("has no window.open / hosted redirect for checkout", () => {
    for (const source of [paddleClient, apiClient, billingPage]) {
      expect(source).not.toMatch(/window\.open\(/);
    }
  });
});

describe("server side — checkout preparation never creates subscriptions", () => {
  it("the checkout action makes no provider call and returns browser-safe data", () => {
    expect(apiBilling).toMatch(/PADDLE_PRICE_\$\{plan\.toUpperCase\(\)\}_ID|requirePriceIdForPlan/);
    expect(apiBilling).not.toMatch(/action === "checkout"[\s\S]{0,4000}paddleRequest\(\s*['"`]\/subscriptions['"`]/);
  });

  it("the server NEVER POSTs /subscriptions — only Paddle Checkout creates them", () => {
    for (const source of [apiBilling, apiPaddle, apiPaddleApply, edgeBilling, edgeSharedBilling]) {
      expect(source).not.toMatch(/['"`]\/subscriptions['"`]\s*,\s*\{[^}]*method:\s*['"`]POST['"`]/);
    }
    // The only POSTs the server makes are cancel (+ the PATCH for upgrades).
    expect(apiPaddle).toMatch(/\/subscriptions\/\$\{encodeURIComponent\(subscriptionId\)\}\/cancel/);
    expect(apiPaddle).toMatch(/method: "PATCH"/);
  });

  it("upgrades PATCH the existing subscription with the failure-safe proration contract", () => {
    expect(apiPaddle).toContain('"prorated_immediately"');
    expect(apiPaddle).toContain('"prevent_change"');
    expect(edgeBilling).toContain('"prorated_immediately"');
    expect(edgeBilling).toContain('"prevent_change"');
  });

  it("cancellation is at period end, preserving access until current_period_end", () => {
    expect(apiPaddle).toContain('effective_from: "next_billing_period"');
    expect(edgeBilling).toContain('effective_from: "next_billing_period"');
  });

  it("price ids are resolved SERVER-side; the browser only receives them", () => {
    expect(apiPaddle).toContain("priceMapFromEnv");
    expect(apiPaddleCore).toContain("planForPriceId");
    expect(paddleClient).not.toContain("pri_"); // no hardcoded price ids client-side
  });
});

describe("webhook — verify the signature over the RAW body, then dedupe", () => {
  it("is a Web-standard handler that reads the raw body before parsing", () => {
    expect(apiWebhook).toContain("export async function POST(request: Request)");
    const textCall = apiWebhook.indexOf("await request.text()");
    const jsonParse = apiWebhook.indexOf("JSON.parse(rawBody)");
    expect(textCall).toBeGreaterThan(-1);
    expect(jsonParse).toBeGreaterThan(textCall);
    // The edge function reads raw text first too.
    expect(edgeWebhook.indexOf("await req.text()")).toBeGreaterThan(-1);
    expect(edgeWebhook.indexOf("JSON.parse(rawBody)")).toBeGreaterThan(edgeWebhook.indexOf("await req.text()"));
  });

  it("verifies the Paddle-Signature header BEFORE any database write", () => {
    const verifyCall = apiWebhook.indexOf("verifyPaddleWebhookSignature");
    const firstInsert = apiWebhook.indexOf('from("webhook_events").insert');
    expect(verifyCall).toBeGreaterThan(-1);
    expect(firstInsert).toBeGreaterThan(verifyCall);
  });

  it("uses a constant-time comparison and a replay window", () => {
    expect(apiPaddleCore).toContain("timingSafeEqual");
    expect(apiPaddleCore).toContain("signatureIsFresh");
    expect(edgeSharedBilling).toContain("safeEqual");
    expect(edgeSharedBilling).toMatch(/tolerance|replay window/i);
  });

  it("deduplicates deliveries on (provider, event_id) and returns 200 for duplicates", () => {
    expect(apiWebhook).toContain("provider: \"paddle\"");
    expect(apiWebhook).toMatch(/deduplicated: true/);
    expect(edgeWebhook).toContain("provider: \"paddle\"");
  });

  it("handles the full subscription + transaction lifecycle", () => {
    const lifecycle = [
      "subscription.created",
      "subscription.updated",
      "subscription.past_due",
      "subscription.paused",
      "subscription.resumed",
      "subscription.canceled",
      "transaction.paid",
      "transaction.completed",
      "transaction.payment_failed",
      "transaction.canceled",
    ];
    for (const eventType of lifecycle) {
      expect(apiWebhook).toContain(`"${eventType}"`);
      expect(edgeWebhook).toContain(`"${eventType}"`);
    }
  });

  it("the webhook is exempt from JWT verification (signature is the boundary)", () => {
    expect(read("supabase", "config.toml")).toMatch(/\[functions\.paddle-webhook\][\s\S]{0,80}verify_jwt = false/);
    expect(read("supabase", "config.toml")).not.toContain("razorpay-webhook");
  });
});

describe("the Razorpay era is fully retired", () => {
  it("no Razorpay SDK, keys, hosts or plan ids remain in active code", () => {
    const sources = [
      apiBilling,
      apiPaddle,
      apiPaddleCore,
      apiPaddleApply,
      apiWebhook,
      apiClient,
      paddleClient,
      billingPage,
      edgeBilling,
      edgeSharedBilling,
      edgeWebhook,
      read("api", "search-run.ts"),
      read("api", "_lib", "admin-read.ts"),
      read("api", "_lib", "admin-actions.ts"),
    ];
    for (const source of sources) {
      expect(source).not.toMatch(/rzp\.|razorpay\.com|api\.razorpay|checkout\.razorpay|RAZORPAY_[A-Z_]+/i);
    }
  });

  it("no razorpay module files or edge functions remain", () => {
    expect(() => read("api", "_lib", "razorpay.ts")).toThrow();
    expect(() => read("src", "app", "services", "razorpay.ts")).toThrow();
    expect(() => read("supabase", "functions", "razorpay-webhook", "index.ts")).toThrow();
  });

  it("both billing implementations expose the same four Paddle actions", () => {
    for (const source of [apiBilling, edgeBilling]) {
      expect(source).toContain('"checkout"');
      expect(source).toContain('"upgrade"');
      expect(source).toContain('"sync"');
      expect(source).toContain('"cancel"');
    }
    // The legacy verify action is gone from both.
    expect(apiBilling).not.toMatch(/action === "verify"/);
    expect(edgeBilling).not.toMatch(/action === "verify"/);
  });
});

describe("env contract", () => {
  it("the client token is browser-exposed; the API key and webhook secret are server-only", () => {
    const envExample = read(".env.example");
    expect(envExample).toContain("VITE_PADDLE_CLIENT_TOKEN");
    expect(envExample).toContain("VITE_PADDLE_ENVIRONMENT");
    expect(envExample).toContain("PADDLE_API_KEY");
    expect(envExample).toContain("PADDLE_WEBHOOK_SECRET");
    expect(envExample).toContain("PADDLE_PRICE_GROWTH_ID");
    expect(envExample).toContain("PADDLE_PRICE_AGENCY_ID");
    expect(envExample).toContain("PADDLE_PRICE_SCALE_ID");
    // Never a VITE_-prefixed server credential.
    expect(envExample).not.toMatch(/VITE_PADDLE_(API_KEY|WEBHOOK_SECRET)/);
    expect(envExample).not.toMatch(/RAZORPAY/i);
  });
});
