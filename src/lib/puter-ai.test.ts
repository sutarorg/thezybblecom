// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PUTER_MODEL,
  PuterAIError,
  cleanInterpretResult,
  ensurePuter,
  extractJsonObject,
  interpretSearchRequest,
  sanitizeStreamText,
  streamPuterChat,
} from "./puter-ai";

/**
 * The shared client-side Puter AI helper (DeepSeek V3.2). These tests pin the
 * contract both AI surfaces rely on: streamed part.text handling, safe
 * parsing of model JSON, and the exact filter validation the server-side
 * interpreter used to enforce.
 */

function streamOf(parts: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) yield part;
    },
  };
}

beforeEach(() => {
  delete (window as { puter?: unknown }).puter;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sanitizeStreamText", () => {
  it("normalizes line endings and strips control characters", () => {
    expect(sanitizeStreamText("a\r\nb\rc\u0000d\u0007e\u001Ff")).toBe("a\nb\ncdef");
  });
});

describe("cleanInterpretResult — same clamps the server applied", () => {
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

  it("keeps valid filters and clamps the quantity to the per-search maximum", () => {
    const result = cleanInterpretResult({ ...base, quantity: 500 }, "Find 500 dentists in Austin");
    expect(result?.filters).toMatchObject({ category: "dentists", quantity: 240 });
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

describe("streamPuterChat", () => {
  it("streams part.text deltas through onDelta and resolves with the full text", async () => {
    const chat = vi.fn().mockResolvedValue(
      streamOf([{ text: "Hello" }, { type: "other" }, { text: " there" }, { text: "" }]),
    );
    (window as { puter?: unknown }).puter = { ai: { chat } };

    const deltas: string[] = [];
    const full = await streamPuterChat([{ role: "user", content: "hi" }], {
      onDelta: (delta) => deltas.push(delta),
    });

    expect(full).toBe("Hello there");
    expect(deltas).toEqual(["Hello", " there"]);
    expect(chat).toHaveBeenCalledWith([{ role: "user", content: "hi" }], {
      model: PUTER_MODEL,
      stream: true,
    });
  });

  it("falls back to a non-streamed completion shape", async () => {
    (window as { puter?: unknown }).puter = {
      ai: { chat: vi.fn().mockResolvedValue({ message: { content: "Instant answer." } }) },
    };
    const full = await streamPuterChat([{ role: "user", content: "hi" }]);
    expect(full).toBe("Instant answer.");
  });

  it("throws a friendly error when the provider rejects the call", async () => {
    (window as { puter?: unknown }).puter = {
      ai: { chat: vi.fn().mockRejectedValue(new Error("Permission denied by user")) },
    };
    await expect(streamPuterChat([{ role: "user", content: "hi" }])).rejects.toThrow(/Puter sign-in/);
  });

  it("throws on an empty stream", async () => {
    (window as { puter?: unknown }).puter = {
      ai: { chat: vi.fn().mockResolvedValue(streamOf([{ text: "" }, { type: "other" }])) },
    };
    await expect(streamPuterChat([{ role: "user", content: "hi" }])).rejects.toThrow(/empty response/i);
  });

  it("surfaces an error part from the stream", async () => {
    (window as { puter?: unknown }).puter = {
      ai: { chat: vi.fn().mockResolvedValue(streamOf([{ type: "error", message: "model overloaded" }])) },
    };
    await expect(streamPuterChat([{ role: "user", content: "hi" }])).rejects.toThrow(/model overloaded/);
  });

  it("times out when the stream stalls", async () => {
    (window as { puter?: unknown }).puter = {
      ai: {
        chat: vi.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            yield { text: "partial" };
            await new Promise(() => undefined); // never resolves
          },
        }),
      },
    };
    await expect(
      streamPuterChat([{ role: "user", content: "hi" }], { timeoutMs: 20 }),
    ).rejects.toThrow(/took too long/i);
  });
});

describe("interpretSearchRequest", () => {
  it("returns validated filters from the model's JSON", async () => {
    (window as { puter?: unknown }).puter = {
      ai: {
        chat: vi.fn().mockResolvedValue(
          streamOf([
            { text: '{"category":"dentists","location":"Austin, TX","quantity":' },
            { text: '100,"requireWebsite":true,"summary":"Austin dentists.","notes":[]}' },
          ]),
        ),
      },
    };
    const result = await interpretSearchRequest("100 dentists in Austin with websites");
    expect(result.filters).toEqual({ category: "dentists", location: "Austin, TX", quantity: 100, requireWebsite: true });
    expect(result.summary).toBe("Austin dentists.");
  });

  it("retries once when the first reply is not usable JSON", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(streamOf([{ text: "Sure — dentists sound great!" }]))
      .mockResolvedValueOnce(streamOf([{ text: '{"category":"dentists"}' }]));
    (window as { puter?: unknown }).puter = { ai: { chat } };

    const result = await interpretSearchRequest("dentists");
    expect(result.filters.category).toBe("dentists");
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("fails with a category error when the model never produces a category", async () => {
    (window as { puter?: unknown }).puter = {
      ai: { chat: vi.fn().mockResolvedValue(streamOf([{ text: '{"category":null}' }])) },
    };
    await expect(interpretSearchRequest("hello")).rejects.toThrow(/couldn't identify a business category/i);
  });
});

describe("ensurePuter", () => {
  it("resolves the global when Puter.js is present", async () => {
    const puter = { ai: { chat: vi.fn() } };
    (window as { puter?: unknown }).puter = puter;
    await expect(ensurePuter()).resolves.toBe(puter);
  });

  it("throws a friendly error when Puter.js cannot load", async () => {
    await expect(ensurePuter(170)).rejects.toThrow(PuterAIError);
    await expect(ensurePuter(170)).rejects.toThrow(/couldn't load/i);
  });
});
