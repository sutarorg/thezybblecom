import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Behavioural tests for the admin API.
 *
 * The things that must never regress:
 *  1. no bearer token → 401, and nothing is read;
 *  2. a valid customer token whose profile isn't `admin` → 403, and nothing
 *     is read;
 *  3. mutations refuse to run without an explicit confirmation and a reason;
 *  4. every completed mutation writes an admin_audit_logs row with before and
 *     after state;
 *  5. responses never carry a secret, and never carry a raw Postgres error.
 */

const h = vi.hoisted(() => {
  const createClient = vi.fn();
  const rpc = vi.fn();
  const from = vi.fn();
  const getUser = vi.fn();
  const getUserById = vi.fn();
  const updateUserById = vi.fn();
  return { createClient, rpc, from, getUser, getUserById, updateUserById };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));

import handler from "../admin";

type Json = Record<string, unknown>;

function createMockReqRes(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  const req = {
    method: options.method ?? "GET",
    url: options.url ?? "/api/admin",
    headers: options.headers ?? { authorization: "Bearer token" },
    body: options.body,
  } as unknown as IncomingMessage & { body?: unknown };

  let statusCode = 200;
  let responseBody: unknown = null;
  const headers: Record<string, string> = {};

  const res = {
    setHeader(key: string, value: string) {
      headers[key.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      responseBody = body;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as ServerResponse & { status(code: number): any; json(body: unknown): void };

  return { req, res, getStatus: () => statusCode, getBody: () => responseBody as Json, getHeaders: () => headers };
}

/** Rows captured from `.insert()` on admin_audit_logs. */
let auditRows: Json[] = [];
let updates: { table: string; patch: Json }[] = [];

function profileBuilder(role: string | null) {
  const builder: Json = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data: role ? { name: "Ops", role } : null, error: null }),
  };
  return builder;
}

function tableMock(table: string, role: string | null) {
  if (table === "profiles") return profileBuilder(role);
  if (table === "admin_audit_logs") {
    const builder: Json = {
      insert: vi.fn((row: Json) => {
        auditRows.push(row);
        return Promise.resolve({ error: null });
      }),
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    };
    return builder;
  }
  const builder: Json = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gt: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue({ data: [{ id: "free" }], error: null }),
    maybeSingle: vi.fn().mockResolvedValue({
      data:
        table === "plans"
          ? { id: "growth", price_cents: 4900, lead_allowance: 5000, max_lists: -1, max_users: 1, has_ai: true, client_workspaces: false, priority_processing: true, currency: "INR" }
          : table === "workspaces"
            ? { id: "ws_1", name: "Acme" }
            : table === "subscriptions"
              ? { id: "sub_1", user_id: "11111111-1111-4111-8111-111111111111", status: "active", plan_id: "growth", razorpay_subscription_id: "sub_rzp_1" }
              : { leads_used: 10, searches: 2, exports: 1, ai_runs: 0 },
      error: null,
    }),
    update: vi.fn((patch: Json) => {
      updates.push({ table, patch });
      return builder;
    }),
    upsert: vi.fn((patch: Json) => {
      updates.push({ table, patch });
      return Promise.resolve({ error: null });
    }),
  };
  return builder;
}

