import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Billing request-path tests.
 *
 * Unlike search/AI/export/invite, billing is deliberately a Supabase Edge
 * Function-only path: checkout/sync/cancel must write authoritative
 * subscription state with the service-role key, which the Vercel `/api/*`
 * routes refuse to hold (see README "Architecture notes"). So there is no
 * same-origin fallback to test here — instead these tests pin down:
 *   1. The function invoked is exactly "billing" with the action in the body.
 *   2. The caller's access token is always forwarded explicitly.
 *   3. An unreachable/undeployed Edge Function produces a plain-language,
 *      actionable message — never the raw Supabase SDK wording, and never a
 *      silent swallow for sync.
 *   4. A missing session short-circuits before any network call.
 */

const h = vi.hoisted(() => {
  const getSession = vi.fn();
  const invoke = vi.fn();
  const client = { auth: { getSession }, functions: { invoke } };
  return { client, getSession, invoke };
});

vi.mock("./supabase", () => ({
  getSupabase: () => h.client,
  BACKEND_ENABLED: true,
}));

import { cancelSubscription, startCheckout, syncBilling } from "./api";

const SESSION = { data: { session: { access_token: "caller-token", user: { id: "u1" } } } };

beforeEach(() => {
  h.getSession.mockReset().mockResolvedValue(SESSION);
  h.invoke.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startCheckout", () => {
  it("invokes the billing function with the plan and forwards the bearer token", async () => {
    h.invoke.mockResolvedValue({ data: { url: "https://rzp.io/i/abc123", subscriptionId: "sub_1" }, error: null });

    const { url, error } = await startCheckout("growth");
    expect(error).toBeUndefined();
    expect(url).toBe("https://rzp.io/i/abc123");
    expect(h.invoke).toHaveBeenCalledWith("billing", {
      body: { action: "checkout", plan: "growth" },
      headers: { Authorization: "Bearer caller-token" },
    });
  });

  it("surfaces an application error returned by the function verbatim", async () => {
    h.invoke.mockResolvedValue({ data: { error: "That plan doesn't exist." }, error: null });
    const { url, error } = await startCheckout("growth");
    expect(url).toBeUndefined();
    expect(error).toBe("That plan doesn't exist.");
  });

  it("never reports success without a checkout URL", async () => {
    h.invoke.mockResolvedValue({ data: {}, error: null });
    const { url, error } = await startCheckout("growth");
    expect(url).toBeUndefined();
    expect(error).toBe("The payment provider didn't return a checkout link. Please try again.");
  });

  it("replaces an unreachable Edge Function error with an actionable, non-technical message", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: { message: "Failed to send a request to the Edge Function" },
    });
    const { url, error } = await startCheckout("growth");
    expect(url).toBeUndefined();
    expect(error).toContain("Billing is temporarily unavailable");
    expect(error).not.toContain("Edge Function");
    expect(error).not.toContain("deployed");
  });

  it("gives a clear message when the function is deployed but returns 404-shaped errors", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: { context: new Response("", { status: 404 }) },
    });
    const { error } = await startCheckout("growth");
    expect(error).toContain("Billing is temporarily unavailable");
  });

  it("keeps a precise, actionable message for a real auth failure (not generic)", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: { context: new Response("", { status: 401 }) },
    });
    const { error } = await startCheckout("growth");
    expect(error).toBe("Your session expired — sign in again.");
  });

  it("requires a session before calling the function", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const { error } = await startCheckout("growth");
    expect(error).toBe("Your session expired — sign in again.");
    expect(h.invoke).not.toHaveBeenCalled();
  });
});

describe("cancelSubscription", () => {
  it("invokes the billing function with the cancel action", async () => {
    h.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const { ok, error } = await cancelSubscription();
    expect(error).toBeUndefined();
    expect(ok).toBe(true);
    expect(h.invoke).toHaveBeenCalledWith("billing", {
      body: { action: "cancel" },
      headers: { Authorization: "Bearer caller-token" },
    });
  });

  it("surfaces a 404 no-active-subscription application error verbatim", async () => {
    h.invoke.mockResolvedValue({ data: { error: "You don't have an active paid subscription." }, error: null });
    const { error } = await cancelSubscription();
    expect(error).toBe("You don't have an active paid subscription.");
  });

  it("replaces an unreachable Edge Function error with an actionable message", async () => {
    h.invoke.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    const { error } = await cancelSubscription();
    expect(error).toContain("Billing is temporarily unavailable");
  });
});

describe("syncBilling", () => {
  it("resolves ok without throwing on success", async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, status: "active" }, error: null });
    await expect(syncBilling()).resolves.toEqual({ ok: true });
  });

  it("never throws, but reports an actionable error instead of swallowing it silently", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.invoke.mockResolvedValue({ data: null, error: { message: "Failed to send a request to the Edge Function" } });
    const result = await syncBilling();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Billing is temporarily unavailable");
  });

  it("reports a clear error when the SDK call itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.invoke.mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await syncBilling();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Billing is temporarily unavailable");
  });

  it("requires a session before calling the function", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const result = await syncBilling();
    expect(result).toEqual({ ok: false, error: "Your session expired — sign in again." });
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
