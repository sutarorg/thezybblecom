import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler from "../ai-analyze";

/**
 * Full-flow tests for POST /api/ai-analyze — the same-origin route the lead
 * detail page calls before falling back to the Supabase Edge Function.
 * Auth, workspace authorization, entitlements, lead scoping, insight caching,
 * the OpenAI request, and the response contract are exercised end-to-end with
 * fixture transports (no mock product path).
 */

const SUPABASE_URL = "https://stub.supabase.co";
const SUPABASE_KEY = "sb_publishable_stub_key";
const OPENAI_KEY = "sk-stub-openai-key";
const CALLER_TOKEN = "caller-access-token";
const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const LEAD_ID = "22222222-2222-2222-2222-222222222222";

const SUPABASE_VARS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"] as const;
const OPENAI_VARS = ["OPENAI_API_KEY", "OPENAI_MODEL"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of [...SUPABASE_VARS, ...OPENAI_VARS]) saved.set(name, process.env[name]);
  for (const name of [...SUPABASE_VARS, ...OPENAI_VARS]) delete process.env[name];
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_PUBLISHABLE_KEY = SUPABASE_KEY;
  process.env.OPENAI_API_KEY = OPENAI_KEY;
  process.env.OPENAI_MODEL = "o4-mini";
});

afterEach(() => {
  for (const name of [...SUPABASE_VARS, ...OPENAI_VARS]) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LEAD_ROW = {
  name: "Fixture Roasters",
  category: "Coffee shop",
  categories: ["Coffee shop"],
  rating: 4.7,
  reviews: 210,
  website: "https://fixture-roasters.example.com",
  website_domain: "fixture-roasters.example.com",
  email: null,
  phone: "+1 512 555 0100",
  address: "100 Example Ave, Austin, TX 78701",
  city: "Austin",
  state: "TX",
  open_state: "open",
  hours_display: "Open · Closes 9 PM",
  services: ["Takeout"],
  amenities: ["Wi-Fi"],
  price_level: 2,
};

const AI_OUTPUT = {
  summary: "A well-reviewed Austin coffee shop with strong local presence.",
  points: [
    "4.7 stars across 210 reviews signals consistent customer satisfaction.",
    "A public phone number is available; no email is published.",
    "Hours are listed, so outreach timing can respect open hours.",
  ],
  outreach_angle: "Lead with the review record and offer an email-first contact option.",
};

function openAiSuccess(output: Record<string, unknown> = AI_OUTPUT) {
  return new Response(
    JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

type StubOptions = {
  lead?: unknown;
  leadFound?: boolean;
  cachedInsight?: unknown;
  planHasAi?: boolean;
  openAi?: Response | (() => Response);
};

function installNetworkStub(options: StubOptions = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const bodyText = typeof init.body === "string" ? init.body : undefined;
    calls.push({ url, method, body: bodyText });
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    // ---- OpenAI Responses API ----
    if (url === "https://api.openai.com/v1/responses") {
      expect(url).toBeTruthy();
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENAI_KEY}`);
      if (typeof options.openAi === "function") return options.openAi();
      return options.openAi ?? openAiSuccess();
    }

    // ---- Supabase GoTrue ----
    if (url === `${SUPABASE_URL}/auth/v1/user`) return json({ id: USER_ID, aud: "authenticated" });

    // ---- Supabase PostgREST ----
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/`)) {
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/increment_usage_counter`)) {
        return new Response(null, { status: 204 });
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/workspace_members`)) return json([{ role: "owner" }]);
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/subscriptions`)) {
        return json([{ plan_id: "growth", status: "active" }]);
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/plans`)) {
        return json([{ has_ai: options.planHasAi ?? true }]);
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/leads`)) {
        if (method === "GET") {
          return options.leadFound === false ? json([]) : json(options.lead ?? LEAD_ROW);
        }
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/ai_insights`)) {
        if (method === "GET") return json(options.cachedInsight ?? []);
        return json({});
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/ai_requests`)) {
        if (method === "POST") return json({});
      }
    }

    throw new Error(`Unexpected request in fixture transport: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function createMockReqRes(options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const req = {
    method: options.method ?? "POST",
    headers: options.headers ?? { authorization: `Bearer ${CALLER_TOKEN}`, "content-type": "application/json" },
    body: options.body ?? { leadId: LEAD_ID, workspaceId: WORKSPACE_ID },
  } as unknown as IncomingMessage & { body?: unknown };

  let statusCode = 0;
  let responseBody: unknown = null;
  const res = {
    setHeader() {
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

  return { req, res, getStatus: () => statusCode, getBody: () => responseBody };
}

describe("POST /api/ai-analyze", () => {
  it("analyzes a lead end-to-end and returns the expected structure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { calls } = installNetworkStub();
    const { req, res, getStatus, getBody } = createMockReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as {
      summary: string;
      points: string[];
      outreach_angle: string;
      model: string;
      cached: boolean;
    };
    expect(body.summary).toBe(AI_OUTPUT.summary);
    expect(body.points).toEqual([...AI_OUTPUT.points, AI_OUTPUT.outreach_angle]);
    expect(body.outreach_angle).toBe(AI_OUTPUT.outreach_angle);
    expect(body.model).toBe("o4-mini");
    expect(body.cached).toBe(false);

    // The insight is persisted, the request is logged, and the usage counter
    // is bumped through the security-definer RPC.
    const insightUpsert = calls.find((c) => c.url.includes("/rest/v1/ai_insights") && c.method === "POST");
    expect(insightUpsert).toBeDefined();
    expect(JSON.parse(insightUpsert!.body!)).toMatchObject({ lead_id: LEAD_ID, summary: AI_OUTPUT.summary });
    expect(calls.some((c) => c.url.includes("/rest/v1/ai_requests"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/rest/v1/rpc/increment_usage_counter"))).toBe(true);

    // Secrets never reach the response.
    expect(JSON.stringify(body)).not.toContain(OPENAI_KEY);
    expect(JSON.stringify(body)).not.toContain(SUPABASE_KEY);
    vi.restoreAllMocks();
  });

  it("serves a cached insight without calling the AI provider", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetchMock } = installNetworkStub({
      cachedInsight: [{ summary: "Cached summary.", points: ["One.", "Two."], model: "o4-mini", created_at: "2026-01-01" }],
    });
    const { req, res, getStatus, getBody } = createMockReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as { summary: string; cached: boolean; outreach_angle: string };
    expect(body.cached).toBe(true);
    expect(body.summary).toBe("Cached summary.");
    expect(body.outreach_angle).toBe("Two.");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("openai.com"))).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("rejects a caller who cannot access the workspace", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { calls } = installNetworkStub();
    // Overwrite the workspace membership lookup to return no rows.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${SUPABASE_URL}/auth/v1/user`) {
        return new Response(JSON.stringify({ id: USER_ID, aud: "authenticated" }), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/rest/v1/workspace_members")) {
        return new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    const { req, res, getStatus, getBody } = createMockReqRes();
    await handler(req, res);
    expect(getStatus()).toBe(403);
    expect(getBody()).toMatchObject({ code: "workspace_forbidden" });
    expect(calls.length).toBe(0);
    vi.restoreAllMocks();
  });

  it("refuses analysis when the plan has no AI entitlement", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetchMock } = installNetworkStub({ planHasAi: false });
    const { req, res, getStatus, getBody } = createMockReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(403);
    expect(getBody()).toMatchObject({ code: "ai_not_entitled" });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("openai.com"))).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("returns 404 when the lead is not in the workspace", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    installNetworkStub({ leadFound: false });
    const { req, res, getStatus, getBody } = createMockReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(404);
    expect(getBody()).toMatchObject({ code: "lead_not_found" });
    vi.restoreAllMocks();
  });

  it("never returns a successful response for malformed AI output", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    installNetworkStub({ openAi: openAiSuccess({ summary: "", points: [], outreach_angle: "" }) });
    const { req, res, getStatus, getBody } = createMockReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(502);
    expect(getBody()).toMatchObject({ code: "malformed_response", error: expect.stringContaining("incomplete analysis") });
    vi.restoreAllMocks();
  });

  it("surfaces a persistent provider rate limit accurately after retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rateLimit = () => new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
    const { fetchMock } = installNetworkStub({ openAi: rateLimit });
    const { req, res, getStatus, getBody } = createMockReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(429);
    expect(getBody()).toMatchObject({ code: "rate_limited" });
    // The retry policy exhausted its attempts before giving up.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("openai.com"))).toHaveLength(3);
    vi.restoreAllMocks();
  });

  it("reports missing server AI configuration without leaking the key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.OPENAI_API_KEY;
    installNetworkStub();
    const { req, res, getStatus, getBody } = createMockReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(500);
    const body = getBody() as { error: string; code: string };
    expect(body.code).toBe("missing_key");
    expect(body.error).toContain("OPENAI_API_KEY");
    expect(body.error).not.toContain(OPENAI_KEY);
    vi.restoreAllMocks();
  });

  it("requires authentication before any provider access", async () => {
    // Even a garbage body must see 401, not request-shape details.
    const { req, res, getStatus, getBody } = createMockReqRes({ headers: {}, body: { leadId: "x" } });
    await handler(req, res);
    expect(getStatus()).toBe(401);
    expect(getBody()).toMatchObject({ code: "auth_missing" });
  });

  it("rejects non-POST requests with 405", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ method: "GET" });
    await handler(req, res);
    expect(getStatus()).toBe(405);
    expect(getBody()).toMatchObject({ code: "method_not_allowed" });
  });
});
