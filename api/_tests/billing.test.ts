import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  return builder;
}

function upsertBuilder(error: unknown = null) {
  return { upsert: vi.fn().mockResolvedValue({ error }) };
}

function insertBuilder(error: unknown = null) {
  return { insert: vi.fn().mockResolvedValue({ error }) };
}

function updateBuilder(error: unknown = null) {
  const builder = {
    update: vi.fn(() => builder),
    eq: vi.fn().mockResolvedValue({ error }),
    then: vi.fn().mockResolvedValue(undefined),
  };
  return builder;
}

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SECRET_KEYS",
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_ENVIRONMENT",
  "PADDLE_PRICE_GROWTH_ID",
  "PADDLE_PRICE_AGENCY_ID",
  "PADDLE_PRICE_SCALE_ID",
  "APP_URL",
] as const;

const savedEnv = new Map<string, string | undefined>();

function setBillingEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_service";
  process.env.PADDLE_API_KEY = "pdl_srbx_test_server_key";
  process.env.PADDLE_PRICE_GROWTH_ID = "pri_growth_1";
  process.env.PADDLE_PRICE_AGENCY_ID = "pri_agency_1";
  process.env.PADDLE_PRICE_SCALE_ID = "pri_scale_1";
  process.env.APP_URL = "https://zybble.com";
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  for (const key of ENV_KEYS) delete process.env[key];
  h.createClient.mockReset().mockReturnValue(h.sb);
  h.sb.auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: "user_1", email: "founder@zybble.com" } }, error: null });
  h.sb.from.mockReset();
  // A fetch spy is always installed so `expect(fetch).not.toHaveBeenCalled()`
  // works in tests that expect no provider traffic at all.
  vi.stubGlobal("fetch", vi.fn());
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

function paddleResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status });
}

