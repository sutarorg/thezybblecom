import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resetRateLimits } from "../_lib/rate-limit.js";
import handler from "../ai-interpret";

/**
 * /api/ai-interpret authorizes (session → workspace membership → plan
 * entitlement) and then runs the DeepSeek V3.2 interpretation server-side
 * through OpenRouter (OPENROUTER_API_KEY) — the browser never touches an AI
 * credential or a third-party sign-in. These tests keep the server-side
 * guarantees honest: validation order, entitlement gating, the usage row, the
 * interpretation contract, and the absence of any OpenAI-based provider
 * dependency.
 */

const SUPABASE_URL = "https://stub.supabase.co";
const SUPABASE_KEY = "sb_publishable_stub_key";
const OPENROUTER_API_KEY = "sk-or-stub-openrouter-key";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "deepseek/deepseek-v3.2";
const CALLER_TOKEN = "caller-access-token";
const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "11111111-2222-3333-4444-555555555555";

const SUPABASE_VARS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"] as const;
const OPENROUTER_VARS = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_API_BASE_URL"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  resetRateLimits();
  for (const name of [...SUPABASE_VARS, ...OPENROUTER_VARS]) saved.set(name, process.env[name]);
  for (const name of [...SUPABASE_VARS, ...OPENROUTER_VARS]) delete process.env[name];
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_PUBLISHABLE_KEY = SUPABASE_KEY;
  process.env.OPENROUTER_API_KEY = OPENROUTER_API_KEY;
});

