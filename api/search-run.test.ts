import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler, { ApiError, pageResults, serpApiMaps } from "./search-run";

afterEach(() => vi.unstubAllGlobals());

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

describe("SerpApi response handling", () => {
  it("treats a valid provider no-results response as an empty page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Google Maps hasn't returned any results for this query.",
    }), { status: 200 })));

    const page = await serpApiMaps("server-secret", { q: "dentists", start: 0 });
    expect(pageResults(page)).toEqual([]);
  });

  it("rejects an empty successful provider response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    await expect(serpApiMaps("server-secret", { q: "dentists", start: 0 })).rejects.toMatchObject({
      code: "provider_empty",
    });
    vi.restoreAllMocks();
  });

  it("rejects malformed provider JSON and malformed result rows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ local_results: ["not-a-business"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(serpApiMaps("server-secret", { q: "dentists", start: 0 })).rejects.toMatchObject({
      code: "provider_malformed",
    });
    await expect(serpApiMaps("server-secret", { q: "dentists", start: 0 })).rejects.toMatchObject({
      code: "provider_malformed",
    });
    vi.restoreAllMocks();
  });

  it("returns real provider result payloads unchanged for normalization", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      local_results: [{ title: "A real business", place_id: "place-1" }],
      serpapi_pagination: { next: "https://serpapi.com/next" },
    }), { status: 200 })));
    const page = await serpApiMaps("server-secret", { q: "dentists", start: 0 });
    expect(pageResults(page)).toEqual([{ title: "A real business", place_id: "place-1" }]);
  });

  it("normalizes rate limits and request timeouts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate limit reached" }), { status: 429 }))
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(serpApiMaps("server-secret", { q: "dentists", start: 0 })).rejects.toMatchObject({
      status: 429,
      code: "provider_quota",
    } satisfies Partial<ApiError>);
    await expect(serpApiMaps("server-secret", { q: "dentists", start: 0 }, 10)).rejects.toMatchObject({
      status: 504,
      code: "provider_timeout",
    } satisfies Partial<ApiError>);
    vi.restoreAllMocks();
  });
});

describe("search-run handler", () => {
  it("rejects non-POST requests with 405 Method Not Allowed", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ method: "GET" });
    await handler(req, res);
    expect(getStatus()).toBe(405);
    expect(getBody()).toMatchObject({ code: "method_not_allowed" });
  });

  it("returns 500 serpapi_config when SERPAPI_API_KEY is not configured", async () => {
    const oldKey = process.env.SERPAPI_API_KEY;
    delete process.env.SERPAPI_API_KEY;
    delete process.env.SERPAPI_KEY;
    delete process.env.SERP_API_KEY;
    try {
      const { req, res, getStatus, getBody } = createMockReqRes({
        method: "POST",
        body: { workspaceId: "11111111-1111-1111-1111-111111111111", filters: { category: "cafes" } },
      });
      await handler(req, res);
      expect(getStatus()).toBe(500);
      expect(getBody()).toMatchObject({ code: "serpapi_config" });
    } finally {
      if (oldKey) process.env.SERPAPI_API_KEY = oldKey;
    }
  });

  it("returns 400 workspace_invalid when workspaceId is missing or invalid", async () => {
    process.env.SERPAPI_API_KEY = "test-serp-key";
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { workspaceId: "invalid-id", filters: { category: "cafes" } },
    });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody()).toMatchObject({ code: "workspace_invalid" });
  });

  it("returns 401 auth_missing when Authorization header is absent", async () => {
    process.env.SERPAPI_API_KEY = "test-serp-key";
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { workspaceId: "11111111-1111-1111-1111-111111111111", filters: { category: "cafes" } },
    });
    await handler(req, res);
    expect(getStatus()).toBe(401);
    expect(getBody()).toMatchObject({ code: "auth_missing" });
  });

  it("rejects a missing category before any provider request", async () => {
    process.env.SERPAPI_API_KEY = "test-serp-key";
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: { workspaceId: "11111111-1111-1111-1111-111111111111", filters: {} },
    });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody()).toMatchObject({ code: "category_required" });
  });

  it("rejects invalid filter types instead of silently coercing them", async () => {
    process.env.SERPAPI_API_KEY = "test-serp-key";
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      body: {
        workspaceId: "11111111-1111-1111-1111-111111111111",
        filters: { category: "cafes", requireEmail: "false" },
      },
    });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody()).toMatchObject({ code: "filter_invalid" });
  });
});

