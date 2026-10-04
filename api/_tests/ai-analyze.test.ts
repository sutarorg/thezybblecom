import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler from "../ai-analyze.js";
import { getOpenRouterModel } from "../_lib/openrouter.js";
import { resetRateLimits } from "../_lib/rate-limit.js";

/** Minimal Vercel-shaped req/res pair (same pattern as the sibling suites). */
function createMockReqRes(options: { method?: string; headers?: Record<string, string>; body?: unknown }) {
  const req = {
    method: options.method ?? "POST",
    headers: options.headers ?? {},
    body: options.body,
  } as unknown as IncomingMessage & { body?: unknown };

  let statusCode = 0;
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

/**
 * Contract tests for POST /api/ai-analyze. The route authorizes the caller,
 * reads the lead with the caller's RLS-scoped token, serves cached insights
 * when fresh, and otherwise analyzes the record through DeepSeek V3.2 via
 * OpenRouter's server-side API (OPENROUTER_API_KEY). Network activity is
 * stubbed by the shared fixture.
 */

const FALLBACK_DB = {
  url: "https://api.test",
  serviceKey: "service-key",
  userId: "user-1",
  headers: { "Content-Type": "application/json" },
} as const;

const LEAD_ID = "123e4567-e89b-42d3-a456-426614174000";
const WORKSPACE_ID = "123e4567-e89b-42d3-a456-426614174001";

const LEAD = {
  name: "Acme Dental",
  category: "dentist",
  rating: 4.7,
  reviews: 128,
  website: "https://acme.example.test",
  email: "frontdesk@acme.example.test",
  phone: "+1 555 0100",
  address: "12 Main St",
  city: "Austin",
  state: "TX",
};

const ANALYSIS = {
  summary: "Well-reviewed Austin dentist with clear contact channels.",
  points: ["128 reviews averaging 4.7 stars.", "Direct email and phone are public.", "Angle: patients already refer them."],
  outreach_angle: "Angle: patients already refer them.",
};

type DbOverrides = {
  member?: boolean | { role: string };
  planHasAi?: boolean;
  lead?: Record<string, unknown> | null;
  cached?: Record<string, unknown> | null;
};

function supabaseStub(db: DbOverrides) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? new URL(input) : new URL(input instanceof URL ? input.toString() : input.url);
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: FALLBACK_DB.headers });

    if (url.pathname === "/auth/v1/user") return json({ user: { id: FALLBACK_DB.userId } });

    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.replace("/rest/v1/", "");
      const method = (init?.method ?? "GET").toUpperCase();
      const wantsObject = String(new Headers(init?.headers).get("accept") ?? "").includes("vnd.pgrst.object+json");
      if (method === "GET") {
        switch (table) {
          case "workspace_members": {
            // Callers are workspace admins unless a test says otherwise.
            if (db.member === false) return json({ code: "PGRST116" }, 406);
            const member = typeof db.member === "object" && db.member ? db.member : { role: "admin" };
            return wantsObject ? json(member) : json([member]);
          }
          case "subscriptions":
            return wantsObject ? json({ plan_id: "growth", status: "active" }) : json([{ plan_id: "growth", status: "active" }]);
          case "plans": {
            const row = { has_ai: db.planHasAi !== false };
            return wantsObject ? json(row) : json([row]);
          }
          case "leads": {
            if (db.lead === null) return json({ code: "PGRST116" }, 406);
            const row = db.lead ?? LEAD;
            return wantsObject ? json(row) : json([row]);
          }
          case "ai_insights": {
            if (!db.cached) return json({ code: "PGRST116" }, 406);
            return wantsObject ? json(db.cached) : json([db.cached]);
          }
          default:
            return json([]);
        }
      }
      if (table === "ai_insights" && (method === "POST" || method === "PUT")) return json({}, 201);
      if (table === "ai_requests" && method === "POST") return json({}, 201);
      if (url.pathname === "/rest/v1/rpc/increment_usage_counter") return json({});
      return json({}, 201);
    }
    return json({ error: `unexpected supabase request: ${url.pathname}` }, 500);
  };
}

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "OPENROUTER_API_KEY", "OPENROUTER_MODEL"] as const;

