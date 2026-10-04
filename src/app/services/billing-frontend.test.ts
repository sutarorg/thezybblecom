import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Billing request-path tests.
 *
 * Billing now prefers the same-origin Vercel function (`/api/billing`) so the
 * browser does not have to call the Supabase Edge Function cross-origin for
 * money-moving actions. Deployments that have not picked up that route yet
 * still fall back to the existing `billing` Edge Function. These tests pin
 * down:
 *   1. The same-origin route receives the caller token and action payload.
 *   2. A missing same-origin route safely falls back to the Edge Function.
 *   3. Config errors from the route are kept actionable if the Edge fallback
 *      is also unavailable.
 *   4. An unreachable/undeployed Edge Function still produces plain-language
 *      copy, never raw Supabase SDK/deployment wording.
 *   5. A missing session short-circuits before any network call.
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

import { cancelSubscription, startCheckout, syncBilling, verifyCheckout } from "./api";

const SESSION = { data: { session: { access_token: "caller-token", user: { id: "u1" } } } };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function routeMissingResponse() {
  return new Response("<html>not found</html>", { status: 404, headers: { "content-type": "text/html" } });
}

function mockRouteMissing() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(routeMissingResponse()));
}

beforeEach(() => {
  h.getSession.mockReset().mockResolvedValue(SESSION);
  h.invoke.mockReset();
  mockRouteMissing();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CHECKOUT_PAYLOAD = {
  keyId: "rzp_test_public",
  subscriptionId: "sub_route",
  planId: "growth",
  planLabel: "Growth",
  amount: 4900,
  currency: "INR",
  name: "Zybble",
  description: "Growth plan · monthly",
  prefill: { email: "founder@zybble.com" },
  method: { card: true, wallet: true, upi: false },
  notes: { user_id: "u1", plan: "growth" },
  themeColor: "#0e7a52",
};

describe("startCheckout", () => {
  it("uses the same-origin billing route first and forwards the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CHECKOUT_PAYLOAD));
    vi.stubGlobal("fetch", fetchMock);

    const { session, error } = await startCheckout("growth");
    expect(error).toBeUndefined();
    expect(session?.subscriptionId).toBe("sub_route");
    expect(session?.keyId).toBe("rzp_test_public");
    expect(session?.currency).toBe("INR");
    expect(fetchMock).toHaveBeenCalledWith("/api/billing", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer caller-token" }),
      body: JSON.stringify({ action: "checkout", plan: "growth" }),
    }));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("never exposes a Razorpay hosted-page URL to the browser", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      ...CHECKOUT_PAYLOAD,
      // Even if a server were to leak these, the typed session must not carry
      // them: there is nothing for the UI to redirect to.
      short_url: "https://rzp.io/i/abc",
      auth_link: "https://api.razorpay.com/v1/l/subscriptions/sub_route",
    })));

    const { session } = await startCheckout("growth");
    expect(session).toBeTruthy();
    expect(JSON.stringify(session)).not.toContain("rzp.io");
    expect(JSON.stringify(session)).not.toContain("/v1/l/");
    expect(session).not.toHaveProperty("url");
  });

  it("falls back to the Edge Function when the same-origin billing route is missing", async () => {
    h.invoke.mockResolvedValue({ data: { ...CHECKOUT_PAYLOAD, subscriptionId: "sub_edge" }, error: null });

    const { session, error } = await startCheckout("growth");
    expect(error).toBeUndefined();
    expect(session?.subscriptionId).toBe("sub_edge");
    expect(h.invoke).toHaveBeenCalledWith("billing", {
      body: { action: "checkout", plan: "growth" },
      headers: { Authorization: "Bearer caller-token" },
    });
  });

  it("surfaces an application error returned by the same-origin route without falling back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "That plan doesn't exist." }, 400)));
    const { session, error } = await startCheckout("growth");
    expect(session).toBeUndefined();
    expect(error).toBe("That plan doesn't exist.");
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("keeps route config errors actionable when the Edge fallback is also unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "Razorpay isn't configured on the billing server. Missing server environment variable: RAZORPAY_KEY_ID.",
      code: "billing_config",
    }, 500)));
    h.invoke.mockResolvedValue({ data: null, error: { message: "Failed to send a request to the Edge Function" } });

    const { error } = await startCheckout("growth");
    expect(error).toContain("RAZORPAY_KEY_ID");
    expect(error).not.toContain("Edge Function");
  });

  it("never reports success without a usable checkout payload", async () => {
    h.invoke.mockResolvedValue({ data: {}, error: null });
    const { session, error } = await startCheckout("growth");
    expect(session).toBeUndefined();
    expect(error).toBe("The payment provider didn't return a usable checkout. Please try again.");
  });

  it("rejects a checkout payload that is missing the public key id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...CHECKOUT_PAYLOAD, keyId: "" })));
    const { session, error } = await startCheckout("growth");
    expect(session).toBeUndefined();
    expect(error).toContain("didn't return a usable checkout");
  });

  it("replaces an unreachable Edge Function error with an actionable, non-technical message", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: { message: "Failed to send a request to the Edge Function" },
    });
    const { session, error } = await startCheckout("growth");
    expect(session).toBeUndefined();
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

  it("requires a session before calling any billing server", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const { error } = await startCheckout("growth");
    expect(error).toBe("Your session expired — sign in again.");
    expect(fetch).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
  });
});

describe("verifyCheckout", () => {
  const RESULT = {
    razorpay_payment_id: "pay_123",
    razorpay_subscription_id: "sub_123",
    razorpay_signature: "deadbeef",
  };

  it("sends the Razorpay callback to the server for verification", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, planId: "growth", status: "active" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyCheckout(RESULT);
    expect(result).toEqual({ planId: "growth", status: "active" });
    expect(fetchMock).toHaveBeenCalledWith("/api/billing", expect.objectContaining({
      body: JSON.stringify({ action: "verify", ...RESULT }),
    }));
  });

  it("surfaces a verification failure instead of pretending the plan changed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "We couldn't verify that payment. Nothing was changed on your account.",
      code: "signature_invalid",
    }, 400)));
    const result = await verifyCheckout(RESULT);
    expect(result.planId).toBeUndefined();
    expect(result.error).toContain("couldn't verify that payment");
  });

  it("requires a session", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const result = await verifyCheckout(RESULT);
    expect(result.error).toBe("Your session expired — sign in again.");
  });
});

describe("cancelSubscription", () => {
  it("uses the same-origin billing route with the cancel action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { ok, error } = await cancelSubscription();
    expect(error).toBeUndefined();
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/billing", expect.objectContaining({
      body: JSON.stringify({ action: "cancel" }),
    }));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("falls back to the Edge Function with the cancel action", async () => {
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
  it("resolves ok from the same-origin route without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, status: "active" })));
    await expect(syncBilling()).resolves.toEqual({ ok: true });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("falls back to the Edge Function for sync", async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, status: "active" }, error: null });
    await expect(syncBilling()).resolves.toEqual({ ok: true });
    expect(h.invoke).toHaveBeenCalledWith("billing", {
      body: { action: "sync" },
      headers: { Authorization: "Bearer caller-token" },
    });
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

  it("requires a session before calling any billing server", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const result = await syncBilling();
    expect(result).toEqual({ ok: false, error: "Your session expired — sign in again." });
    expect(fetch).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
