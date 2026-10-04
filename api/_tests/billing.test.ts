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

  it("creates a Razorpay checkout subscription and persists the provider ids", async () => {
    setBillingEnv();
    const existingSub = selectBuilder(null);
    const writeSub = upsertBuilder();
    h.sb.from
      .mockReturnValueOnce(existingSub)
      .mockReturnValueOnce(writeSub);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "cust_123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "sub_123",
        plan_id: "plan_growth",
        status: "created",
        short_url: "https://rzp.io/i/sub_123",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { action: "checkout", plan: "growth" },
    });

    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toEqual({ url: "https://rzp.io/i/sub_123", subscriptionId: "sub_123" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://api.razorpay.com/v1/customers", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic\s+/) }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.razorpay.com/v1/subscriptions", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"plan_id":"plan_growth"'),
    }));
    expect(writeSub.upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user_1",
      plan_id: "growth",
      status: "active",
      razorpay_customer_id: "cust_123",
      razorpay_subscription_id: "sub_123",
      razorpay_plan_id: "plan_growth",
    }), { onConflict: "user_id" });
  });

  it("surfaces missing Razorpay configuration before calling the provider", async () => {
    setBillingEnv();
    delete process.env.RAZORPAY_KEY_ID;
    h.sb.from.mockReturnValueOnce(selectBuilder(null));
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
    expect(getBody()).toEqual({ ok: true, status: "active" });
    expect(fetchMock).not.toHaveBeenCalled();
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
