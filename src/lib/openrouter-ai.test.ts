// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_INTERPRET_LEADS,
  cleanInterpretResult,
  cleanServerInterpretation,
  extractJsonObject,
  sanitizeStreamText,
  streamAIChat,
} from "./openrouter-ai";

/**
 * The shared client-side AI helper. The browser never contacts an AI
 * provider directly: conversations POST to the same-origin Zybble backend
 * (/api/ai-chat — Zybble AI answering through the server-side OpenRouter
 * integration) and stream back as server-sent events. These tests pin the
 * SSE contract both AI surfaces rely on, the friendly-error mapping, and the
 * interpret-response validation the search form depends on.
 */

function sseResponse(frames: Array<Record<string, unknown> | "[DONE]">, status = 200) {
  const body = frames
    .map((frame) => (frame === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(frame)}\n\n`))
    .join("");
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonErrorResponse(payload: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sanitizeStreamText", () => {
  it("normalizes line endings and strips control characters", () => {
    const dirty = `a\r\nb\rc${String.fromCharCode(0)}d${String.fromCharCode(7)}e${String.fromCharCode(31)}f`;
    expect(sanitizeStreamText(dirty)).toBe("a\nb\ncdef");
  });
});

describe("streamAIChat — Zybble backend transport", () => {
  it("POSTs the conversation to the same-origin /api/ai-chat route and streams text deltas", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ text: "Hello" }, { text: " there" }, "[DONE]"]));
    vi.stubGlobal("fetch", fetchMock);

    const deltas: string[] = [];
    const full = await streamAIChat([{ role: "user", content: "hi" }], {
      onDelta: (delta) => deltas.push(delta),
    });

    expect(full).toBe("Hello there");
    expect(deltas).toEqual(["Hello", " there"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai-chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ role: "user", content: "hi" }],
    });
    // No OpenRouter key, origin, or Authorization header appears anywhere in
    // the request — the browser only ever talks to the same-origin backend.
    expect(JSON.stringify(init.headers ?? {})).not.toContain("openrouter.ai");
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("resolves from a single-frame reply and tolerates frames split across chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"text":"one an'));
        controller.enqueue(encoder.encode('d two"}\n\ndata: {"text":" three"}\n'));
        controller.enqueue(encoder.encode("\ndata: [DONE]\n\n"));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })),
    );
    await expect(streamAIChat([{ role: "user", content: "hi" }])).resolves.toBe("one and two three");
  });

  it("rejects with the curated server message on pre-stream errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonErrorResponse({ error: "Zybble AI is busy right now. Please try again shortly.", code: "rate_limited" }, 429)),
    );
    await expect(streamAIChat([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      name: "ZybbleAIError",
      message: "Zybble AI is busy right now. Please try again shortly.",
      code: "provider_error",
    });
  });

  it("never surfaces internal URLs or markup from server errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonErrorResponse({ error: "stack at https://openrouter.ai/internal\nat x.js:1" }, 500)),
    );
    await expect(streamAIChat([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      message: "Zybble AI couldn't complete that request. Please try again.",
    });
  });

  it("rejects on an in-stream error frame, discarding partial text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse([{ text: "partial" }, { error: "Zybble AI couldn't complete that request. Please try again." }, "[DONE]"])),
    );
    await expect(streamAIChat([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: "provider_error",
    });
  });

  it("rejects on an empty stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(["[DONE]"])));
    await expect(streamAIChat([{ role: "user", content: "hi" }])).rejects.toThrow(/empty response/i);
  });

  it("rejects on malformed stream frames", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("data: not-json\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );
    await expect(streamAIChat([{ role: "user", content: "hi" }])).rejects.toThrow(/malformed/i);
  });

  it("maps a dropped network call to an availability error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(streamAIChat([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: "ai_unavailable",
    });
  });
});

describe("cleanInterpretResult — the same clamps the server applies", () => {
  const base = {
    category: "dentists",
    location: "Austin",
    quantity: 100,
    minRating: "4",
    priceLevel: null,
    requireWebsite: true,
    requirePhone: false,
    requireEmail: false,
    openNow: false,
    summary: "Austin dentists with websites and strong ratings.",
    notes: [],
  };

  it(`keeps valid filters and clamps the quantity to the per-search maximum (${MAX_INTERPRET_LEADS})`, () => {
    const result = cleanInterpretResult({ ...base, quantity: 500 }, "Find 500 dentists in Austin");
    expect(result?.filters).toMatchObject({ category: "dentists", quantity: MAX_INTERPRET_LEADS });
  });

  it("accepts a numeric string quantity from the model", () => {
    const result = cleanInterpretResult({ ...base, quantity: "120" }, "Find 120 dentists");
    expect(result?.filters.quantity).toBe(120);
  });

  it("keeps an explicitly requested business size", () => {
    const result = cleanInterpretResult(
      { ...base, businessSize: "medium" },
      "Find medium-sized dentists in Austin",
    );
    expect(result?.filters).toMatchObject({ businessSize: "medium" });
  });

  it("drops a business size the user did not request", () => {
    const result = cleanInterpretResult(
      { ...base, businessSize: "enterprise" },
      "Find 100 dentists in Austin with websites and 4+ ratings",
    );
    expect(result?.filters).not.toHaveProperty("businessSize");
  });

  it("rejects filter values outside the allowed enums", () => {
    const result = cleanInterpretResult(
      { ...base, minRating: "2", priceLevel: "9" },
      "Find dentists in Austin",
    );
    expect(result?.filters).not.toHaveProperty("minRating");
    expect(result?.filters).not.toHaveProperty("priceLevel");
  });

  it("caps notes at two entries and truncates the summary", () => {
    const result = cleanInterpretResult(
      { ...base, summary: "s".repeat(400), notes: ["one", "two", "three"] },
      "Find dentists",
    );
    expect(result?.summary.length).toBe(240);
    expect(result?.notes).toEqual(["one", "two"]);
  });

  it("returns null when no usable category was produced", () => {
    expect(cleanInterpretResult({ ...base, category: "  " }, "hello")).toBeNull();
    expect(cleanInterpretResult({}, "hello")).toBeNull();
  });
});

describe("cleanServerInterpretation — the /api/ai-interpret response contract", () => {
  it("accepts the server payload shape and re-clamps it", () => {
    const result = cleanServerInterpretation(
      {
        ok: true,
        model: "deepseek/deepseek-v3.2",
        filters: { category: "dentists", location: "Austin, TX", quantity: 500 },
        summary: "Austin dentists.",
        notes: [],
      },
      "500 dentists in Austin",
    );
    expect(result?.filters).toMatchObject({ category: "dentists", quantity: MAX_INTERPRET_LEADS });
    expect(result?.summary).toBe("Austin dentists.");
  });

  it("rejects malformed and category-less payloads", () => {
    expect(cleanServerInterpretation(null, "x")).toBeNull();
    expect(cleanServerInterpretation({ ok: true }, "x")).toBeNull();
    expect(cleanServerInterpretation({ filters: { location: "Austin" } }, "x")).toBeNull();
    expect(cleanServerInterpretation(["not", "an", "object"], "x")).toBeNull();
  });
});

describe("extractJsonObject", () => {
  it("parses plain JSON", () => {
    expect(extractJsonObject('{"category":"dentists"}')).toEqual({ category: "dentists" });
  });

  it("parses JSON inside a markdown code fence", () => {
    expect(extractJsonObject('```json\n{"category":"dentists"}\n```')).toEqual({ category: "dentists" });
  });

  it("parses JSON surrounded by prose", () => {
    expect(extractJsonObject('Sure! Here it is:\n{"category":"dentists"}\nHope that helps.')).toEqual({
      category: "dentists",
    });
  });

  it("returns null for non-JSON and non-object replies", () => {
    expect(extractJsonObject("dentists in Austin")).toBeNull();
    expect(extractJsonObject('["not","an","object"]')).toBeNull();
    expect(extractJsonObject("")).toBeNull();
  });
});

describe("no browser OpenRouter dependency", () => {
  it("the module never reads a provider key or calls OpenRouter directly", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "src", "lib", "openrouter-ai.ts"), "utf8");
    // No environment access of any kind — the key can never be read here.
    expect(source).not.toContain("import.meta.env");
    expect(source).not.toContain("process.env");
    // No direct provider endpoint or credential header — only /api/ai-chat.
    expect(source).not.toContain("https://openrouter.ai");
    expect(source).not.toContain("Authorization");
    expect(source).not.toContain("Bearer");
  });
});
