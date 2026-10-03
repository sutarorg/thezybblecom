import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frontend AI request-path tests: the browser service layer must call the
 * same-origin /api route first, fall back to the deployed Edge Function only
 * when that route is unavailable, and never turn a malformed/empty payload
 * into a fake success.
 *
 * Interpretation now runs fully server-side: the route both authorizes the
 * caller (session → membership → plan) and runs the DeepSeek V3.2
 * interpretation through the server-side OpenRouter integration, returning
 * ready-to-apply filters. The browser never sees an AI credential and never
 * triggers a third-party sign-in.
 */

const h = vi.hoisted(() => {
  // Stand-in for the Supabase browser client: a session getter plus the
  // Edge Function invoker, backed by capturable mocks.
  const getSession = vi.fn();
  const invoke = vi.fn();
  const client = { auth: { getSession }, functions: { invoke } };
  return { client, getSession, invoke };
});

vi.mock("./supabase", () => ({
  getSupabase: () => h.client,
  BACKEND_ENABLED: true,
}));

import { analyzeLead, interpretRequest } from "./api";

const SESSION = { data: { session: { access_token: "caller-token", user: { id: "u1" } } } };
const DEEPSEEK_MODEL = "deepseek/deepseek-v3.2";

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
      model: DEEPSEEK_MODEL,
      cached: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result, error } = await analyzeLead("lead-1", "ws-1");
    expect(error).toBeUndefined();
    expect(result?.summary).toBe("Strong local presence.");
    expect(result?.points).toHaveLength(3);
    expect(result?.model).toBe(DEEPSEEK_MODEL);

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
      data: { summary: "From the edge.", points: ["p1", "p2"], model: DEEPSEEK_MODEL },
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ summary: "", points: [], model: DEEPSEEK_MODEL })));
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

describe("interpretRequest — server-side DeepSeek interpretation", () => {
  const serverPayload = {
    ok: true,
    model: DEEPSEEK_MODEL,
    filters: { category: "dentists", location: "Austin, TX", requireEmail: true, quantity: 75 },
    summary: "Austin dentists with public emails.",
    notes: [],
  };

  it("returns the server's interpreted filters — the browser runs no AI itself", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(serverPayload));
    vi.stubGlobal("fetch", fetchMock);

    const { result, error } = await interpretRequest("ws-1", "dentists in Austin with emails");
    expect(error).toBeUndefined();
    expect(result?.filters.category).toBe("dentists");
    expect(result?.filters.requireEmail).toBe(true);
    expect(result?.filters.quantity).toBe(75);
    expect(result?.summary).toContain("Austin dentists");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/ai-interpret");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer caller-token" });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      workspaceId: "ws-1",
      request: "dentists in Austin with emails",
    });
    // Exactly one request: the interpretation happened on the server.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("re-clamps an over-limit quantity before it can reach the search form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      ...serverPayload,
      filters: { ...serverPayload.filters, quantity: 500 },
    })));
    const { result, error } = await interpretRequest("ws-1", "500 dentists in Austin");
    expect(error).toBeUndefined();
    expect(result?.filters.quantity).toBe(240);
  });

  it("surfaces gate failures precisely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Zybble AI isn't available on your current plan.", code: "ai_not_entitled" }, 403)));

    const { result, error } = await interpretRequest("ws-1", "dentists in Austin");
    expect(result).toBeUndefined();
    expect(error).toBe("Zybble AI isn't available on your current plan.");
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("surfaces a server-side interpretation failure verbatim", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "Zybble AI couldn't identify a business category. Try rephrasing.",
      code: "category_missing",
    }, 502)));

    const { result, error } = await interpretRequest("ws-1", "hello there");
    expect(result).toBeUndefined();
    expect(error).toBe("Zybble AI couldn't identify a business category. Try rephrasing.");
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload instead of fabricating filters", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, model: DEEPSEEK_MODEL, filters: { location: "Austin" } })));
    const { result, error } = await interpretRequest("ws-1", "dentists in Austin");
    expect(result).toBeUndefined();
    expect(error).toBe("Zybble AI couldn't identify a business category. Try rephrasing.");
  });

  it("falls back to the Edge Function when the route is missing (404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404, headers: { "content-type": "text/html" } })));
    h.invoke.mockResolvedValue({ data: serverPayload, error: null });

    const { result, error } = await interpretRequest("ws-1", "dentists in Austin");
    expect(error).toBeUndefined();
    expect(result?.filters.category).toBe("dentists");
    expect(h.invoke).toHaveBeenCalledWith("ai-interpret", expect.objectContaining({
      body: expect.objectContaining({ workspaceId: "ws-1", request: "dentists in Austin" }),
      headers: { Authorization: "Bearer caller-token" },
    }));
  });

  it("requires a session before any request", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const { result, error } = await interpretRequest("ws-1", "dentists in Austin");
    expect(result).toBeUndefined();
    expect(error).toBe("Your session expired — sign in again.");
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
