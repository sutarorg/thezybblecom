import { describe, expect, it, vi } from "vitest";
import { parseApiResponse } from "./api-response";

describe("parseApiResponse", () => {
  it("parses JSON even when content-type is missing or incorrect", async () => {
    const response = new Response(JSON.stringify({ searchId: "search-1" }), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    await expect(parseApiResponse<{ searchId: string }>(response, "search")).resolves.toMatchObject({
      data: { searchId: "search-1" },
      shouldFallback: false,
    });
  });

  it("surfaces safe problem JSON errors and codes", async () => {
    const response = new Response(JSON.stringify({ detail: "The provider is rate-limited.", code: "rate_limited" }), {
      status: 429,
      headers: { "content-type": "application/problem+json" },
    });
    await expect(parseApiResponse(response, "search")).resolves.toEqual({
      error: "The provider is rate-limited.",
      code: "rate_limited",
      shouldFallback: false,
    });
  });

  it.each([
    [401, "Your session expired — sign in again."],
    [403, "You don't have access to complete that action."],
    [429, "The search service is busy or rate-limited. Please try again shortly."],
    [500, "The search service is temporarily unavailable. Please try again shortly."],
    [504, "The search service timed out. Please try again."],
  ])("maps HTTP %s without retrying a request that may have reached the provider", async (status, error) => {
    await expect(parseApiResponse(new Response("", { status }), "search")).resolves.toMatchObject({
      error,
      shouldFallback: false,
    });
  });

  it("classifies a missing JSON route as fallback-safe", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parsed = await parseApiResponse(new Response("Not found", { status: 404 }), "search");
    expect(parsed.shouldFallback).toBe(true);
    expect(parsed.error).toContain("route isn't available");
    vi.restoreAllMocks();
  });

  it("classifies platform HTML as a safe primary error, not a duplicate-search retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = new Response("<!doctype html><title>Vercel Error</title>", {
      status: 504,
      headers: { "content-type": "text/html" },
    });
    const parsed = await parseApiResponse(response, "search");
    expect(parsed.shouldFallback).toBe(false);
    expect(parsed.error).toContain("timed out");
    expect(parsed.error).not.toContain("Vercel Error");
    vi.restoreAllMocks();
  });

  it("surfaces a Vercel supabase_config error verbatim instead of falling back", async () => {
    // A 500 from a deployed /api/search-run is a real backend configuration
    // problem (missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY). The user must
    // see that actionable message — retrying via the Supabase Edge Function
    // would hide the root cause and mask the broken deployment.
    const message =
      "The search server isn't connected to Supabase. Missing server environment variables: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY). Add them in Vercel → Project → Settings → Environment Variables (Production, Preview, Development), then redeploy. VITE_SUPABASE_* variables are browser build values and cannot be used here.";
    const response = new Response(JSON.stringify({ error: message, code: "supabase_config" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    const parsed = await parseApiResponse(response, "search");
    expect(parsed.shouldFallback).toBe(false);
    expect(parsed.code).toBe("supabase_config");
    expect(parsed.error).toContain("Missing server environment variables: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY");
    expect(parsed.error).toContain("Vercel → Project → Settings → Environment Variables");
  });

  it("keeps the supabase_config message inside the browser-safe rendering contract", async () => {
    // safeMessage drops anything containing URLs, bearer tokens, or markup —
    // the server-side config errors must stay inside that contract so the
    // actionable variable names actually reach the UI.
    const message =
      "The search server isn't connected to Supabase. Missing server environment variable: SUPABASE_URL. Add it in Vercel → Project → Settings → Environment Variables (Production, Preview, Development), then redeploy.";
    const response = new Response(JSON.stringify({ error: message, code: "supabase_config" }), { status: 500 });
    const parsed = await parseApiResponse(response, "search");
    expect(parsed.error).toBe(message);
  });
});