beforeEach(() => {
  // The abuse governor is module-level state shared by every case in this file.
  resetRateLimits();
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.SUPABASE_URL = "https://api.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test-openrouter-key";
  delete process.env.OPENROUTER_MODEL;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/ai-analyze", () => {
  it("returns analysis, caches it under the active model, and counts usage", async () => {
    const providerBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("openrouter.ai")) {
          providerBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANALYSIS) } }] }), {
            status: 200,
            headers: FALLBACK_DB.headers,
          });
        }
        return supabaseStub({})(input, init);
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID },
      headers: { authorization: "Bearer user-token-1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, unknown> & { points: string[] };
    expect(body.summary).toBe(ANALYSIS.summary);
    expect(body.model).toBe(getOpenRouterModel());
    expect(body.cached).toBe(false);
    // The UI displays the outreach angle as the final point — preserved.
    expect(body.points[body.points.length - 1]).toBe(ANALYSIS.outreach_angle);
    expect(body.outreach_angle).toBe(ANALYSIS.outreach_angle);
    expect(providerBodies).toHaveLength(1);
    expect(String(providerBodies[0]!.model)).toBe(getOpenRouterModel());
    const messages = providerBodies[0]!.messages as Array<{ role: string; content: string }>;
    expect(messages.some((m) => m.role === "user" && m.content.includes("Acme Dental"))).toBe(true);
  });

  it("serves fresh cached insight without a provider call, even across lead shared columns", async () => {
    const cached = {
      summary: "Cached insight.",
      points: ["point one", "point two", "Angle: cached."],
      model: getOpenRouterModel(),
      created_at: new Date().toISOString(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("openrouter.ai")) throw new Error("provider should not be called for cached insights");
        return supabaseStub({ cached })(input, init);
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID },
      headers: { authorization: "Bearer user-token-1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ summary: "Cached insight.", cached: true, outreach_angle: "Angle: cached." });
  });

  it("refuses to analyze when the plan has no AI entitlement and never calls the provider", async () => {
    let providerCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("openrouter.ai")) {
          providerCalls += 1;
          return new Response("{}", { status: 200 });
        }
        return supabaseStub({ planHasAi: false })(input, init);
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID },
      headers: { authorization: "Bearer user-token-1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(403);
    expect(getBody()).toMatchObject({ code: "ai_not_entitled" });
    expect(providerCalls).toBe(0);
  });

  it("scopes the lead lookup to the caller's workspace — a foreign lead looks missing", async () => {
    let providerCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("openrouter.ai")) {
          providerCalls += 1;
          return new Response("{}", { status: 200 });
        }
        return supabaseStub({ lead: null })(input, init);
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID },
      headers: { authorization: "Bearer user-token-1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(404);
    expect(getBody()).toMatchObject({ code: "lead_not_found" });
    expect(providerCalls).toBe(0);
  });

  it("never returns a successful response for empty AI output — it 502s after one silent retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let providerCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("openrouter.ai")) {
          providerCalls += 1;
          return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
            status: 200,
            headers: FALLBACK_DB.headers,
          });
        }
        return supabaseStub({})(input, init);
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID },
      headers: { authorization: "Bearer user-token-1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(502);
    expect(getBody()).toMatchObject({ code: "empty_response", error: expect.stringContaining("empty response") });
    // The OpenRouter client treats an empty completion as a hard failure — the
    // route never sees a payload to retry with.
    expect(providerCalls).toBe(1);
    vi.restoreAllMocks();
  });

  it("retries once when the first reply is not JSON, then accepts a fenced object", async () => {
    let providerCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("openrouter.ai")) {
          providerCalls += 1;
          const content =
            providerCalls === 1 ? "I cannot help with that." : `\`\`\`json\n${JSON.stringify(ANALYSIS)}\n\`\`\``;
          return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
            status: 200,
            headers: FALLBACK_DB.headers,
          });
        }
        return supabaseStub({})(input, init);
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID },
      headers: { authorization: "Bearer user-token-1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ summary: ANALYSIS.summary });
    expect(providerCalls).toBe(2);
  });

  it("keeps returning 429 rate_limited while the provider throttles, without fabricating analysis", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let providerCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("openrouter.ai")) {
          providerCalls += 1;
          return new Response(JSON.stringify({ error: { message: "Slow down" } }), {
            status: 429,
            headers: FALLBACK_DB.headers,
          });
        }
        return supabaseStub({})(input, init);
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID },
      headers: { authorization: "Bearer user-token-1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(429);
    expect(getBody()).toMatchObject({ code: "rate_limited" });
    // Genuine rate limits are transient: the OpenRouter client retries within its
    // attempt budget, then surfaces the curated 429 — never fabricated data.
    expect(providerCalls).toBe(3);
    vi.restoreAllMocks();
  });

  it("maps an out-of-quota provider error to 502 with the quota note", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("openrouter.ai")) {
          return new Response(JSON.stringify({ error: { message: "Insufficient balance" } }), {
            status: 402,
            headers: FALLBACK_DB.headers,
          });
        }
        return supabaseStub({})(input, init);
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID },
      headers: { authorization: "Bearer user-token-1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(502);
    expect(getBody()).toMatchObject({ code: "provider_quota", error: expect.stringContaining("usage quota") });
    vi.restoreAllMocks();
  });

  it("returns a clearly labeled configuration error when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => supabaseStub({})(input, init)));

    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID },
      headers: { authorization: "Bearer user-token-1" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(500);
    expect(getBody()).toMatchObject({ code: "missing_key" });
    const body = getBody() as Record<string, unknown>;
    expect(String(body.error)).toContain("OPENROUTER_API_KEY");
    expect(String(body.error)).not.toContain("OPENAI");
    vi.restoreAllMocks();
  });

  it("rejects requests without an Authorization header before validating the payload", async () => {
    let sawFetch = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        sawFetch = true;
        return new Response("{}", { status: 200 });
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes({ method: "POST", body: { leadId: "nope" } });
    await handler(req, res);

    expect(getStatus()).toBe(401);
    expect(getBody()).toMatchObject({ code: "auth_missing" });
    expect(sawFetch).toBe(false);
  });

  it("rejects non-POST methods", async () => {
    const { req, res, getStatus } = createMockReqRes({ method: "GET" });
    await handler(req, res);
    expect(getStatus()).toBe(405);
  });
});

