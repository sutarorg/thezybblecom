import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const h = vi.hoisted(() => {
  const createClient = vi.fn();
  const sb = {
    from: vi.fn(),
  };
  return { createClient, sb };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: h.createClient,
}));

import { POST } from "../paddle-webhook";

const SECRET = "pdl_ntfset_test_webhook_secret";

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

function insertBuilder(error: unknown = null) {
  return { insert: vi.fn().mockResolvedValue({ error }) };
}

function upsertBuilder(error: unknown = null) {
  return { upsert: vi.fn().mockResolvedValue({ error }) };
}

function updateBuilder(error: unknown = null) {
  // Fully chainable: the handler awaits `.update().eq().eq()` chains.
  const builder: Record<string, unknown> = {
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: vi.fn((resolve: (v: unknown) => unknown) => resolve({ data: null, error })),
  };
  return builder as unknown as { update: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> };
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
] as const;

const savedEnv = new Map<string, string | undefined>();

function setEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_service";
  process.env.PADDLE_WEBHOOK_SECRET = SECRET;
  process.env.PADDLE_API_KEY = "pdl_srbx_test_server_key";
  process.env.PADDLE_PRICE_GROWTH_ID = "pri_growth_1";
  process.env.PADDLE_PRICE_AGENCY_ID = "pri_agency_1";
  process.env.PADDLE_PRICE_SCALE_ID = "pri_scale_1";
}

function signedRequest(rawBody: string, options: { secret?: string; timestamp?: number } = {}) {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const secret = options.secret ?? SECRET;
  const digest = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex");
  return new Request("http://localhost/api/paddle-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Paddle-Signature": `ts=${timestamp};h1=${digest}` },
    body: rawBody,
  });
}

async function read(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  for (const key of ENV_KEYS) delete process.env[key];
  h.createClient.mockReset().mockReturnValue(h.sb);
  h.sb.from.mockReset();
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

function subscriptionCreatedEvent(subscriptionId = "sub_123", priceId = "pri_growth_1") {
  return JSON.stringify({
    event_id: `evt_${subscriptionId}`,
    event_type: "subscription.created",
    occurred_at: "2026-01-05T12:00:00Z",
    data: {
      id: subscriptionId,
      status: "active",
      customer_id: "ctm_1",
      currency_code: "USD",
      current_billing_period: { starts_at: "2026-01-05T12:00:00Z", ends_at: "2026-02-05T12:00:00Z" },
      next_billed_at: "2026-02-05T12:00:00Z",
      items: [{ price: { id: priceId } }],
      custom_data: { zybble_token: "tok_123" },
    },
  });
}

describe("/api/paddle-webhook — the security boundary", () => {
  it("rejects an unsigned request with 401 and records nothing", async () => {
    setEnv();
    const request = new Request("http://localhost/api/paddle-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: subscriptionCreatedEvent(),
    });

    const res = await POST(request);
    expect(res.status).toBe(401);
    expect(await read(res)).toMatchObject({ code: "signature_invalid" });
    expect(h.sb.from).not.toHaveBeenCalled();
  });

  it("rejects a tampered body even when the signature was valid for other bytes", async () => {
    setEnv();
    const original = subscriptionCreatedEvent();
    const tampered = original.replace("pri_growth_1", "pri_scale_1");
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHmac("sha256", SECRET).update(`${timestamp}:${original}`).digest("hex");
    const request = new Request("http://localhost/api/paddle-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Paddle-Signature": `ts=${timestamp};h1=${digest}` },
      body: tampered,
    });
    const res = await POST(request);
    expect(res.status).toBe(401);
    expect(h.sb.from).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp (replay window)", async () => {
    setEnv();
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const res = await POST(signedRequest(subscriptionCreatedEvent(), { timestamp: stale }));
    expect(res.status).toBe(401);
    expect(h.sb.from).not.toHaveBeenCalled();
  });

  it("fails closed when the webhook secret isn't configured", async () => {
    setEnv();
    delete process.env.PADDLE_WEBHOOK_SECRET;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(signedRequest(subscriptionCreatedEvent()));
    expect(res.status).toBe(500);
    expect(await read(res)).toMatchObject({ code: "webhook_config" });
    expect(h.sb.from).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON after a valid signature with 400", async () => {
    setEnv();
    const res = await POST(signedRequest("not json at all"));
    expect(res.status).toBe(400);
    expect(await read(res)).toMatchObject({ code: "invalid_json" });
  });
});

