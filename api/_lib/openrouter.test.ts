import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenRouterError,
  completionMessageText,
  getOpenRouterBaseUrl,
  getOpenRouterModel,
  isOpenRouterQuotaError,
  openRouterChatJson,
  openRouterChatStream,
  streamChunkDelta,
} from "./openrouter";

/**
 * The server-side OpenRouter client (DeepSeek via the OpenAI-compatible
 * endpoint). These tests pin the taxonomy every AI route relies on:
 * auth/quota/rate-limit classification, the transient-retry policy, response
 * extraction, and the guarantee that OPENROUTER_API_KEY is read only from the
 * server env and never leaks into errors.
 */

const options = {
  messages: [
    { role: "system" as const, content: "Return JSON." },
    { role: "user" as const, content: "Test input" },
  ],
};

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

const ENV_VARS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "OPENROUTER_API_BASE_URL",
  "OPENROUTER_HTTP_REFERER",
  "OPENROUTER_X_TITLE",
] as const;
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

describe("OpenRouter server client — configuration", () => {
  it("fails clearly when OPENROUTER_API_KEY is missing, naming only the variable", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(openRouterChatJson(options)).rejects.toMatchObject<Partial<OpenRouterError>>({
      status: 500,
      code: "missing_key",
    });
    const error: unknown = await openRouterChatJson(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect((error as OpenRouterError).message).toContain("OPENROUTER_API_KEY");
    expect((error as OpenRouterError).message).not.toContain("Bearer");
  });

  it("defaults to DeepSeek V3.2 and honors OPENROUTER_MODEL", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    delete process.env.OPENROUTER_MODEL;
    expect(getOpenRouterModel()).toBe("deepseek/deepseek-v3.2");
    process.env.OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
    expect(getOpenRouterModel()).toBe("deepseek/deepseek-v4-flash");
  });

  it("targets OpenRouter's OpenAI-compatible chat completions endpoint", () => {
    delete process.env.OPENROUTER_API_BASE_URL;
    expect(getOpenRouterBaseUrl()).toBe("https://openrouter.ai/api/v1");
    process.env.OPENROUTER_API_BASE_URL = "https://openrouter-proxy.example.test/v1/";
    expect(getOpenRouterBaseUrl()).toBe("https://openrouter-proxy.example.test/v1");
  });

  it("sends the server key, the configured model, and the attribution headers", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    process.env.OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
    const fetchMock = vi.fn().mockResolvedValue(completion("hello"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openRouterChatJson(options)).resolves.toBe("hello");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_CHAT_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["HTTP-Referer"]).toBe("https://zybble.com");
    expect(headers["X-Title"]).toBe("Zybble");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe("deepseek/deepseek-v4-flash");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual(options.messages);
  });

  it("honors configured attribution header overrides", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    process.env.OPENROUTER_HTTP_REFERER = "https://staging.zybble.com";
    process.env.OPENROUTER_X_TITLE = "Zybble Staging";
    const fetchMock = vi.fn().mockResolvedValue(completion("hello"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openRouterChatJson(options)).resolves.toBe("hello");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["HTTP-Referer"]).toBe("https://staging.zybble.com");
    expect(headers["X-Title"]).toBe("Zybble Staging");
  });
});