afterEach(() => {
  for (const name of [...SUPABASE_VARS, ...OPENROUTER_VARS]) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MODEL_REPLY = {
  category: "dentists",
  location: "Austin, TX",
  quantity: 100,
  requireWebsite: true,
  summary: "Austin dentists with websites.",
  notes: ["Quantity requested: 100"],
};

/**
 * A provider success *factory*: the route may call the provider twice (one
 * silent retry), and a Response body can only be consumed once — every call
 * needs a fresh Response.
 */
function providerSuccess(reply: Record<string, unknown> | string = MODEL_REPLY): () => Response {
  const content = typeof reply === "string" ? reply : JSON.stringify(reply);
  return () =>
    new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
}

type StubOptions = {
  member?: boolean;
  planHasAi?: boolean;
  provider?: (callCount: number) => Response;
};

/** Fixture transport for the Supabase REST/GoTrue + OpenRouter calls the route makes. */
function installNetworkStub(options: StubOptions = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  let providerCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const bodyText = typeof init.body === "string" ? init.body : undefined;
    calls.push({ url, method, body: bodyText });
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    if (url === OPENROUTER_CHAT_URL) {
      providerCalls += 1;
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENROUTER_API_KEY}`);
      const request = JSON.parse(bodyText ?? "{}") as Record<string, unknown>;
      expect(request.model).toBe(OPENROUTER_MODEL);
      return (options.provider ?? providerSuccess())(providerCalls);
    }
    if (url === `${SUPABASE_URL}/auth/v1/user`) return json({ id: USER_ID, aud: "authenticated" });
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/`)) {
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/workspace_members`)) {
        return options.member === false ? json([]) : json([{ role: "owner" }]);
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/subscriptions`)) {
        return json([{ plan_id: "growth", status: "active" }]);
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/plans`)) {
        return json([{ has_ai: options.planHasAi ?? true }]);
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/ai_requests`)) {
        if (method === "POST") return json({});
      }
    }

    throw new Error(`Unexpected request in fixture transport: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, getProviderCalls: () => providerCalls };
}

function createMockReqRes(options: { method?: string; headers?: Record<string, string>; body?: unknown }) {
  const req = {
    method: options.method ?? "POST",
    headers: options.headers ?? { authorization: `Bearer ${CALLER_TOKEN}`, "content-type": "application/json" },
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

describe("AI interpretation — server-side through OpenRouter", () => {
  it("authorizes an entitled member, runs the interpretation, and records usage", async () => {
    const { calls, getProviderCalls } = installNetworkStub();
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: { workspaceId: WORKSPACE_ID, request: "100 dentists in Austin with websites" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, model: OPENROUTER_MODEL });
    expect(body.filters).toMatchObject({
      category: "dentists",
      location: "Austin, TX",
      quantity: 100,
      requireWebsite: true,
    });
    expect(body.summary).toBe("Austin dentists with websites.");
    expect(getProviderCalls()).toBe(1);

    const usage = calls.find((c) => c.url.includes("/rest/v1/ai_requests") && c.method === "POST");
    expect(usage).toBeDefined();
    expect(JSON.parse(usage!.body!)).toMatchObject({
      workspace_id: WORKSPACE_ID,
      user_id: USER_ID,
      kind: "interpret",
      status: "completed",
      model: OPENROUTER_MODEL,
    });
  });

  it("clamps unsafe model output before it reaches the client", async () => {
    installNetworkStub({
      provider: providerSuccess({
        category: "dentists",
        quantity: 99_999,
        minRating: "2",
        businessSize: "enterprise", // never asked for this size
        summary: "x".repeat(900),
        notes: ["one", "two", "three"],
      }),
    });
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: { workspaceId: WORKSPACE_ID, request: "dentists in Austin" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as { filters: Record<string, unknown>; summary: string; notes: string[] };
    expect(body.filters.quantity).toBe(240);
    expect(body.filters).not.toHaveProperty("minRating");
    expect(body.filters).not.toHaveProperty("businessSize");
    expect(body.summary.length).toBe(240);
    expect(body.notes).toEqual(["one", "two"]);
  });

  it("retries once when the first reply is not usable JSON", async () => {
    const { getProviderCalls } = installNetworkStub({
      provider: (call) => (call === 1 ? providerSuccess("Sure — dentists sound great!")() : providerSuccess()()),
    });
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: { workspaceId: WORKSPACE_ID, request: "dentists in Austin" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(getProviderCalls()).toBe(2);
    expect((getBody() as { filters: { category: string } }).filters.category).toBe("dentists");
  });

  it("fails with a category error when the model never produces a category", async () => {
    installNetworkStub({ provider: providerSuccess({ category: null }) });
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: { workspaceId: WORKSPACE_ID, request: "hello" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(502);
    expect(getBody()).toMatchObject({ code: "category_missing" });
  });

  it("rejects a member whose plan has no AI entitlement before calling the provider", async () => {
    const { getProviderCalls } = installNetworkStub({ planHasAi: false });
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: { workspaceId: WORKSPACE_ID, request: "100 dentists in Austin" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(403);
    expect(getBody()).toMatchObject({ code: "ai_not_entitled" });
    expect(getProviderCalls()).toBe(0);
  });

  it("rejects a non-member of the workspace", async () => {
    installNetworkStub({ member: false });
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: { workspaceId: WORKSPACE_ID, request: "100 dentists in Austin" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(403);
    expect(getBody()).toMatchObject({ code: "workspace_forbidden" });
  });

  it("reports a missing OPENROUTER_API_KEY without leaking any secret", async () => {
    delete process.env.OPENROUTER_API_KEY;
    installNetworkStub();
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: { workspaceId: WORKSPACE_ID, request: "dentists in Austin" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(500);
    const body = getBody() as { error: string; code: string };
    expect(body.code).toBe("missing_key");
    expect(body.error).toContain("OPENROUTER_API_KEY");
    expect(body.error).not.toContain(OPENROUTER_API_KEY);
  });

  it("maps provider failures to safe statuses", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installNetworkStub({ provider: () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 401 }) });
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: { workspaceId: WORKSPACE_ID, request: "dentists in Austin" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(502);
    expect(getBody()).toMatchObject({ code: "provider_auth" });
    vi.restoreAllMocks();
  });

  it("rejects non-POST requests with 405 Method Not Allowed", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ method: "GET" });
    await handler(req, res);
    expect(getStatus()).toBe(405);
    expect(getBody()).toMatchObject({ error: "Method not allowed" });
  });

  it("rejects missing body with 400", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ method: "POST", body: null });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody()).toMatchObject({ code: "missing_body" });
  });

  it("rejects an expired or missing auth token before workspace/provider access", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: {},
      body: { workspaceId: WORKSPACE_ID, request: "dentists in Austin" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(401);
    expect(getBody()).toMatchObject({ code: "auth_missing" });
  });

  it("rejects an invalid workspace before auth/provider access", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { workspaceId: "not-a-uuid", request: "dentists in Austin" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody()).toMatchObject({ code: "workspace_invalid" });
  });

  it("has no OpenAI-based provider dependency left in this AI path", () => {
    const source = readFileSync(resolve(process.cwd(), "api", "ai-interpret.ts"), "utf8");
    expect(source).not.toContain("_lib/openai");
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("openAIJson");
    // …and the only provider client is the server-side OpenRouter integration.
    expect(source).toContain("./_lib/openrouter.js");
  });
});
