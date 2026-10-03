import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIError, openAIJson } from "./openai";

const options = {
  instructions: "Return JSON.",
  input: "Test input",
  schemaName: "test_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { value: { type: "string" } },
    required: ["value"],
  },
};

const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_MODEL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = originalModel;
});

describe("OpenAI server client", () => {
  it("fails clearly when the server key is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(openAIJson(options)).rejects.toMatchObject<Partial<OpenAIError>>({
      status: 500,
      code: "missing_key",
    });
  });

  it("uses the configured model and returns structured JSON", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "o4-mini";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ value: "ok" }),
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openAIJson(options)).resolves.toEqual({ value: "ok" });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.model).toBe("o4-mini");
    expect(request.text.format.type).toBe("json_schema");
  });

  it("parses the standard Responses API output array shape", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify({ value: "from-output-array" }) }] },
      ],
    }), { status: 200 })));
    await expect(openAIJson(options)).resolves.toEqual({ value: "from-output-array" });
  });

  it.each([
    [401, "provider_auth", "The AI provider rejected the server credentials."],
    [429, "rate_limited", "Zybble AI is rate-limited. Please try again shortly."],
    [500, "provider_unavailable", "Zybble AI is temporarily unavailable. Please try again shortly."],
  ])("maps provider status %s safely", async (status, code, message) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider body", { status })));
    await expect(openAIJson(options)).rejects.toMatchObject({ status: status === 401 || status >= 500 ? 502 : status, code, message });
    vi.restoreAllMocks();
  });

  it("maps timeout and malformed successful responses", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    await expect(openAIJson({ ...options, timeoutMs: 10 })).rejects.toMatchObject({ status: 504, code: "provider_unreachable" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(openAIJson(options)).rejects.toMatchObject({ status: 502, code: "malformed_response" });
    vi.restoreAllMocks();
  });
});

describe("OpenAI retry and resilience handling", () => {
  it("retries a transient 429 rate limit and succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify({ value: "recovered" }) }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openAIJson(options)).resolves.toEqual({ value: "recovered" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("retries a 5xx outage and a network blip before succeeding", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify({ value: "back" }) }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openAIJson(options)).resolves.toEqual({ value: "back" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it("stops retrying and reports a persistent rate limit accurately", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openAIJson(options)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      message: "Zybble AI is rate-limited. Please try again shortly.",
    });
    expect(fetchMock.mock.calls.length).toBe(3);
    vi.restoreAllMocks();
  });

  it("does not retry once the overall time budget is exhausted", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENAI_API_KEY = "test-key";
    vi.useFakeTimers();
    try {
      // Each attempt "hangs" longer than the entire retry budget, so after
      // the first failure there is no time left for another attempt.
      const fetchMock = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        throw new DOMException("timed out", "TimeoutError");
      });
      vi.stubGlobal("fetch", fetchMock);

      // Attach the rejection assertion before advancing the clock. Otherwise
      // Node can report the expected rejection as unhandled between ticks.
      const rejection = expect(openAIJson({ ...options, timeoutMs: 10 })).rejects.toMatchObject({
        status: 504,
        code: "provider_unreachable",
      });
      await vi.advanceTimersByTimeAsync(6_000);
      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("retries an instant provider timeout within the budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify({ value: "second try" }) }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openAIJson(options)).resolves.toEqual({ value: "second try" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("identifies an invalid configured model without leaking the API key", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENAI_API_KEY = "sk-test-secret-key";
    process.env.OPENAI_MODEL = "not-a-real-model";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "model_not_found", message: "The model 'not-a-real-model' does not exist" },
    }), { status: 404 })));

    const error = await openAIJson(options).catch((e: OpenAIError) => e);
    expect(error).toBeInstanceOf(OpenAIError);
    expect(error.code).toBe("model_invalid");
    expect(error.message).toContain("not-a-real-model");
    expect(error.message).toContain("OPENAI_MODEL");
    expect(error.message).not.toContain("sk-test-secret-key");
    vi.restoreAllMocks();
  });

  it("reports a truncated (max_output_tokens) response instead of returning empty JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
    }), { status: 200 })));

    await expect(openAIJson(options)).rejects.toMatchObject({
      status: 502,
      code: "empty_response",
      message: expect.stringContaining("truncated"),
    });
    vi.restoreAllMocks();
  });

  it("treats a 200 response carrying an error body as a failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Insufficient quota", code: "insufficient_quota", status: 429 },
    }), { status: 200 })));

    await expect(openAIJson(options)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
    vi.restoreAllMocks();
  });
});