describe("/api/paddle-webhook — idempotency", () => {
  it("returns 200 for a duplicate event delivery without applying anything twice", async () => {
    setEnv();
    const raw = subscriptionCreatedEvent();
    const duplicateError = Object.assign(new Error("duplicate key value violates unique constraint"), { message: "duplicate key value violates unique constraint" });
    h.sb.from.mockReturnValueOnce(insertBuilder(duplicateError)); // webhook_events insert

    const res = await POST(signedRequest(raw));
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ ok: true, deduplicated: true });

    // Only the webhook_events insert ran — no subscription application.
    expect(h.sb.from).toHaveBeenCalledTimes(1);
    const tables = h.sb.from.mock.calls.map((call) => call[0]);
    expect(tables).toEqual(["webhook_events"]);
  });
});

describe("/api/paddle-webhook — subscription lifecycle", () => {
  it("applies subscription.created from a paid price id and resolves the user via the checkout token", async () => {
    setEnv();
    h.sb.from
      .mockReturnValueOnce(insertBuilder()) // webhook_events insert
      .mockReturnValueOnce(selectBuilder({ user_id: "user_1", plan_id: "growth" })) // checkout token → owner
      .mockReturnValueOnce(selectBuilder(null)) // duplicate-guard read
      .mockReturnValueOnce(upsertBuilder()) // subscriptions upsert
      .mockReturnValueOnce(updateBuilder()) // subscription_checkouts update
      .mockReturnValueOnce(selectBuilder({ plan_id: "growth", status: "active" })) // activity read
      .mockReturnValueOnce(selectBuilder({ id: "ws_1" })) // workspaces
      .mockReturnValueOnce(insertBuilder()) // activity_logs
      .mockReturnValueOnce(updateBuilder()); // webhook_events processed

    const res = await POST(signedRequest(subscriptionCreatedEvent()));
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ ok: true });

    const subUpsert = h.sb.from.mock.calls.find((c) => c[0] === "subscriptions");
    expect(subUpsert).toBeTruthy();
    // The intent is marked completed — never re-granted on a retry.
    const checkoutUpdate = h.sb.from.mock.calls.filter((c) => c[0] === "subscription_checkouts");
    expect(checkoutUpdate.length).toBeGreaterThan(0);
  });

  it("records unknown-user events as processed no-ops (no crash, no grant)", async () => {
    setEnv();
    h.sb.from
      .mockReturnValueOnce(insertBuilder()) // webhook_events insert
      .mockReturnValueOnce(selectBuilder(null)) // token lookup: unknown
      .mockReturnValueOnce(selectBuilder(null)) // sub id lookup: unknown
      .mockReturnValueOnce(updateBuilder()); // webhook_events processed

    const res = await POST(signedRequest(subscriptionCreatedEvent("sub_unknown")));
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ ok: true });
    const tables = h.sb.from.mock.calls.map((call) => call[0]);
    expect(tables).not.toContain("payments");
  });
});

