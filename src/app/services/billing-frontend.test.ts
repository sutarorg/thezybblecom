import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Billing request-path tests.
 *
 * Billing prefers the same-origin Vercel function (`/api/billing`) so the
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
 *   6. checkout/upgrade/sync/cancel map onto the Paddle action contract.
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

import { cancelSubscription, completeCheckout, startCheckout, syncBilling, upgradePlan } from "./api";

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
  checkoutToken: "a".repeat(48),
  priceId: "pri_growth_1",
  planId: "growth",
  planLabel: "Growth",
  amount: 4900,
  currency: "USD",
  description: "Growth plan · monthly",
  customerEmail: "founder@zybble.com",
  environment: "production",
};

describe("startCheckout", () => {
  it("uses the same-origin billing route first and forwards the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CHECKOUT_PAYLOAD));
    vi.stubGlobal("fetch", fetchMock);

    const { intent, error } = await startCheckout("growth");
    expect(error).toBeUndefined();
    expect(intent?.priceId).toBe("pri_growth_1");
    expect(intent?.checkoutToken).toBe("a".repeat(48));
    expect(intent?.currency).toBe("USD");
    expect(intent?.environment).toBe("production");
    expect(fetchMock).toHaveBeenCalledWith("/api/billing", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer caller-token" }),
      body: JSON.stringify({ action: "checkout", plan: "growth" }),
    }));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("carries only browser-safe values: the PUBLIC price id and checkout token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      ...CHECKOUT_PAYLOAD,
      // Even if a server were to leak these, the typed intent must not carry
      // them: the browser never gets (or needs) server credentials.
      apiKey: "pdl_srbx_live_secret",
      PADDLE_API_KEY: "pdl_srbx_live_secret",
      webhookSecret: "pdl_ntfset_live_secret",
    })));

    const { intent } = await startCheckout("growth");
    expect(intent).toBeTruthy();
    const serialized = JSON.stringify(intent);
    expect(serialized).not.toContain("pdl_srbx");
    expect(serialized).not.toContain("ntfset");
    expect(intent).not.toHaveProperty("apiKey");
    expect(intent).not.toHaveProperty("webhookSecret");
    // The PUBLIC pri_ price id is fine — that's the one thing the browser opens.
    expect(serialized).toContain("pri_growth_1");
  });

  it("falls back to the Edge Function when the same-origin billing route is missing", async () => {
    h.invoke.mockResolvedValue({ data: { ...CHECKOUT_PAYLOAD, checkoutToken: "b".repeat(48) }, error: null });

    const { intent, error } = await startCheckout("growth");
    expect(error).toBeUndefined();
    expect(intent?.checkoutToken).toBe("b".repeat(48));
    expect(h.invoke).toHaveBeenCalledWith("billing", {
      body: { action: "checkout", plan: "growth" },
      headers: { Authorization: "Bearer caller-token" },
    });
  });

  it("surfaces an application error returned by the same-origin route without falling back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "That plan doesn't exist." }, 400)));
    const { intent, error } = await startCheckout("growth");
    expect(intent).toBeUndefined();
    expect(error).toBe("That plan doesn't exist.");
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("keeps route config errors actionable when the Edge fallback is also unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "Paddle isn't configured on the billing server. Missing server environment variable: PADDLE_API_KEY.",
      code: "billing_config",
    }, 500)));
    h.invoke.mockResolvedValue({ data: null, error: { message: "Failed to send a request to the Edge Function" } });

    const { error } = await startCheckout("growth");
    expect(error).toContain("PADDLE_API_KEY");
    expect(error).not.toContain("Edge Function");
  });

  it("never reports success without a usable checkout payload", async () => {
    h.invoke.mockResolvedValue({ data: {}, error: null });
    const { intent, error } = await startCheckout("growth");
    expect(intent).toBeUndefined();
    expect(error).toBe("The payment provider didn't return a usable checkout. Please try again.");
  });

  it("rejects a checkout payload that is missing the price id or token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...CHECKOUT_PAYLOAD, priceId: "" })));
    const { intent, error } = await startCheckout("growth");
    expect(intent).toBeUndefined();
    expect(error).toContain("didn't return a usable checkout");
  });

  it("replaces an unreachable Edge Function error with an actionable, non-technical message", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: { message: "Failed to send a request to the Edge Function" },
    });
    const { intent, error } = await startCheckout("growth");
    expect(intent).toBeUndefined();
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

describe("upgradePlan", () => {
  it("sends the upgrade action for the next plan on the ladder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, planId: "agency", status: "active" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await upgradePlan("agency");
    expect(result).toEqual({ planId: "agency", status: "active" });
    expect(fetchMock).toHaveBeenCalledWith("/api/billing", expect.objectContaining({
      body: JSON.stringify({ action: "upgrade", plan: "agency" }),
    }));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("surfaces a ladder violation instead of pretending the plan changed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "Upgrade one step at a time — from the Growth plan the next plan is Agency.",
      code: "plan_not_next",
    }, 400)));
    const result = await upgradePlan("scale");
    expect(result.planId).toBeUndefined();
    expect(result.error).toContain("one step at a time");
  });

  it("requires a session", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const result = await upgradePlan("agency");
    expect(result.error).toBe("Your session expired — sign in again.");
  });
});

describe("completeCheckout (server-side verification after Paddle Checkout)", () => {
  it("hands the transaction id to the SERVER for verification — never grants locally", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, planId: "growth", status: "active" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeCheckout("txn_123");
    expect(result).toEqual({ planId: "growth", status: "active" });
    expect(fetchMock).toHaveBeenCalledWith("/api/billing", expect.objectContaining({
      body: JSON.stringify({ action: "sync", transactionId: "txn_123" }),
    }));
  });

  it("surfaces a verification failure instead of pretending the plan changed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "That payment doesn't belong to your account.",
      code: "checkout_mismatch",
    }, 403)));
    const result = await completeCheckout("txn_123");
    expect(result.planId).toBeUndefined();
    expect(result.error).toContain("doesn't belong to your account");
  });

  it("requires a session", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const result = await completeCheckout("txn_123");
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
