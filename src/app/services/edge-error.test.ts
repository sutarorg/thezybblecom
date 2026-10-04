import { afterEach, describe, expect, it, vi } from "vitest";
import { readBillingError, readFunctionError } from "./edge-error";

describe("Edge Function error parser", () => {
  it("reads a structured JSON error from a function response", async () => {
    const error = {
      name: "FunctionsHttpError",
      context: new Response(JSON.stringify({ error: "The AI service timed out.", code: "provider_timeout" }), {
        status: 504,
        headers: { "content-type": "application/json" },
      }),
    };
    await expect(readFunctionError(error, "ai-interpret", "AI")).resolves.toBe("The AI service timed out.");
  });

  it.each([
    [401, "Your session expired — sign in again."],
    [402, "The search service ran out of usage quota. An administrator must review the provider plan and billing before it works again."],
    [403, "You don't have access to complete that action."],
    [429, "The search service is busy or rate-limited. Please try again shortly."],
  ])("maps HTTP %s to a safe message", async (status, message) => {
    await expect(readFunctionError({ context: new Response("", { status }) }, "search-run", "search"))
      .resolves.toBe(message);
  });

  it("identifies an undeployed function", async () => {
    await expect(readFunctionError({ context: new Response("", { status: 404 }) }, "ai-analyze", "AI"))
      .resolves.toBe('The requested Edge Function "ai-analyze" is not deployed.');
  });

  it("replaces the opaque SDK network error with a useful deployment message", async () => {
    await expect(readFunctionError({ message: "Failed to send a request to the Edge Function" }, "search-run", "search"))
      .resolves.toContain('The requested Edge Function "search-run" couldn\'t be reached');
  });

  it("does not surface provider bodies, URLs, tokens, or HTML", async () => {
    await expect(readFunctionError({ message: "Bearer secret https://internal.example/error" }, "ai-analyze", "AI"))
      .resolves.toBe("The AI service couldn't complete that action. Please try again.");
    await expect(readFunctionError({ context: new Response("<!doctype html><body>Vercel stack</body>", { status: 500 }) }, "ai-analyze", "AI"))
      .resolves.toBe("The AI service couldn't complete that action. Please try again.");
  });
});

describe("readBillingError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces an unreachable-Edge-Function classification with plain, actionable copy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const message = await readBillingError({ message: "Failed to send a request to the Edge Function" }, "checkout");
    expect(message).toBe(
      "Billing is temporarily unavailable. Your plan and payment details are unaffected — please try again in a few minutes. If this keeps happening, contact support@zybble.com.",
    );
    expect(message).not.toMatch(/edge function/i);
    expect(message).not.toMatch(/deployed/i);
  });

  it("replaces an undeployed-function (404) classification the same way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const message = await readBillingError({ context: new Response("", { status: 404 }) }, "sync");
    expect(message).toContain("Billing is temporarily unavailable");
  });

  it("logs the technical classification for engineers without rendering it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await readBillingError({ message: "Failed to fetch" }, "cancel");
    expect(spy).toHaveBeenCalledWith(
      "billing request unreachable",
      expect.objectContaining({ action: "cancel", detail: expect.stringContaining("couldn't be reached") }),
    );
  });

  it("passes through a real application error (e.g. plan validation) unchanged", async () => {
    const message = await readBillingError(
      { context: new Response(JSON.stringify({ error: "That plan doesn't exist." }), { status: 400, headers: { "content-type": "application/json" } }) },
      "checkout",
    );
    expect(message).toBe("That plan doesn't exist.");
  });

  it("passes through an expired-session error unchanged", async () => {
    const message = await readBillingError({ context: new Response("", { status: 401 }) }, "cancel");
    expect(message).toBe("Your session expired — sign in again.");
  });
});
