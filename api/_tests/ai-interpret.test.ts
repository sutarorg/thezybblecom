import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler from "../ai-interpret";

/**
 * /api/ai-interpret is the authorization + usage gate for Zybble AI
 * interpretation: the interpretation itself runs in the browser through
 * Puter.js (deepseek/deepseek-v3.2). These tests keep the server-side
 * guarantees honest — validation order, entitlement gating, the usage row,
 * and the absence of any AI-provider dependency.
 */

const SUPABASE_URL = "https://stub.supabase.co";
const SUPABASE_KEY = "sb_publishable_stub_key";
const CALLER_TOKEN = "caller-access-token";
const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "11111111-2222-3333-4444-555555555555";

const saved: Map<string, string | undefined> = new Map();
const ENV_VARS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"] as const;

beforeEach(() => {
  for (const name of ENV_VARS) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_PUBLISHABLE_KEY = SUPABASE_KEY;
});

afterEach(() => {
  for (const name of ENV_VARS) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type StubOptions = {
  member?: boolean;
  planHasAi?: boolean;
};

/** Fixture transport for the Supabase REST/GoTrue calls the gate makes. */
function installNetworkStub(options: StubOptions = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const bodyText = typeof init.body === "string" ? init.body : undefined;
    calls.push({ url, method, body: bodyText });
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    if (url.startsWith("https://api.openai.com")) {
      throw new Error("The interpret gate must never call an AI provider");
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
  return { calls, fetchMock };
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

describe("AI interpretation gate", () => {
  it("authorizes an entitled member and records usage with the client-side model", async () => {
    const { calls } = installNetworkStub();
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: { workspaceId: WORKSPACE_ID, request: "100 dentists in Austin with websites" },
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ ok: true, model: "deepseek/deepseek-v3.2" });

    const usage = calls.find((c) => c.url.includes("/rest/v1/ai_requests") && c.method === "POST");
    expect(usage).toBeDefined();
    expect(JSON.parse(usage!.body!)).toMatchObject({
      workspace_id: WORKSPACE_ID,
      user_id: USER_ID,
      kind: "interpret",
      status: "completed",
      model: "deepseek/deepseek-v3.2",
    });
    // No AI provider is contacted — the model runs in the browser via Puter.js.
    expect(calls.some((c) => c.url.includes("api.openai.com"))).toBe(false);
  });

  it("rejects a member whose plan has no AI entitlement", async () => {
    installNetworkStub({ planHasAi: false });
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: { workspaceId: WORKSPACE_ID, request: "100 dentists in Austin" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(403);
    expect(getBody()).toMatchObject({ code: "ai_not_entitled" });
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

  it("has no OpenAI provider dependency left in this AI path", () => {
    const source = readFileSync(resolve(process.cwd(), "api", "ai-interpret.ts"), "utf8");
    expect(source).not.toContain("_lib/openai");
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("openAIJson");
  });
});
