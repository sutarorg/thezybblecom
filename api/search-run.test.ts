import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, pageResults, serpApiMaps } from "./search-run";

afterEach(() => vi.unstubAllGlobals());

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