describe("OpenRouter server client — response extraction", () => {
  it("parses the standard chat.completion message shape", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion("the answer")));
    await expect(openRouterChatJson(options)).resolves.toBe("the answer");
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
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 })));
    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: 502, code: "empty_response" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion("   ")));
    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: 502, code: "empty_response" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: 502, code: "empty_response" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: 502, code: "malformed_response" });
    vi.restoreAllMocks();
  });

  it("maps an error body returned with HTTP 200 exactly like its status", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "exceeded your current quota" } }), { status: 200 }),
      ),
    );
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: 502, code: "provider_quota" });
    // Quota is a billing condition — never retried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("OpenRouter server client — provider error taxonomy", () => {
  it.each([
    [401, 502, "provider_auth", "The AI provider rejected the server credentials."],
    [403, 502, "provider_auth", "The AI provider rejected the server credentials."],
    [429, 429, "rate_limited", "Zybble AI is rate-limited. Please try again shortly."],
    [500, 502, "provider_unavailable", "Zybble AI is temporarily unavailable. Please try again shortly."],
    [502, 502, "provider_unavailable", "Zybble AI is temporarily unavailable. Please try again shortly."],
    [503, 502, "provider_unavailable", "Zybble AI is temporarily unavailable. Please try again shortly."],
  ])("maps provider status %s safely", async (status, expectedStatus, code, message) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider body", { status })));
    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: expectedStatus, code, message });
    vi.restoreAllMocks();
  });

  it("classifies a 402 as a credit/billing failure, never a retryable rate limit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "ERR::INSUFFICIENT_CREDITS", message: "Insufficient credits: add more credits and try again" } }),
        { status: 402 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error: unknown = await openRouterChatJson(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error).toMatchObject({ status: 502, code: "provider_quota" });
    expect((error as OpenRouterError).message).toContain("usage quota");
    expect((error as OpenRouterError).message).not.toContain("rate-limited");
    // Credit exhaustion is final — the client must not burn retries on it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("classifies a 429 carrying insufficient_quota as a billing failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota" } }),
          { status: 429 },
        ),
      ),
    );
    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: 502, code: "provider_quota" });
    vi.restoreAllMocks();
  });

  it("reports an unavailable model with the OPENROUTER_MODEL configuration hint", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    // Fresh Response per call: openRouterChatJson is invoked twice below, and a
    // Response body can only be consumed once.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "ERR::MODEL_NOT_FOUND", message: "The model does not exist" } }), { status: 404 }),
        ),
      ),
    );
    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: 502, code: "model_invalid" });
    const error: unknown = await openRouterChatJson(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect((error as OpenRouterError).message).toContain("OPENROUTER_MODEL");
    vi.restoreAllMocks();
  });

  it("maps network and timeout failures", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    await expect(openRouterChatJson({ ...options, timeoutMs: 10 })).rejects.toMatchObject({ status: 504, code: "provider_timeout" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: 502, code: "provider_network" });
    vi.restoreAllMocks();
  });

  it("detects quota conditions from codes, types, and messages", () => {
    expect(isOpenRouterQuotaError({ code: "insufficient_quota", type: "", message: "" })).toBe(true);
    expect(isOpenRouterQuotaError({ code: "err::insufficient_credits", type: "", message: "" })).toBe(true);
    expect(isOpenRouterQuotaError({ code: "", type: "billing_hard_limit", message: "" })).toBe(true);
    expect(isOpenRouterQuotaError({ code: "", type: "", message: "insufficient credits remaining" })).toBe(true);
    expect(isOpenRouterQuotaError({ code: "", type: "", message: "insufficient balance for this request" })).toBe(true);
    expect(isOpenRouterQuotaError({ code: "rate_limit_exceeded", type: "", message: "slow down" })).toBe(false);
    expect(isOpenRouterQuotaError(null)).toBe(false);
  });
});

describe("OpenRouter server client — retry and resilience", () => {
  it("retries a transient 429 and succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(completion("recovered"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openRouterChatJson(options)).resolves.toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("retries a 5xx outage and a network blip before succeeding", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(completion("back"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openRouterChatJson(options)).resolves.toBe("back");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it("stops retrying and reports a persistent rate limit accurately", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it("never retries authentication failures", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openRouterChatJson(options)).rejects.toMatchObject({ status: 502, code: "provider_auth" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("OpenRouter server client — streaming", () => {
  it("returns the live 200 response for stream:true requests", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
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

    const response = await openRouterChatStream(options);
    expect(response.status).toBe(200);
    const request = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(request.stream).toBe(true);
    // The body was not consumed by the client — the caller owns the stream.
    await expect(response.text()).resolves.toContain('"delta"');
  });

  it("extracts streamed deltas and fails on upstream error frames", () => {
    expect(streamChunkDelta({ choices: [{ delta: { content: "Hello" } }] })).toBe("Hello");
    expect(streamChunkDelta({ choices: [{ delta: {} }] })).toBe("");
    expect(() => streamChunkDelta({ error: { message: "model overloaded" } })).toThrowError(OpenRouterError);
  });
});

describe("OpenRouter server client — secret hygiene", () => {
  it("never leaks the API key into any surfaced error message", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-super-secret-value";
    const failures = [
      new Response("unauthorized", { status: 401 }),
      new Response(JSON.stringify({ error: { code: "ERR::INSUFFICIENT_CREDITS", message: "no money" } }), { status: 402 }),
      new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
      new Response("boom", { status: 503 }),
      new Response("garbage", { status: 200 }),
    ];
    for (const failure of failures) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure));
      const error: unknown = await openRouterChatJson(options).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OpenRouterError);
      expect((error as OpenRouterError).message).not.toContain("sk-or-super-secret-value");
      expect((error as OpenRouterError).message).not.toContain("Bearer");
    }
    vi.restoreAllMocks();
  });
});