describe("search-run server-side Supabase configuration", () => {
  const SUPABASE_VARS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"] as const;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of SUPABASE_VARS) saved.set(name, process.env[name]);
  });

  afterEach(() => {
    for (const name of SUPABASE_VARS) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setSupabaseEnv(values: Partial<Record<(typeof SUPABASE_VARS)[number], string>>) {
    for (const name of SUPABASE_VARS) delete process.env[name];
    for (const [name, value] of Object.entries(values)) process.env[name] = value;
  }

  it("fails with an actionable error naming every missing server variable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.SERPAPI_API_KEY = "test-serp-key";
    setSupabaseEnv({});
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { workspaceId: "11111111-1111-1111-1111-111111111111", filters: { category: "cafes" } },
    });
    await handler(req, res);
    expect(getStatus()).toBe(500);
    const body = getBody() as { error: string; code: string };
    expect(body.code).toBe("supabase_config");
    expect(body.error).toContain("Missing server environment variables: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY).");
    expect(body.error).toContain("Vercel → Project → Settings → Environment Variables");
    // VITE_* browser build variables must never satisfy the server lookup.
    expect(body.error).toContain("VITE_SUPABASE_*");
  });

  it("names only SUPABASE_URL when just the URL is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.SERPAPI_API_KEY = "test-serp-key";
    setSupabaseEnv({ SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { workspaceId: "11111111-1111-1111-1111-111111111111", filters: { category: "cafes" } },
    });
    await handler(req, res);
    expect(getStatus()).toBe(500);
    const body = getBody() as { error: string; code: string };
    expect(body.code).toBe("supabase_config");
    expect(body.error).toContain("Missing server environment variable: SUPABASE_URL.");
    expect(body.error).not.toContain("Missing server environment variable: SUPABASE_PUBLISHABLE_KEY");
  });

  it("accepts the legacy SUPABASE_ANON_KEY fallback and trims padded values", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.SERPAPI_API_KEY = "test-serp-key";
    setSupabaseEnv({
      SUPABASE_URL: "  https://project.supabase.co\n",
      SUPABASE_ANON_KEY: "  sb_publishable_legacy-anon  ",
    });
    // Configuration is valid, so the handler must get past client creation and
    // reach the authenticated user lookup; an invalid token then yields 401.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid JWT" }), { status: 401, headers: { "content-type": "application/json" } }),
    ));
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer caller-token" },
      body: { workspaceId: "11111111-1111-1111-1111-111111111111", filters: { category: "cafes" } },
    });
    await handler(req, res);
    expect(getStatus()).toBe(401);
    expect(getBody()).toMatchObject({ code: "auth_invalid" });
  });

  it("rejects a service-role key so RLS can never be bypassed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.SERPAPI_API_KEY = "test-serp-key";
    setSupabaseEnv({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_secret_service-role-key-must-be-rejected",
    });
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { workspaceId: "11111111-1111-1111-1111-111111111111", filters: { category: "cafes" } },
    });
    await handler(req, res);
    expect(getStatus()).toBe(500);
    const body = getBody() as { error: string; code: string };
    expect(body.code).toBe("supabase_config");
    expect(body.error).toContain("bypass row-level security");
    // The rejected key value must never be echoed back to the client.
    expect(JSON.stringify(body)).not.toContain("sb_secret_service-role-key-must-be-rejected");
  });

  it("never echoes the SerpApi key in a configuration error response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const savedKey = process.env.SERPAPI_API_KEY;
    delete process.env.SERPAPI_API_KEY;
    delete process.env.SERPAPI_KEY;
    delete process.env.SERP_API_KEY;
    try {
      const { req, res, getStatus, getBody } = createMockReqRes({
        method: "POST",
        body: { workspaceId: "11111111-1111-1111-1111-111111111111", filters: { category: "cafes" } },
      });
      await handler(req, res);
      expect(getStatus()).toBe(500);
      const body = getBody() as { error: string; code: string };
      expect(body.code).toBe("serpapi_config");
      expect(body.error).toContain("Missing server environment variable: SERPAPI_API_KEY.");
      expect(JSON.stringify(body)).not.toContain("test-serp-key");
    } finally {
      if (savedKey !== undefined) process.env.SERPAPI_API_KEY = savedKey;
    }
  });
});