describe("/api/billing — checkout (first paid subscription)", () => {
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

  it("returns only browser-safe checkout data: public price id, token, amount, environment", async () => {
    setBillingEnv();
    h.sb.from
      .mockReturnValueOnce(selectBuilder({ id: "growth", price_cents: 4900, currency: "USD" })) // plans
      .mockReturnValueOnce(selectBuilder(null)) // subscriptions (ladder check)
      .mockReturnValueOnce(selectBuilder(null)) // subscription_checkouts (reuse check)
      .mockReturnValueOnce(insertBuilder());    // subscription_checkouts (insert)

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "growth" },
    });

    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, unknown>;
    expect(body).toMatchObject({
      priceId: "pri_growth_1",
      planId: "growth",
      planLabel: "Growth",
      amount: 4900,
      currency: "USD",
      customerEmail: "founder@zybble.com",
      environment: "production",
    });
    expect(typeof body.checkoutToken).toBe("string");
    expect((body.checkoutToken as string).length).toBeGreaterThanOrEqual(32);

    // No server credential, no hosted URL, no provider secret is ever returned.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("pdl_srbx_test_server_key");
    expect(serialized).not.toContain("api.paddle.com");
    expect(body).not.toHaveProperty("apiKey");
    expect(body).not.toHaveProperty("url");

    // No Paddle API call is needed to prepare a checkout — Paddle.js opens the
    // overlay client-side; the subscription is created by PAID checkout only.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("parks the intent as pending and never grants a plan during checkout preparation", async () => {
    setBillingEnv();
    const checkoutWrite = insertBuilder();
    h.sb.from
      .mockReturnValueOnce(selectBuilder({ id: "growth", price_cents: 4900, currency: "USD" }))
      .mockReturnValueOnce(selectBuilder(null))
      .mockReturnValueOnce(selectBuilder(null))
      .mockReturnValueOnce(checkoutWrite);

    const { req, res } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "growth" },
    });
    await handler(req, res);

    const tables = h.sb.from.mock.calls.map((call) => call[0]);
    expect(tables).toContain("subscription_checkouts");
    // `subscriptions` is only ever READ during checkout — no entitlement write.
    expect(tables.filter((t) => t === "subscriptions")).toHaveLength(1);
    expect(checkoutWrite.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user_1",
      plan_id: "growth",
      billing_provider: "paddle",
      status: "pending",
      provider_price_id: "pri_growth_1",
      amount_cents: 4900,
      currency: "USD",
    }));
  });

  it("refuses a checkout for anyone but the immediate next plan on the ladder", async () => {
    setBillingEnv();
    // Free user trying to buy Agency directly.
    h.sb.from
      .mockReturnValueOnce(selectBuilder({ id: "agency", price_cents: 9900, currency: "USD" }))
      .mockReturnValueOnce(selectBuilder({ plan_id: "free", status: null, current_period_end: null }));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "agency" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody()).toMatchObject({ code: "plan_not_next" });
  });

  it("refuses a checkout while an active Paddle subscription exists (upgrade instead)", async () => {
    setBillingEnv();
    h.sb.from
      .mockReturnValueOnce(selectBuilder({ id: "agency", price_cents: 9900, currency: "USD" }))
      .mockReturnValueOnce(selectBuilder({
        plan_id: "growth",
        status: "active",
        billing_provider: "paddle",
        provider_subscription_id: "sub_123",
        current_period_end: "2099-01-01T00:00:00Z",
      }));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "agency" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(409);
    expect(getBody()).toMatchObject({ code: "upgrade_required" });
  });

  it("blocks checkout for a legacy Razorpay subscriber until their paid period ends", async () => {
    setBillingEnv();
    h.sb.from
      .mockReturnValueOnce(selectBuilder({ id: "growth", price_cents: 4900, currency: "USD" }))
      .mockReturnValueOnce(selectBuilder({
        plan_id: "growth",
        status: "active",
        billing_provider: "razorpay",
        provider_subscription_id: null,
        current_period_end: "2099-01-01T00:00:00Z",
      }));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "growth" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(409);
    expect(getBody()).toMatchObject({ code: "legacy_provider_active" });
    // No Razorpay API call is ever made.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces missing Paddle configuration before anything is written", async () => {
    setBillingEnv();
    delete process.env.PADDLE_API_KEY;
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "growth" },
    });

    await handler(req, res);
    expect(getStatus()).toBe(500);
    expect(getBody()).toMatchObject({ code: "billing_config" });
    expect(String((getBody() as { error: string }).error)).toContain("PADDLE_API_KEY");
  });

  it("flags a plan whose Paddle price id is not configured", async () => {
    setBillingEnv();
    delete process.env.PADDLE_PRICE_GROWTH_ID;
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "growth" },
    });

    await handler(req, res);
    expect(getStatus()).toBe(500);
    expect(getBody()).toMatchObject({ code: "billing_config" });
    expect(String((getBody() as { error: string }).error)).toContain("PADDLE_PRICE_GROWTH_ID");
  });
});

