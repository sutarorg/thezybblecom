import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const h = vi.hoisted(() => {
  const createClient = vi.fn();
  const sb = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  };
  return { createClient, sb };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: h.createClient,
}));

import handler from "../billing";

function createMockReqRes(options: { method?: string; headers?: Record<string, string>; body?: unknown }) {
  const req = {
    method: options.method ?? "POST",
    headers: options.headers ?? {},
    body: options.body,
  } as unknown as IncomingMessage & { body?: unknown };

  let statusCode = 200;
  let responseBody: unknown = null;
  const headers: Record<string, string> = {};

  const res = {
    setHeader(key: string, value: string) {
      headers[key] = value;
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      responseBody = body;
    },
  } as unknown as ServerResponse & { status(code: number): any; json(body: unknown): void };

  return { req, res, getStatus: () => statusCode, getBody: () => responseBody, getHeaders: () => headers };
}

function selectBuilder(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  return builder;
}

function upsertBuilder(error: unknown = null) {
  return { upsert: vi.fn().mockResolvedValue({ error }) };
}

function updateBuilder(error: unknown = null) {
  const builder = {
    update: vi.fn(() => builder),
    eq: vi.fn().mockResolvedValue({ error }),
  };
  return builder;
}

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SECRET_KEYS",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_PLAN_GROWTH_ID",
  "RAZORPAY_PLAN_AGENCY_ID",
  "RAZORPAY_PLAN_SCALE_ID",
  "RAZORPAY_CHECKOUT_METHODS",
  "APP_URL",
] as const;

const savedEnv = new Map<string, string | undefined>();

function setBillingEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_service";
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "server-secret";
  process.env.RAZORPAY_PLAN_GROWTH_ID = "plan_growth";
  process.env.RAZORPAY_PLAN_AGENCY_ID = "plan_agency";
  process.env.RAZORPAY_PLAN_SCALE_ID = "plan_scale";
  process.env.APP_URL = "https://zybble.com";
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  for (const key of ENV_KEYS) delete process.env[key];
  h.createClient.mockReset().mockReturnValue(h.sb);
  h.sb.auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: "user_1", email: "founder@zybble.com" } }, error: null });
  h.sb.from.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/api/billing", () => {
  it("rejects non-POST requests with 405", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ method: "GET" });
    await handler(req, res);
    expect(getStatus()).toBe(405);
    expect(getBody()).toMatchObject({ code: "method_not_allowed" });
  });

  it("requires a Supabase service-role key, not just the public client config", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.SUPABASE_URL = "https://example.supabase.co";
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "sync" },
    });

    await handler(req, res);
    expect(getStatus()).toBe(500);
    expect(getBody()).toMatchObject({ code: "supabase_config" });
    expect(String((getBody() as { error: string }).error)).toContain("service-role/secret key");
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("rejects a publishable Supabase key for billing writes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_publishable_public";
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "sync" },
    });

    await handler(req, res);
    expect(getStatus()).toBe(500);
    expect(getBody()).toMatchObject({ code: "supabase_config" });
    expect(String((getBody() as { error: string }).error)).toContain("service-role/secret key");
  });

  it("prepares an on-site checkout and never returns a hosted-page URL", async () => {
    setBillingEnv();
    const plans = selectBuilder({ id: "growth", price_cents: 4900, currency: "INR" });
    const existingSub = selectBuilder(null);
    const reusable = selectBuilder(null);
    const checkoutWrite = upsertBuilder();
    h.sb.from
      .mockReturnValueOnce(plans)         // plans
      .mockReturnValueOnce(existingSub)   // subscriptions (customer id)
      .mockReturnValueOnce(reusable)      // subscription_checkouts (retry reuse)
      .mockReturnValueOnce(checkoutWrite); // subscription_checkouts (insert)

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "cust_123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "sub_123",
        plan_id: "plan_growth",
        status: "created",
        // Razorpay always returns these; the route must ignore them.
        short_url: "https://rzp.io/i/sub_123",
        auth_link: "https://api.razorpay.com/v1/l/subscriptions/sub_123",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "growth" },
    });

    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, unknown>;
    expect(body).toMatchObject({
      keyId: "rzp_test_key",
      subscriptionId: "sub_123",
      planId: "growth",
      currency: "INR",
      amount: 4900,
    });
    // No hosted page, no redirect target, no secret.
    expect(JSON.stringify(body)).not.toContain("rzp.io");
    expect(JSON.stringify(body)).not.toContain("/v1/l/");
    expect(JSON.stringify(body)).not.toContain("server-secret");
    expect(body).not.toHaveProperty("url");
    expect(body).not.toHaveProperty("short_url");
    // Cards + eligible digital wallets by default; nothing else is offered.
    expect(body.method).toMatchObject({ card: true, wallet: true, upi: false, netbanking: false });

    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.razorpay.com/v1/subscriptions", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"plan_id":"plan_growth"'),
    }));
    // The pending provider subscription is parked, NOT granted.
    expect(checkoutWrite.upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user_1",
      plan_id: "growth",
      razorpay_subscription_id: "sub_123",
      status: "created",
      currency: "INR",
    }), { onConflict: "razorpay_subscription_id" });
  });

  it("does not grant a paid plan when checkout is merely prepared", async () => {
    setBillingEnv();
    h.sb.from
      .mockReturnValueOnce(selectBuilder({ id: "growth", price_cents: 4900, currency: "INR" }))
      .mockReturnValueOnce(selectBuilder(null))
      .mockReturnValueOnce(selectBuilder(null))
      .mockReturnValueOnce(upsertBuilder());
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "cust_123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "sub_123", plan_id: "plan_growth", status: "created" }), { status: 200 })));

    const { req, res } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "growth" },
    });
    await handler(req, res);

    // `subscriptions` is only ever READ during checkout.
    const tables = h.sb.from.mock.calls.map((call) => call[0]);
    expect(tables).toContain("subscription_checkouts");
    expect(tables.filter((t) => t === "subscriptions")).toHaveLength(1);
  });

  it("rejects a payment confirmation whose signature does not verify", async () => {
    setBillingEnv();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: {
        action: "verify",
        razorpay_payment_id: "pay_1",
        razorpay_subscription_id: "sub_123",
        razorpay_signature: "not-a-real-signature",
      },
    });
    await handler(req, res);

    expect(getStatus()).toBe(400);
    expect(getBody()).toMatchObject({ code: "signature_invalid" });
    // Nothing was read or written, and Razorpay was never called.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.sb.from).not.toHaveBeenCalled();
  });

  it("refuses to apply a verified payment that belongs to another account", async () => {
    setBillingEnv();
    const signature = createHmac("sha256", "server-secret").update("pay_1|sub_123").digest("hex");
    h.sb.from.mockReturnValueOnce(selectBuilder({ user_id: "someone_else", plan_id: "growth" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: {
        action: "verify",
        razorpay_payment_id: "pay_1",
        razorpay_subscription_id: "sub_123",
        razorpay_signature: signature,
      },
    });
    await handler(req, res);

    expect(getStatus()).toBe(403);
    expect(getBody()).toMatchObject({ code: "checkout_mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("activates the plan only after the provider confirms the subscription and payment", async () => {
    setBillingEnv();
    const signature = createHmac("sha256", "server-secret").update("pay_1|sub_123").digest("hex");
    const pending = selectBuilder({
      user_id: "user_1",
      plan_id: "growth",
      razorpay_customer_id: "cust_123",
      razorpay_plan_id: "plan_growth",
      amount_cents: 4900,
    });
    const previousSub = selectBuilder({ id: "local_sub", razorpay_subscription_id: "sub_123" });
    const subWrite = upsertBuilder();
    const savedSub = selectBuilder({ id: "local_sub" });
    const paymentWrite = upsertBuilder();
    const invoiceWrite = upsertBuilder();
    const checkoutUpdate = updateBuilder();
    const workspace = selectBuilder({ id: "ws_1" });
    const activity = { insert: vi.fn().mockResolvedValue({ error: null }) };

    h.sb.from
      .mockReturnValueOnce(pending)        // subscription_checkouts
      .mockReturnValueOnce(previousSub)    // subscriptions (previous)
      .mockReturnValueOnce(subWrite)       // subscriptions upsert
      .mockReturnValueOnce(savedSub)       // subscriptions (id)
      .mockReturnValueOnce(paymentWrite)   // payments
      .mockReturnValueOnce(invoiceWrite)   // invoices
      .mockReturnValueOnce(checkoutUpdate) // subscription_checkouts update
      .mockReturnValueOnce(workspace)      // workspaces
      .mockReturnValueOnce(activity);      // activity_logs

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "sub_123",
        status: "active",
        plan_id: "plan_growth",
        customer_id: "cust_123",
        current_start: 1700000000,
        current_end: 1702592000,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "pay_1",
        status: "captured",
        amount: 4900,
        currency: "INR",
        method: "card",
      }), { status: 200 })));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: {
        action: "verify",
        razorpay_payment_id: "pay_1",
        razorpay_subscription_id: "sub_123",
        razorpay_signature: signature,
      },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ ok: true, planId: "growth", status: "active", entitled: true });
    expect(subWrite.upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user_1",
      plan_id: "growth",
      status: "active",
      currency: "INR",
      razorpay_subscription_id: "sub_123",
      cancel_at_cycle_end: false,
    }), { onConflict: "user_id" });
    expect(paymentWrite.upsert).toHaveBeenCalledWith(expect.objectContaining({
      amount_cents: 4900,
      currency: "INR",
      status: "captured",
    }), { onConflict: "razorpay_payment_id" });
    expect(invoiceWrite.upsert).toHaveBeenCalledWith(expect.objectContaining({
      currency: "INR",
      status: "paid",
      razorpay_invoice_id: "pay_1",
    }), { onConflict: "razorpay_invoice_id" });
  });

  it("does not activate a plan when the payment was not captured", async () => {
    setBillingEnv();
    const signature = createHmac("sha256", "server-secret").update("pay_1|sub_123").digest("hex");
    h.sb.from.mockReturnValueOnce(selectBuilder({ user_id: "user_1", plan_id: "growth" }));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "sub_123", status: "active" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pay_1", status: "failed", amount: 4900, currency: "INR" }), { status: 200 })));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: {
        action: "verify",
        razorpay_payment_id: "pay_1",
        razorpay_subscription_id: "sub_123",
        razorpay_signature: signature,
      },
    });
    await handler(req, res);

    expect(getStatus()).toBe(402);
    expect(getBody()).toMatchObject({ code: "payment_not_captured" });
  });

  it("surfaces missing Razorpay configuration before calling the provider", async () => {
    setBillingEnv();
    delete process.env.RAZORPAY_KEY_ID;
    h.sb.from.mockReturnValue(selectBuilder(null));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "growth" },
    });

    await handler(req, res);
    expect(getStatus()).toBe(500);
    expect(getBody()).toMatchObject({ code: "billing_config" });
    expect(String((getBody() as { error: string }).error)).toContain("RAZORPAY_KEY_ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sync returns ok without calling Razorpay when there is no provider subscription yet", async () => {
    setBillingEnv();
    h.sb.from.mockReturnValueOnce(selectBuilder(null));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "sync" },
    });

    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(getBody()).toEqual({ ok: true, status: "free" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels at cycle end instead of revoking access immediately", async () => {
    setBillingEnv();
    const updateSub = updateBuilder();
    h.sb.from
      .mockReturnValueOnce(selectBuilder({
        id: "local_sub",
        status: "active",
        razorpay_subscription_id: "sub_123",
        current_period_end: "2099-01-01T00:00:00.000Z",
      }))
      .mockReturnValueOnce(updateSub)
      .mockReturnValueOnce(selectBuilder({ id: "ws_1" }))
      .mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "sub_123", status: "active" }), { status: 200 })));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "cancel" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ ok: true, cancelAtCycleEnd: true });
    // The plan is NOT downgraded here — entitlement runs to current_period_end.
    expect(updateSub.update).toHaveBeenCalledWith(expect.objectContaining({ cancel_at_cycle_end: true }));
    expect(updateSub.update).not.toHaveBeenCalledWith(expect.objectContaining({ plan_id: "free" }));
  });

  it("sync refreshes a stored Razorpay subscription", async () => {
    setBillingEnv();
    const updateSub = updateBuilder();
    h.sb.from
      .mockReturnValueOnce(selectBuilder({ id: "local_sub", status: "active", razorpay_subscription_id: "sub_123" }))
      .mockReturnValueOnce(updateSub);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "sub_123",
      status: "paused",
      current_start: 1700000000,
      current_end: 1702592000,
    }), { status: 200 })));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "sync" },
    });

    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(getBody()).toEqual({ ok: true, status: "paused" });
    expect(updateSub.update).toHaveBeenCalledWith(expect.objectContaining({ status: "paused" }));
  });
});
