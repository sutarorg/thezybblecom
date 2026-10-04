import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler from "../ai-lead";

type MockRes = ServerResponse & { status(code: number): MockRes; json(body: unknown): void };

let ipCounter = 0;

function createMockReqRes(options: {
  method?: string;
  body?: unknown;
  ip?: string;
}) {
  const req = {
    method: options.method ?? "POST",
    headers: { "x-forwarded-for": options.ip ?? `10.0.0.${++ipCounter}` },
    body: options.body,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage & { body?: unknown };

  let statusCode = 200;
  let responseBody: unknown = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      responseBody = body;
    },
  } as unknown as MockRes;

  return { req, res, getStatus: () => statusCode, getBody: () => responseBody };
}

function mockUpstream(success = true) {
  const fetchMock = vi.fn(async () => ({
    ok: success,
    json: async () => ({ success }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Unique email per test so the in-module duplicate window never collides. */
function uniqueEmail() {
  return `Lead.${Date.now()}.${Math.random().toString(36).slice(2)}@Example.COM`;
}

describe("POST /api/ai-lead", () => {
  beforeEach(() => {
    mockUpstream(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects non-POST methods with 405", async () => {
    const { req, res, getStatus } = createMockReqRes({ method: "GET" });
    await handler(req, res);
    expect(getStatus()).toBe(405);
  });

  it("rejects a missing or malformed email with 400 and never calls the provider", async () => {
    const fetchMock = mockUpstream(true);
    for (const email of [undefined, "", "not-an-email", "a@b", "   "]) {
      const { req, res, getStatus } = createMockReqRes({ body: { email } });
      await handler(req, res);
      expect(getStatus()).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a valid lead, normalizes the email casing, and forwards attribution", async () => {
    const fetchMock = mockUpstream(true);
    const email = uniqueEmail();
    const { req, res, getStatus, getBody } = createMockReqRes({
      body: {
        email,
        page: "/",
        firstQuestion: "How does pricing work?",
        intent: "pricing",
        referrer: "https://www.google.com/",
        utmSource: "newsletter",
      },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      (fetchMock.mock.calls[0]! as unknown as [string, { body: string }])[1].body,
    ) as Record<string, string>;
    expect(payload.email).toBe(email.toLowerCase());
    expect(payload.source).toBe("zybble_ai");
    expect(payload.first_question).toBe("How does pricing work?");
    expect(payload.conversation_intent).toBe("pricing");
    expect(payload.utm_source).toBe("newsletter");
    expect(typeof payload.access_key).toBe("string");
    expect(payload.access_key.length).toBeGreaterThan(0);
  });

  it("treats a honeypot hit as success without forwarding", async () => {
    const fetchMock = mockUpstream(true);
    const { req, res, getStatus } = createMockReqRes({
      body: { email: uniqueEmail(), website: "https://spam.example" },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("absorbs duplicate submissions of the same email without re-forwarding", async () => {
    const fetchMock = mockUpstream(true);
    const email = uniqueEmail();
    const first = createMockReqRes({ body: { email } });
    await handler(first.req, first.res);
    const second = createMockReqRes({ body: { email } });
    await handler(second.req, second.res);
    expect(first.getStatus()).toBe(200);
    expect(second.getStatus()).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a safe 502 when the provider fails — no internals leaked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET upstream at 10.1.2.3");
      }),
    );
    const { req, res, getStatus, getBody } = createMockReqRes({ body: { email: uniqueEmail() } });
    await handler(req, res);
    expect(getStatus()).toBe(502);
    const body = getBody() as { error: string };
    expect(body.error).not.toMatch(/ECONNRESET|10\.1\.2\.3/);
  });

  it("rate-limits a single IP after repeated requests", async () => {
    mockUpstream(true);
    const ip = "198.51.100.77";
    let limited = false;
    for (let i = 0; i < 8; i++) {
      const { req, res, getStatus } = createMockReqRes({ body: { email: uniqueEmail() }, ip });
      await handler(req, res);
      if (getStatus() === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});