describe("POST /api/ai-analyze abuse controls", () => {
  it("stops a single account from looping refresh:true against the paid model", async () => {
    /* Regression: `refresh: true` bypasses the ai_insights cache and nothing
       metered it, so one signed-in Free account could spend OpenRouter credit
       in a loop. Lead analysis is now governed per user. */
    let providerCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("openrouter.ai")) {
          providerCalls += 1;
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANALYSIS) } }] }), {
            status: 200,
            headers: FALLBACK_DB.headers,
          });
        }
        return supabaseStub({})(input, init);
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const { req, res, getStatus } = createMockReqRes({
        method: "POST",
        body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID, refresh: true },
        headers: { authorization: "Bearer user-token-1" },
      });
      await handler(req, res);
      statuses.push(getStatus());
    }

    expect(statuses.filter((status) => status === 200).length).toBe(20);
    expect(statuses.filter((status) => status === 429).length).toBe(5);
    // The provider is never reached once the governor trips.
    expect(providerCalls).toBe(20);
  });

  it("answers a throttled caller with a retryable message and no internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("openrouter.ai")) {
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANALYSIS) } }] }), {
            status: 200,
            headers: FALLBACK_DB.headers,
          });
        }
        return supabaseStub({})(input, init);
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    let last: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 22; attempt += 1) {
      const { req, res, getBody } = createMockReqRes({
        method: "POST",
        body: { leadId: LEAD_ID, workspaceId: WORKSPACE_ID, refresh: true },
        headers: { authorization: "Bearer user-token-1" },
      });
      await handler(req, res);
      last = getBody() as Record<string, unknown>;
    }
    expect(last.code).toBe("rate_limited");
    expect(String(last.error)).toMatch(/try again/i);
    expect(JSON.stringify(last)).not.toMatch(/sk-or-|publishable-key|service-key/);
  });
});
