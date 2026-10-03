import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frontend AI request-path tests: the browser service layer must call the
 * same-origin /api route first, fall back to the deployed Edge Function only
 * when that route is unavailable, and never turn a malformed/empty payload
 * into a fake success.
 *
 * Interpretation is now client-side: the route is an authorization + usage
 * gate, and the DeepSeek V3.2 interpretation itself runs through the shared
 * Puter.js helper (mocked here).
 */

const h = vi.hoisted(() => {
  // Stand-in for the Supabase browser client: a session getter plus the
  // Edge Function invoker, backed by capturable mocks.
  const getSession = vi.fn();
  const invoke = vi.fn();
  const client = { auth: { getSession }, functions: { invoke } };
  // Stand-in for the client-side Puter AI helper.
  const interpretSearchRequest = vi.fn();
  const PuterAIError = class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "PuterAIError";
      this.code = code;
    }
  };
  return { client, getSession, invoke, interpretSearchRequest, PuterAIError };
});

vi.mock("./supabase", () => ({
  getSupabase: () => h.client,
  BACKEND_ENABLED: true,
}));

vi.mock("../../lib/puter-ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/puter-ai")>();
  return {
    ...original,
    interpretSearchRequest: h.interpretSearchRequest,
    PuterAIError: h.PuterAIError,
  };
});

import { analyzeLead, interpretRequest } from "./api";

const SESSION = { data: { session: { access_token: "caller-token", user: { id: "u1" } } } };

beforeEach(() => {
  h.getSession.mockReset().mockResolvedValue(SESSION);
  h.invoke.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

describe("analyzeLead — same-origin route first, Edge fallback second", () => {
  it("parses a successful /api/ai-analyze response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      summary: "Strong local presence.",
      points: ["4.7 stars.", "Phone available.", "Angle: lead with reviews."],
      outreach_angle: "Angle: lead with reviews.",
      model: "o4-mini",
      cached: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result, error } = await analyzeLead("lead-1", "ws-1");
    expect(error).toBeUndefined();
    expect(result?.summary).toBe("Strong local presence.");
    expect(result?.points).toHaveLength(3);
    expect(result?.model).toBe("o4-mini");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/ai-analyze");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer caller-token" });
  });

  it("returns the server's precise error without retrying a 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Zybble AI is rate-limited. Please try again shortly.", code: "rate_limited" }, 429)));

    const { result, error } = await analyzeLead("lead-1", "ws-1");
    expect(result).toBeUndefined();
    expect(error).toBe("Zybble AI is rate-limited. Please try again shortly.");
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("falls back to the Edge Function when the route is missing (404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404, headers: { "content-type": "text/html" } })));
    h.client.functions.invoke.mockResolvedValue({
      data: { summary: "From the edge.", points: ["p1", "p2"], model: "o4-mini" },
      error: null,
    });

    const { result, error } = await analyzeLead("lead-1", "ws-1");
    expect(error).toBeUndefined();
    expect(result?.summary).toBe("From the edge.");
    expect(h.invoke).toHaveBeenCalledWith("ai-analyze", expect.objectContaining({
      body: expect.objectContaining({ leadId: "lead-1", workspaceId: "ws-1" }),
      headers: { Authorization: "Bearer caller-token" },
    }));
  });

  it("never fabricates analysis for a blank 200 payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ summary: "", points: [], model: "o4-mini" })));
    const { result, error } = await analyzeLead("lead-1", "ws-1");
    expect(result).toBeUndefined();
    expect(error).toBe("Zybble AI returned incomplete analysis. Please try again.");
  });

  it("reports an unreachable Edge Function with an actionable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    h.invoke.mockResolvedValue({
      data: null,
      error: { message: "Failed to send a request to the Edge Function" },
    });

    const { result, error } = await analyzeLead("lead-1", "ws-1");
    expect(result).toBeUndefined();
    expect(error).toBe('The requested Edge Function "ai-analyze" couldn\'t be reached. Check that it is deployed and try again.');
  });

  it("requires a session before any request", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const { result, error } = await analyzeLead("lead-1", "ws-1");
    expect(result).toBeUndefined();
    expect(error).toBe("Your session expired — sign in again.");
  });
});

describe("interpretRequest — gated client-side filter interpretation", () => {
  beforeEach(() => {
    h.interpretSearchRequest.mockReset().mockResolvedValue({
      filters: { category: "dentists", location: "Austin, TX", requireEmail: true },
      summary: "Austin dentists with public emails.",
      notes: [],
    });
  });

  it("runs the client-side interpretation after the gate authorizes it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, model: "deepseek/deepseek-v3.2" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result, error } = await interpretRequest("ws-1", "dentists in Austin with emails");
    expect(error).toBeUndefined();
    expect(result?.filters.category).toBe("dentists");
    expect(result?.filters.requireEmail).toBe(true);
    expect(result?.summary).toContain("Austin dentists");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/ai-interpret");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer caller-token" });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      workspaceId: "ws-1",
      request: "dentists in Austin with emails",
    });
    expect(h.interpretSearchRequest).toHaveBeenCalledWith("dentists in Austin with emails");
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("surfaces gate failures without running the AI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Zybble AI isn't available on your current plan.", code: "ai_not_entitled" }, 403)));

    const { result, error } = await interpretRequest("ws-1", "dentists in Austin");
    expect(result).toBeUndefined();
    expect(error).toBe("Zybble AI isn't available on your current plan.");
    expect(h.interpretSearchRequest).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("falls back to the Edge Function gate when the route is missing (404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404, headers: { "content-type": "text/html" } })));
    h.invoke.mockResolvedValue({ data: { ok: true, model: "deepseek/deepseek-v3.2" }, error: null });

    const { result, error } = await interpretRequest("ws-1", "dentists in Austin");
    expect(error).toBeUndefined();
    expect(result?.filters.category).toBe("dentists");
    expect(h.invoke).toHaveBeenCalledWith("ai-interpret", expect.objectContaining({
      body: expect.objectContaining({ workspaceId: "ws-1", request: "dentists in Austin" }),
      headers: { Authorization: "Bearer caller-token" },
    }));
    expect(h.interpretSearchRequest).toHaveBeenCalledWith("dentists in Austin");
  });

  it("reports a client-side interpretation failure with its message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, model: "deepseek/deepseek-v3.2" })));
    h.interpretSearchRequest.mockRejectedValue(new h.PuterAIError("Zybble AI couldn't identify a business category. Try rephrasing.", "category_missing"));

    const { result, error } = await interpretRequest("ws-1", "hello");
    expect(result).toBeUndefined();
    expect(error).toBe("Zybble AI couldn't identify a business category. Try rephrasing.");
  });

  it("requires a session before any request", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const { result, error } = await interpretRequest("ws-1", "dentists in Austin");
    expect(result).toBeUndefined();
    expect(error).toBe("Your session expired — sign in again.");
    expect(h.interpretSearchRequest).not.toHaveBeenCalled();
  });
});