describe("/api/paddle-webhook — transaction lifecycle", () => {
  function transactionEvent(eventType: "transaction.completed" | "transaction.payment_failed" | "transaction.canceled", txnId = "txn_1") {
    return JSON.stringify({
      event_id: `evt_${txnId}_${eventType}`,
      event_type: eventType,
      occurred_at: "2026-01-05T12:00:00Z",
      data: {
        id: txnId,
        subscription_id: "sub_123",
        status: eventType === "transaction.payment_failed" ? "past_due" : "completed",
        currency_code: "USD",
        totals: { total: "4900" },
        invoice_id: "in_1",
        invoice_number: "1001-2002",
        billing_period: { starts_at: "2026-01-05T12:00:00Z", ends_at: "2026-02-05T12:00:00Z" },
        payments: [{ method_details: { type: "card" } }],
        custom_data: { zybble_token: "tok_123" },
      },
    });
  }

  it("transaction.completed records the payment and invoice idempotently", async () => {
    setEnv();
    h.sb.from
      .mockReturnValueOnce(insertBuilder()) // webhook_events insert
      .mockReturnValueOnce(selectBuilder({ user_id: "user_1", plan_id: "growth" })) // token → owner
      .mockReturnValueOnce(selectBuilder({ id: "local_sub", provider_subscription_id: "sub_123" })) // recordPaddleTransaction sub read
      .mockReturnValueOnce(upsertBuilder()) // payments upsert
      .mockReturnValueOnce(upsertBuilder()) // invoices upsert
      .mockReturnValueOnce(selectBuilder({ provider_subscription_id: "sub_123" })) // already-applied check
      .mockReturnValueOnce(updateBuilder()); // webhook_events processed

    const res = await POST(signedRequest(transactionEvent("transaction.completed")));
    expect(res.status).toBe(200);

    const paymentsCall = h.sb.from.mock.calls.find((c) => c[0] === "payments");
    const invoicesCall = h.sb.from.mock.calls.find((c) => c[0] === "invoices");
    expect(paymentsCall).toBeTruthy();
    expect(invoicesCall).toBeTruthy();
  });

  it("transaction.payment_failed marks the subscription past_due", async () => {
    setEnv();
    h.sb.from
      .mockReturnValueOnce(insertBuilder()) // webhook_events insert
      .mockReturnValueOnce(selectBuilder({ user_id: "user_1", plan_id: "growth" })) // token → owner
      .mockReturnValueOnce(selectBuilder(null)) // sub read in record
      .mockReturnValueOnce(upsertBuilder()) // payments upsert (failed)
      .mockReturnValueOnce(selectBuilder({ id: "local_sub", status: "active" })) // sub read for past_due
      .mockReturnValueOnce(updateBuilder()) // subscriptions update past_due
      .mockReturnValueOnce(updateBuilder()); // webhook_events processed

    const res = await POST(signedRequest(transactionEvent("transaction.payment_failed")));
    expect(res.status).toBe(200);

    const subUpdate = h.sb.from.mock.calls.filter((c) => c[0] === "subscriptions");
    expect(subUpdate.length).toBeGreaterThan(0);
  });

  it("transaction.canceled marks the checkout intent canceled without any payment", async () => {
    setEnv();
    h.sb.from
      .mockReturnValueOnce(insertBuilder()) // webhook_events insert
      .mockReturnValueOnce(selectBuilder({ user_id: "user_1", plan_id: "growth" })) // token → owner
      .mockReturnValueOnce(updateBuilder()) // subscription_checkouts canceled
      .mockReturnValueOnce(updateBuilder()); // webhook_events processed

    const res = await POST(signedRequest(transactionEvent("transaction.canceled")));
    expect(res.status).toBe(200);
    const tables = h.sb.from.mock.calls.map((call) => call[0]);
    expect(tables).not.toContain("payments");
    expect(tables).not.toContain("invoices");
  });
});

describe("/api/paddle-webhook — unrelated events", () => {
  it("records but does not apply events outside the billing lifecycle", async () => {
    setEnv();
    const raw = JSON.stringify({
      event_id: "evt_customer",
      event_type: "customer.updated",
      occurred_at: "2026-01-05T12:00:00Z",
      data: { id: "ctm_1" },
    });
    h.sb.from
      .mockReturnValueOnce(insertBuilder()) // webhook_events insert
      .mockReturnValueOnce(updateBuilder()); // webhook_events processed

    const res = await POST(signedRequest(raw));
    expect(res.status).toBe(200);
    const tables = h.sb.from.mock.calls.map((call) => call[0]);
    expect(tables).toEqual(["webhook_events", "webhook_events"]);
  });
});
