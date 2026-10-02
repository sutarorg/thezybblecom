import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler from "./health";

function createMockReqRes(options: { method?: string; headers?: Record<string, string>; body?: unknown }) {
  const req = {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    body: options.body,
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
  } as unknown as ServerResponse & { status(code: number): any; json(body: unknown): void };

  return { req, res, getStatus: () => statusCode, getBody: () => responseBody };
}

describe("GET /api/health", () => {
  it("returns 200 with ok:true for GET", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ method: "GET" });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    const body = getBody() as { ok: boolean; service: string; endpoint: string; time: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("zybble");
    expect(body.endpoint).toBe("/api/health");
    expect(typeof body.time).toBe("string");
  });

  it("returns 200 for HEAD probes (uptime monitors often use HEAD)", async () => {
    const { req, res, getStatus } = createMockReqRes({ method: "HEAD" });
    await handler(req, res);
    expect(getStatus()).toBe(200);
  });

  it("rejects non-GET/HEAD methods with 405", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ method: "POST", body: {} });
    await handler(req, res);
    expect(getStatus()).toBe(405);
    expect(getBody()).toMatchObject({ ok: false });
  });
});
