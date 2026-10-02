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

  it("classifies platform HTML as fallback-safe without exposing it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = new Response("<!doctype html><title>Vercel Error</title>", {
      status: 504,
      headers: { "content-type": "text/html" },
    });
    const parsed = await parseApiResponse(response, "search");
    expect(parsed.shouldFallback).toBe(true);
    expect(parsed.error).toContain("took too long");
    expect(parsed.error).not.toContain("Vercel Error");
    vi.restoreAllMocks();
  });
});
