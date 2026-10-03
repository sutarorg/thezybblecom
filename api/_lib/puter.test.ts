import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PuterError,
  completionMessageText,
  getPuterModel,
  isPuterQuotaError,
  puterChatJson,
  puterChatStream,
  streamChunkDelta,
} from "./puter";

/**
 * The server-side Puter client (DeepSeek via the OpenAI-compatible endpoint).
 * These tests pin the taxonomy every AI route relies on: auth/quota/rate-
 * limit classification, the transient-retry policy, response extraction, and
 * the guarantee that PUTER_AUTH_TOKEN is read only from the server env and
 * never leaks into errors.
 */

const options = {
  messages: [
    { role: "system" as const, content: "Return JSON." },
    { role: "user" as const, content: "Test input" },
  ],
};

const ENV_VARS = ["PUTER_AUTH_TOKEN", "PUTER_MODEL", "PUTER_API_BASE_URL"] as const;
const saved = new Map<string, string | undefined>();
for (const name of ENV_VARS) saved.set(name, process.env[name]);

function completion(text: string, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-stub",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const name of ENV_VARS) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("Puter server client — configuration", () => {
  it("fails clearly when PUTER_AUTH_TOKEN is missing, naming only the variable", async () => {
    delete process.env.PUTER_AUTH_TOKEN;
    await expect(puterChatJson(options)).rejects.toMatchObject<Partial<PuterError>>({
      status: 500,
      code: "missing_key",
    });
    const error: unknown = await puterChatJson(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PuterError);
    expect((error as PuterError).message).toContain("PUTER_AUTH_TOKEN");
    expect((error as PuterError).message).not.toContain("Bearer");
  });

  it("defaults to DeepSeek V3.2 and honors PUTER_MODEL", async () => {
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    delete process.env.PUTER_MODEL;
    expect(getPuterModel()).toBe("deepseek/deepseek-v3.2");
    process.env.PUTER_MODEL = "deepseek/deepseek-v4-flash";
    expect(getPuterModel()).toBe("deepseek/deepseek-v4-flash");
  });

  it("sends the server token and the configured model to the chat completions endpoint", async () => {
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    process.env.PUTER_MODEL = "deepseek/deepseek-v4-flash";
    const fetchMock = vi.fn().mockResolvedValue(completion("hello"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(puterChatJson(options)).resolves.toBe("hello");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.puter.com/puterai/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-puter-token");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe("deepseek/deepseek-v4-flash");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual(options.messages);
  });
});

describe("Puter server client — response extraction", () => {
  it("parses the standard chat.completion message shape", async () => {
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion("the answer")));
    await expect(puterChatJson(options)).resolves.toBe("the answer");
  });

  it("accepts content delivered as typed parts", () => {
    expect(
      completionMessageText({
        choices: [{ message: { content: [{ type: "text", text: "part one " }, { type: "text", text: "part two" }] } }],
      }),
    ).toBe("part one part two");
  });

  it("rejects blank and malformed completions", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 })));
    await expect(puterChatJson(options)).rejects.toMatchObject({ status: 502, code: "empty_response" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion("   ")));
    await expect(puterChatJson(options)).rejects.toMatchObject({ status: 502, code: "empty_response" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(puterChatJson(options)).rejects.toMatchObject({ status: 502, code: "malformed_response" });
    vi.restoreAllMocks();
  });

  it("maps an error body returned with HTTP 200 exactly like its status", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "exceeded your current quota" } }), { status: 200 }),
      ),
    );
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await expect(puterChatJson(options)).rejects.toMatchObject({ status: 502, code: "provider_quota" });
    // Quota is a billing condition — never retried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("Puter server client — provider error taxonomy", () => {
  it.each([
    [401, 502, "provider_auth", "The AI provider rejected the server credentials."],
    [403, 502, "provider_auth", "The AI provider rejected the server credentials."],
    [429, 429, "rate_limited", "Zybble AI is rate-limited. Please try again shortly."],
    [500, 502, "provider_unavailable", "Zybble AI is temporarily unavailable. Please try again shortly."],
    [503, 502, "provider_unavailable", "Zybble AI is temporarily unavailable. Please try again shortly."],
  ])("maps provider status %s safely", async (status, expectedStatus, code, message) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider body", { status })));
    await expect(puterChatJson(options)).rejects.toMatchObject({ status: expectedStatus, code, message });
    vi.restoreAllMocks();
  });

  it("classifies a 429 carrying insufficient_quota as a billing failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota" } }),
          { status: 429 },
        ),
      ),
    );
    await expect(puterChatJson(options)).rejects.toMatchObject({ status: 502, code: "provider_quota" });
    vi.restoreAllMocks();
  });

  it("reports an unavailable model with the PUTER_MODEL configuration hint", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    // Fresh Response per call: puterChatJson is invoked twice below, and a
    // Response body can only be consumed once.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "model_not_found", message: "The model does not exist" } }), { status: 404 }),
        ),
      ),
    );
    await expect(puterChatJson(options)).rejects.toMatchObject({ status: 502, code: "model_invalid" });
    const error: unknown = await puterChatJson(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PuterError);
    expect((error as PuterError).message).toContain("PUTER_MODEL");
    vi.restoreAllMocks();
  });

  it("maps network and timeout failures", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    await expect(puterChatJson({ ...options, timeoutMs: 10 })).rejects.toMatchObject({ status: 504, code: "provider_timeout" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(puterChatJson(options)).rejects.toMatchObject({ status: 502, code: "provider_network" });
    vi.restoreAllMocks();
  });

  it("detects quota conditions from codes, types, and messages", () => {
    expect(isPuterQuotaError({ code: "insufficient_quota", type: "", message: "" })).toBe(true);
    expect(isPuterQuotaError({ code: "", type: "billing_hard_limit", message: "" })).toBe(true);
    expect(isPuterQuotaError({ code: "", type: "", message: "insufficient credits remaining" })).toBe(true);
    expect(isPuterQuotaError({ code: "rate_limit_exceeded", type: "", message: "slow down" })).toBe(false);
    expect(isPuterQuotaError(null)).toBe(false);
  });
});

describe("Puter server client — retry and resilience", () => {
  it("retries a transient 429 and succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(completion("recovered"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(puterChatJson(options)).resolves.toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("retries a 5xx outage and a network blip before succeeding", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(completion("back"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(puterChatJson(options)).resolves.toBe("back");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it("stops retrying and reports a persistent rate limit accurately", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(puterChatJson(options)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it("never retries authentication failures", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(puterChatJson(options)).rejects.toMatchObject({ status: 502, code: "provider_auth" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("Puter server client — streaming", () => {
  it("returns the live 200 response for stream:true requests", async () => {
    process.env.PUTER_AUTH_TOKEN = "test-puter-token";
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await puterChatStream(options);
    expect(response.status).toBe(200);
    const request = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(request.stream).toBe(true);
    // The body was not consumed by the client — the caller owns the stream.
    await expect(response.text()).resolves.toContain('"delta"');
  });

  it("extracts streamed deltas and fails on upstream error frames", () => {
    expect(streamChunkDelta({ choices: [{ delta: { content: "Hello" } }] })).toBe("Hello");
    expect(streamChunkDelta({ choices: [{ delta: {} }] })).toBe("");
    expect(() => streamChunkDelta({ error: { message: "model overloaded" } })).toThrowError(PuterError);
  });
});