describe("/api/billing — upgrade (existing Paddle subscription)", () => {
  it("PATCHes the existing subscription with prorated-immediate + prevent_change and stores the result", async () => {
    setBillingEnv();
    h.sb.from
      .mockReturnValueOnce(selectBuilder({
        id: "local_sub",
        plan_id: "growth",
        status: "active",
        billing_provider: "paddle",
        provider_subscription_id: "sub_123",
        provider_price_id: "pri_growth_1",
        current_period_end: "2099-01-01T00:00:00Z",
      })) // subscriptions read
      .mockReturnValueOnce(selectBuilder({ id: "local_sub", plan_id: "growth", status: "active", provider_subscription_id: "sub_123", current_period_end: null })) // duplicate guard read
      .mockReturnValueOnce(upsertBuilder()) // subscriptions upsert
      .mockReturnValueOnce(updateBuilder()) // subscription_checkouts update
      .mockReturnValueOnce(selectBuilder({ id: "ws_1" })) // workspaces
      .mockReturnValueOnce(insertBuilder()); // activity_logs

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(paddleResponse({ // GET subscription before change
        id: "sub_123",
        status: "active",
        customer_id: "ctm_1",
        currency_code: "USD",
        current_billing_period: { starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" },
        next_billed_at: "2026-02-01T00:00:00Z",
        items: [{ price: { id: "pri_growth_1" } }],
      }))
      .mockResolvedValueOnce(paddleResponse({ // PATCH subscription
        id: "sub_123",
        status: "active",
        customer_id: "ctm_1",
        currency_code: "USD",
        current_billing_period: { starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" },
        next_billed_at: "2026-02-01T00:00:00Z",
        items: [{ price: { id: "pri_agency_1" } }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "upgrade", plan: "agency" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ ok: true, planId: "agency", status: "active" });

    // The plan change is a PATCH of the EXISTING subscription with the exact
    // failure-safe proration contract — never a second subscription.
    const patchCall = fetchMock.mock.calls[1];
    expect(patchCall[0]).toBe("https://api.paddle.com/subscriptions/sub_123");
    expect(patchCall[1].method).toBe("PATCH");
    const patchBody = JSON.parse(patchCall[1].body as string);
    expect(patchBody).toEqual({
      items: [{ price_id: "pri_agency_1", quantity: 1 }],
      proration_billing_mode: "prorated_immediately",
      on_payment_failure: "prevent_change",
      scheduled_change: null,
    });
    // Server API key rides the Authorization header only.
    expect(patchCall[1].headers.Authorization).toBe("Bearer pdl_srbx_test_server_key");
  });

  it("refuses an upgrade that is not the immediate next plan", async () => {
    setBillingEnv();
    h.sb.from.mockReturnValueOnce(selectBuilder({
      plan_id: "growth",
      status: "active",
      billing_provider: "paddle",
      provider_subscription_id: "sub_123",
      current_period_end: "2099-01-01T00:00:00Z",
    }));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "upgrade", plan: "scale" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody()).toMatchObject({ code: "plan_not_next" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an upgrade with no existing Paddle subscription", async () => {
    setBillingEnv();
    h.sb.from.mockReturnValueOnce(selectBuilder(null));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "upgrade", plan: "agency" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(404);
    expect(getBody()).toMatchObject({ code: "subscription_missing" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores nothing when the provider refuses the change (failure-safe)", async () => {
    setBillingEnv();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.sb.from.mockReturnValueOnce(selectBuilder({
      plan_id: "growth",
      status: "active",
      billing_provider: "paddle",
      provider_subscription_id: "sub_123",
      provider_price_id: "pri_growth_1",
      current_period_end: "2099-01-01T00:00:00Z",
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(paddleResponse({ id: "sub_123", status: "active", items: [{ price: { id: "pri_growth_1" } }] }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { detail: [{ hint: "payment failed" }] } }), { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "upgrade", plan: "agency" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(502);
    expect(getBody()).toMatchObject({ code: "provider_invalid" });
    // Only the ladder/read queries ran — no subscription write happened.
    const tables = h.sb.from.mock.calls.map((call) => call[0]);
    expect(tables.filter((t) => t === "subscriptions")).toHaveLength(1);
  });
});

describe("/api/billing — sync (server-side verification)", () => {
  it("without a provider subscription and no transaction hint it is a no-op", async () => {
    setBillingEnv();
    h.sb.from.mockReturnValueOnce(selectBuilder(null));
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "sync" },
    });

    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(getBody()).toEqual({ ok: true, status: "free" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("applies a browser-reported transaction ONLY after re-reading it from Paddle", async () => {
    setBillingEnv();
    h.sb.from
      .mockReturnValueOnce(selectBuilder(null)) // subscriptions (no sub yet)
      .mockReturnValueOnce(selectBuilder({ user_id: "user_1", plan_id: "growth" })) // checkout token lookup
      .mockReturnValueOnce(selectBuilder(null)) // subscription id lookup inside recordPaddleTransaction
      .mockReturnValueOnce({ upsert: vi.fn().mockResolvedValue({ error: null }) }) // payments
      .mockReturnValueOnce({ upsert: vi.fn().mockResolvedValue({ error: null }) }) // invoices
      .mockReturnValueOnce(selectBuilder(null)) // duplicate-guard read
      .mockReturnValueOnce(upsertBuilder()) // subscriptions upsert
      .mockReturnValueOnce(updateBuilder()); // subscription_checkouts update

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(paddleResponse({ // GET transaction
        id: "txn_1",
        subscription_id: "sub_123",
        status: "paid",
        currency_code: "USD",
        totals: { total: "4900" },
        custom_data: { zybble_token: "tok_123" },
      }))
      .mockResolvedValueOnce(paddleResponse({ // GET subscription
        id: "sub_123",
        status: "active",
        customer_id: "ctm_1",
        currency_code: "USD",
        current_billing_period: { starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" },
        next_billed_at: "2026-02-01T00:00:00Z",
        items: [{ price: { id: "pri_growth_1" } }],
        custom_data: { zybble_token: "tok_123" },
      })));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "sync", transactionId: "txn_1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ ok: true, planId: "growth", status: "active", entitled: true });
    // The transaction was re-read from the provider, not trusted from the browser.
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls).toContain("https://api.paddle.com/transactions/txn_1");
    expect(calls).toContain("https://api.paddle.com/subscriptions/sub_123");
  });

  it("refuses a transaction whose checkout intent belongs to someone else", async () => {
    setBillingEnv();
    h.sb.from
      .mockReturnValueOnce(selectBuilder(null))
      .mockReturnValueOnce(selectBuilder({ user_id: "someone_else", plan_id: "growth" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(paddleResponse({
      id: "txn_1",
      status: "paid",
      subscription_id: "sub_123",
      custom_data: { zybble_token: "tok_123" },
    })));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "sync", transactionId: "txn_1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(403);
    expect(getBody()).toMatchObject({ code: "checkout_mismatch" });
  });

  it("does not grant a plan for an unpaid transaction", async () => {
    setBillingEnv();
    h.sb.from.mockReturnValueOnce(selectBuilder(null));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(paddleResponse({ id: "txn_1", status: "draft" })));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "sync", transactionId: "txn_1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ ok: true, status: "processing" });
  });
});

describe("/api/billing — cancel (period end)", () => {
  it("cancels at period end and keeps the plan until then", async () => {
    setBillingEnv();
    const updateSub = updateBuilder();
    h.sb.from
      .mockReturnValueOnce(selectBuilder({
        id: "local_sub",
        plan_id: "growth",
        status: "active",
        billing_provider: "paddle",
        provider_subscription_id: "sub_123",
        current_period_end: "2099-01-01T00:00:00.000Z",
      }))
      .mockReturnValueOnce(updateSub)
      .mockReturnValueOnce(selectBuilder({ id: "ws_1" }))
      .mockReturnValueOnce(insertBuilder());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(paddleResponse({
      id: "sub_123",
      status: "active",
      scheduled_change: { action: "cancel", effective_at: "2099-01-01T00:00:00Z" },
    })));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "cancel" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ ok: true, cancelAtCycleEnd: true, accessUntil: "2099-01-01T00:00:00.000Z" });

    const cancelCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(cancelCall[0]).toBe("https://api.paddle.com/subscriptions/sub_123/cancel");
    expect(cancelCall[1].method).toBe("POST");
    expect(JSON.parse(cancelCall[1].body as string)).toEqual({ effective_from: "next_billing_period" });

    // The plan is NOT downgraded here — entitlement runs to current_period_end.
    expect(updateSub.update).toHaveBeenCalledWith(expect.objectContaining({ cancel_at_cycle_end: true }));
    expect(updateSub.update).not.toHaveBeenCalledWith(expect.objectContaining({ plan_id: "free" }));
  });

  it("refuses to cancel when there is no Paddle subscription", async () => {
    setBillingEnv();
    h.sb.from.mockReturnValueOnce(selectBuilder(null));
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "cancel" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(404);
    expect(getBody()).toMatchObject({ code: "subscription_missing" });
  });
});