function asAdmin(role: string | null = "admin") {
  h.from.mockImplementation((table: string) => tableMock(table, role));
}

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const USER_ID = "11111111-1111-4111-8111-111111111111";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_service";
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;

  auditRows = [];
  updates = [];

  h.createClient.mockReset().mockReturnValue({
    auth: { getUser: h.getUser, admin: { getUserById: h.getUserById, updateUserById: h.updateUserById } },
    from: h.from,
    rpc: h.rpc,
  });
  h.getUser.mockReset().mockResolvedValue({
    data: { user: { id: ADMIN_ID, email: "ops@zybble.com" } },
    error: null,
  });
  h.getUserById.mockReset().mockResolvedValue({ data: { user: { id: USER_ID, email: "c@x.com", banned_until: null } }, error: null });
  h.updateUserById.mockReset().mockResolvedValue({ data: { user: { id: USER_ID, banned_until: "2125-01-01T00:00:00Z" } }, error: null });
  h.rpc.mockReset().mockResolvedValue({ data: { total: 0, rows: [] }, error: null });
  h.from.mockReset();
  asAdmin();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe("authorization", () => {
  it("rejects a request with no bearer token and never queries data", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ url: "/api/admin?path=overview", headers: {} });
    await handler(req, res);
    expect(getStatus()).toBe(401);
    expect(String(getBody().error)).toMatch(/sign in/i);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid session", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    const { req, res, getStatus, getBody } = createMockReqRes({ url: "/api/admin?path=overview" });
    await handler(req, res);
    expect(getStatus()).toBe(401);
    expect(getBody().code).toBe("auth_invalid");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("says the auth service is unreachable instead of blaming the session", async () => {
    h.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthRetryableFetchError", message: "fetch failed", status: 0 },
    });
    const { req, res, getStatus, getBody } = createMockReqRes({ url: "/api/admin?path=me" });
    await handler(req, res);
    expect(getStatus()).toBe(503);
    expect(getBody().code).toBe("auth_unreachable");
  });

  it("rejects a signed-in customer whose profile role is not admin", async () => {
    asAdmin("user");
    const { req, res, getStatus, getBody } = createMockReqRes({ url: "/api/admin?path=users" });
    await handler(req, res);
    expect(getStatus()).toBe(403);
    expect(getBody().code).toBe("forbidden");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("re-reads the role from the database on every request", async () => {
    const { req, res } = createMockReqRes({ url: "/api/admin?path=me" });
    await handler(req, res);
    expect(h.from).toHaveBeenCalledWith("profiles");
  });

  it("answers GET me for an administrator without leaking secrets", async () => {
    const { req, res, getStatus, getBody, getHeaders } = createMockReqRes({ url: "/api/admin?path=me" });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(getBody().role).toBe("admin");
    expect(getHeaders()["cache-control"]).toContain("no-store");
    expect(JSON.stringify(getBody())).not.toContain("sb_secret_service");
  });

  it("refuses verbs it does not implement", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ method: "DELETE", url: "/api/admin?path=users/1" });
    await handler(req, res);
    expect(getStatus()).toBe(405);
    expect(getBody().code).toBe("method_not_allowed");
  });

  it("404s an unknown admin section", async () => {
    const { req, res, getStatus } = createMockReqRes({ url: "/api/admin?path=not-a-section" });
    await handler(req, res);
    expect(getStatus()).toBe(404);
  });
});

describe("routing", () => {
  it("reads nested paths from the rewrite query parameter", async () => {
    h.rpc.mockResolvedValue({ data: { profile: { id: USER_ID } }, error: null });
    const { req, res, getStatus } = createMockReqRes({ url: `/api/admin?path=users/${USER_ID}` });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("admin_user_detail", { p_user: USER_ID });
  });

  it("also works when called with the real pathname (local dev)", async () => {
    const { req, res, getStatus } = createMockReqRes({ url: "/api/admin/users?page=2&pageSize=25" });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("admin_user_directory", expect.objectContaining({ p_offset: 25, p_limit: 25 }));
  });

  it("rejects a malformed id instead of passing it to Postgres", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ url: "/api/admin?path=users/not-a-uuid" });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody().code).toBe("invalid_id");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("never returns a raw Postgres error", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "42P01", message: 'relation "secret" does not exist' } });
    const { req, res, getStatus, getBody } = createMockReqRes({ url: "/api/admin?path=overview" });
    await handler(req, res);
    expect(getStatus()).toBe(500);
    expect(String(getBody().error)).not.toMatch(/relation|42P01/);
  });
});

