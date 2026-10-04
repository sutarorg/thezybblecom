import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler, { ASSISTANT_MARKER } from "../ai-chat";
import { assistantSystemPrompt } from "../../src/assistant/prompt";

/**
 * Full-flow tests for POST /api/ai-chat — the server-side AI bridge the
 * landing-page assistant streams through. The browser sends only the
 * conversation; the route pins the shape to the product assistant, fixes the
 * model and token budget server-side, calls OpenRouter with OPENROUTER_API_KEY, and
 * transcodes upstream SSE into the browser's own event contract.
 */

const OPENROUTER_API_KEY = "sk-or-stub-openrouter-key";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "deepseek/deepseek-v3.2";

const OPENROUTER_VARS = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_API_BASE_URL"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of OPENROUTER_VARS) saved.set(name, process.env[name]);
  for (const name of OPENROUTER_VARS) delete process.env[name];
  process.env.OPENROUTER_API_KEY = OPENROUTER_API_KEY;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const name of OPENROUTER_VARS) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SYSTEM = `${ASSISTANT_MARKER}. Answer questions about Zybble using only the fact sheet.`;

function conversation(extraTurns: Array<{ role: string; content: string }> = []) {
  return {
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: "What is Zybble?" }, ...extraTurns],
  };
}

function sseBody(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function openRouterStreamSse(events: string[], status = 200) {
  return new Response(sseBody(events), {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

type OpenRouterBehavior = Response | ((call: { model: unknown; body: Record<string, unknown> }) => Response);

function installOpenRouterStub(behavior: OpenRouterBehavior) {
  const seen: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      expect(url).toBe(OPENROUTER_CHAT_URL);
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENROUTER_API_KEY}`);
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      expect(body.model).toBe(OPENROUTER_MODEL);
      seen.push(body);
      return typeof behavior === "function" ? behavior({ model: body.model, body }) : behavior;
    }),
  );
  return seen;
}

let testIpCounter = 0;

function createMockReqRes(options: {
  method?: string;
  body?: unknown;
  ip?: string;
  headers?: Record<string, string>;
}) {
  const ip = options.ip ?? `10.0.0.${++testIpCounter}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": ip,
    ...options.headers,
  };
  const req = {
    method: options.method ?? "POST",
    headers,
    body: options.body,
    on: () => req,
  } as unknown as IncomingMessage & { body?: unknown };

  const written: string[] = [];
  const responseHeaders: Record<string, string> = {};
  let jsonBody: unknown = null;
  let statusCode = 0;
  let ended = false;

  const res = {
    setHeader(key: string, value: string) {
      responseHeaders[key.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      jsonBody = body;
      return res;
    },
    write(chunk: string | Uint8Array) {
      written.push(String(chunk));
      return true;
    },
    end() {
      ended = true;
      return res;
    },
  } as unknown as ServerResponse & { status(code: number): any; json(body: unknown): void };

  // res.statusCode is assigned directly by the streaming path.
  const getStatus = () => (res.statusCode as unknown as number) || statusCode;
  return {
    req,
    res,
    getStatus,
    getJson: () => jsonBody,
    getWritten: () => written.join(""),
    getHeaders: () => responseHeaders,
    isEnded: () => ended,
  };
}

/** Parse the browser-facing SSE stream into discrete data frames. */
function framesOf(sse: string): Array<Record<string, unknown> | "[DONE]"> {
  return sse
    .split("\n\n")
    .map((event) => event.trim())
    .filter(Boolean)
    .map((event) => {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      return data === "[DONE]" ? "[DONE]" : (JSON.parse(data) as Record<string, unknown>);
    });
}

describe("POST /api/ai-chat — streaming contract", () => {
  it("streams a transcoded provider reply as {text} frames terminated by [DONE]", async () => {
    installOpenRouterStub(
      openRouterStreamSse([
        'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n',
        'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"Zybble finds businesses"}}]}\n\n',
        'data: {"id":"c1","choices":[{"index":0,"delta":{"content":" and turns them into leads."}}]}\n\n',
        'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const { req, res, getStatus, getWritten, getHeaders, isEnded } = createMockReqRes({ body: conversation() });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(getHeaders()["content-type"]).toContain("text/event-stream");
    expect(isEnded()).toBe(true);
    const frames = framesOf(getWritten());
    expect(frames.at(-1)).toBe("[DONE]");
    const text = frames
      .filter((f): f is Record<string, unknown> => f !== "[DONE]")
      .map((f) => String(f.text ?? ""))
      .join("");
    expect(text).toBe("Zybble finds businesses and turns them into leads.");
    // The OpenRouter wire format (ids, roles, finish reasons) never leaks through.
    expect(getWritten()).not.toContain("finish_reason");
    expect(getWritten()).not.toContain("chatcmpl");
    expect(getWritten()).not.toContain(OPENROUTER_API_KEY);
  });

  it("handles SSE frames split across network chunks", async () => {
    installOpenRouterStub(
      openRouterStreamSse([
        'data: {"choices":[{"delta":{"content":"Hel',
        'lo, "}}]}\n\ndata: {"choices":[{"delta":{"content":"world"}}]}\n',
        "\ndata: [DONE]\n\n",
      ]),
    );
    const { req, res, getWritten } = createMockReqRes({ body: conversation() });
    await handler(req, res);
    const frames = framesOf(getWritten());
    const text = frames
      .filter((f): f is Record<string, unknown> => f !== "[DONE]")
      .map((f) => String(f.text ?? ""))
      .join("");
    expect(text).toBe("Hello, world");
  });

  it("emits a buffered JSON completion as a single text frame when the gateway ignores stream", async () => {
    installOpenRouterStub(
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "One-shot answer." } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { req, res, getStatus, getWritten } = createMockReqRes({ body: conversation() });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    const frames = framesOf(getWritten());
    expect(frames).toEqual([{ text: "One-shot answer." }, "[DONE]"]);
  });

  it("surfaces a mid-stream provider error as an error frame, then DONE", async () => {
    installOpenRouterStub(
      openRouterStreamSse([
        'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
        'data: {"error":{"message":"model overloaded with internal detail"}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const { req, res, getWritten } = createMockReqRes({ body: conversation() });
    await handler(req, res);
    const frames = framesOf(getWritten());
    expect(frames[0]).toEqual({ text: "Partial" });
    expect(frames[1]).toHaveProperty("error");
    // Upstream internals are never forwarded verbatim.
    expect(JSON.stringify(frames)).not.toContain("internal detail");
    expect(frames.at(-1)).toBe("[DONE]");
  });

  it("reports an upstream stream with no text as an empty response", async () => {
    installOpenRouterStub(openRouterStreamSse(['data: {"choices":[{"delta":{}}]}\n\n', "data: [DONE]\n\n"]));
    const { req, res, getWritten } = createMockReqRes({ body: conversation() });
    await handler(req, res);
    const frames = framesOf(getWritten());
    expect(frames[0]).toEqual({ error: "Zybble AI returned an empty response. Please try again." });
    expect(frames.at(-1)).toBe("[DONE]");
  });

  it("maps pre-stream provider failures to JSON errors with safe statuses", async () => {
    installOpenRouterStub(new Response("unauthorized", { status: 401 }));
    const { req, res, getStatus, getJson } = createMockReqRes({ body: conversation() });
    await handler(req, res);
    expect(getStatus()).toBe(502);
    expect(getJson()).toMatchObject({ code: "provider_auth" });
  });

  it("reports missing OPENROUTER_API_KEY as an actionable 500 without any secret", async () => {
    delete process.env.OPENROUTER_API_KEY;
    installOpenRouterStub(new Response("unused", { status: 200 }));
    const { req, res, getStatus, getJson } = createMockReqRes({ body: conversation() });
    await handler(req, res);
    expect(getStatus()).toBe(500);
    const body = getJson() as { error: string; code: string };
    expect(body.code).toBe("missing_key");
    expect(body.error).toContain("OPENROUTER_API_KEY");
    expect(body.error).not.toContain(OPENROUTER_API_KEY);
  });
});

describe("POST /api/ai-chat — request policy", () => {
  beforeEach(() => {
    installOpenRouterStub(openRouterStreamSse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', "data: [DONE]\n\n"]));
  });

  it("rejects non-POST requests", async () => {
    const { req, res, getStatus, getJson } = createMockReqRes({ method: "GET", body: conversation() });
    await handler(req, res);
    expect(getStatus()).toBe(405);
    expect(getJson()).toMatchObject({ code: "method_not_allowed" });
  });

  it("rejects a missing body and malformed conversation shapes", async () => {
    const missing = createMockReqRes({ body: null });
    await handler(missing.req, missing.res);
    expect(missing.getStatus()).toBe(400);

    const empty = createMockReqRes({ body: { messages: [] } });
    await handler(empty.req, empty.res);
    expect(empty.getStatus()).toBe(400);

    const noUser = createMockReqRes({ body: { messages: [{ role: "system", content: SYSTEM }] } });
    await handler(noUser.req, noUser.res);
    expect(noUser.getStatus()).toBe(400);
  });

  it("pins the proxy to the product assistant via the system-prompt marker", async () => {
    const foreign = createMockReqRes({
      body: { messages: [{ role: "system", content: "You are a general-purpose assistant." }, { role: "user", content: "hi" }] },
    });
    await handler(foreign.req, foreign.res);
    expect(foreign.getStatus()).toBe(400);

    const noSystem = createMockReqRes({ body: { messages: [{ role: "user", content: "hi" }] } });
    await handler(noSystem.req, noSystem.res);
    expect(noSystem.getStatus()).toBe(400);
  });

  it("enforces message-count and character caps", async () => {
    const many = createMockReqRes({
      body: {
        messages: [
          { role: "system", content: SYSTEM },
          ...Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i}` })),
        ],
      },
    });
    await handler(many.req, many.res);
    expect(many.getStatus()).toBe(400);

    const long = createMockReqRes({
      body: { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: "x".repeat(5_000) }] },
    });
    await handler(long.req, long.res);
    expect(long.getStatus()).toBe(400);
  });

  it("never forwards client-supplied model or tuning parameters to the provider", async () => {
    const seen = installOpenRouterStub(openRouterStreamSse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', "data: [DONE]\n\n"]));
    const { req, res } = createMockReqRes({
      body: { ...conversation(), model: "gpt-5", temperature: 0, max_tokens: 999_999 },
    });
    await handler(req, res);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.model).toBe(OPENROUTER_MODEL);
    expect(seen[0]!).not.toHaveProperty("temperature");
    expect(seen[0]!.max_tokens).toBe(1_200); // fixed server-side budget
  });

  it("accepts the real, fully-built assistant fact sheet as the system message (regression: the knowledge base must always fit under the server's per-message cap)", async () => {
    const realSystemPrompt = assistantSystemPrompt();
    expect(realSystemPrompt).toContain(ASSISTANT_MARKER);
    const { req, res, getStatus } = createMockReqRes({
      body: { messages: [{ role: "system", content: realSystemPrompt }, { role: "user", content: "What is Zybble?" }] },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
  });

  it("rate-limits a single source after the per-window allowance", async () => {
    const ip = "10.9.9.9";
    let last: ReturnType<typeof createMockReqRes> | null = null;
    for (let i = 0; i < 20; i++) {
      last = createMockReqRes({ body: conversation(), ip });
      await handler(last.req, last.res);
      expect(last.getStatus()).toBe(200);
    }
    last = createMockReqRes({ body: conversation(), ip });
    await handler(last.req, last.res);
    expect(last.getStatus()).toBe(429);
    expect(last.getJson()).toMatchObject({ code: "rate_limited" });
  });
});

describe("assistant marker sync", () => {
  it("matches the system prompt the landing page builds", () => {
    const promptSource = readFileSync(resolve(process.cwd(), "src", "assistant", "prompt.ts"), "utf8");
    expect(promptSource).toContain("ASSISTANT_MARKER");
    // The exported marker must open the assistant system prompt built in src.
    const line = promptSource
      .split("\n")
      .find((l) => l.includes("export const ASSISTANT_MARKER"));
    expect(line).toBeDefined();
    const value = line!.match(/ASSISTANT_MARKER\s*=\s*'([^']+)'/)?.[1];
    expect(value).toBe(ASSISTANT_MARKER);
  });
});