describe("mutations", () => {
  it("requires a reason", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      url: `/api/admin?path=users/${USER_ID}/role`,
      body: { role: "admin", confirm: true },
    });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody().code).toBe("reason_required");
    expect(auditRows).toHaveLength(0);
  });

  it("requires an explicit confirmation", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      url: `/api/admin?path=users/${USER_ID}/role`,
      body: { role: "admin", reason: "ticket 42 — new ops hire" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody().code).toBe("confirmation_required");
  });

  it("grants a role through the guarded function and writes an audit row", async () => {
    h.rpc.mockResolvedValue({ data: { before: "user", after: "admin", email: "c@x.com" }, error: null });
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      url: `/api/admin?path=users/${USER_ID}/role`,
      body: { role: "admin", reason: "ticket 42 — new ops hire", confirm: true },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(getBody().role).toBe("admin");
    expect(h.rpc).toHaveBeenCalledWith("admin_grant_role", { p_user: USER_ID, p_role: "admin" });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "user.role.grant",
      target_type: "user",
      target_id: USER_ID,
      admin_user_id: ADMIN_ID,
      result: "success",
    });
    expect(auditRows[0].before_state).toEqual({ role: "user" });
    expect(auditRows[0].after_state).toEqual({ role: "admin" });
  });

  it("will not let an administrator remove their own access", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      url: `/api/admin?path=users/${ADMIN_ID}/role`,
      body: { role: "user", reason: "cleaning up my own account", confirm: true },
    });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody().code).toBe("self_demotion");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("suspends through Supabase Auth, not an invented profile column", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      url: `/api/admin?path=users/${USER_ID}/suspend`,
      body: { suspend: true, reason: "chargeback fraud, ticket 77", confirm: true },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(getBody().suspended).toBe(true);
    expect(h.updateUserById).toHaveBeenCalledWith(USER_ID, { ban_duration: "876000h" });
    expect(auditRows[0]).toMatchObject({ action: "user.suspend", result: "success" });
  });

  it("writes the quota override to usage_counters and audits before/after", async () => {
    const { req, res, getStatus } = createMockReqRes({
      method: "POST",
      url: "/api/admin?path=usage/override",
      body: {
        workspaceId: "22222222-2222-4222-8222-222222222222",
        leadsUsed: 0,
        period: "2026-10-01",
        reason: "goodwill reset after failed search, ticket 91",
        confirm: true,
      },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    const write = updates.find((entry) => entry.table === "usage_counters");
    expect(write?.patch).toMatchObject({ leads_used: 0, period_start: "2026-10-01" });
    expect(auditRows[0]).toMatchObject({ action: "usage.override", target_type: "usage" });
    expect(auditRows[0].before_state).toEqual({ period_start: "2026-10-01", leads_used: 10 });
    expect(auditRows[0].after_state).toEqual({ period_start: "2026-10-01", leads_used: 0 });
  });

  it("only accepts PATCH for a plan change", async () => {
    const { req, res, getStatus } = createMockReqRes({
      method: "POST",
      url: "/api/admin?path=plans/growth",
      body: { lead_allowance: 10, reason: "testing the method guard", confirm: true },
    });
    await handler(req, res);
    expect(getStatus()).toBe(405);
  });

  it("blocks a plan downgrade that would strand workspaces already over the new limit", async () => {
    h.from.mockImplementation((table: string) => {
      if (table === "usage_counters") {
        const builder: Record<string, unknown> = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          gt: vi.fn().mockResolvedValue({ data: [{ leads_used: 4000 }, { leads_used: 9000 }], error: null }),
        };
        return builder;
      }
      return tableMock(table, "admin");
    });

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "PATCH",
      url: "/api/admin?path=plans/growth",
      body: { lead_allowance: 100, reason: "pricing experiment for Q4", confirm: true },
    });
    await handler(req, res);
    expect(getStatus()).toBe(409);
    expect(getBody().code).toBe("plan_change_blocked");
    expect(updates.find((entry) => entry.table === "plans")).toBeUndefined();
  });

  it("refuses to reconcile when Razorpay isn't configured, and records the failure", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      url: "/api/admin?path=billing/sync",
      body: { userId: USER_ID, reason: "customer says the card was charged" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(500);
    expect(getBody().code).toBe("billing_config");
    expect(String(getBody().error)).not.toMatch(/sb_secret|KEY_SECRET=/);
    expect(auditRows[0]).toMatchObject({ action: "subscription.sync", result: "failure" });
  });
});
