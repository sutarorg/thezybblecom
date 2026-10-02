import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler, { csvEscape } from "./export-run";

function createMockReqRes(options: { method?: string; headers?: Record<string, string>; body?: unknown }) {
  const req = {
    method: options.method ?? "POST",
    headers: options.headers ?? {},
    body: options.body,
  } as unknown as IncomingMessage & { body?: unknown };

  let statusCode = 200;
  let responseBody: unknown = null;
  const headers: Record<string, string> = {};

  const res = {
    setHeader(key: string, value: string) {
      headers[key] = value;
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      responseBody = body;
    },
  } as unknown as ServerResponse & { status(code: number): any; json(body: unknown): void };

  return { req, res, getStatus: () => statusCode, getBody: () => responseBody, getHeaders: () => headers };
}

describe("csvEscape", () => {
  it("escapes commas quotes and line breaks", () => {
    expect(csvEscape("ACME, Inc.")).toBe('"ACME, Inc."');
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("serializes arrays and unicode", () => {
    expect(csvEscape(["vip", "followup"])).toBe("vip; followup");
    expect(csvEscape("Café")).toBe("Café");
    expect(csvEscape(null)).toBe("");
  });
});

describe("export-run handler", () => {
  it("rejects non-POST requests with 405 Method Not Allowed", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ method: "GET" });
    await handler(req, res);
    expect(getStatus()).toBe(405);
    expect(getBody()).toMatchObject({ error: "Method not allowed" });
  });

  it("rejects missing body with 400", async () => {
    const { req, res, getStatus, getBody } = createMockReqRes({ method: "POST", body: null });
    await handler(req, res);
    expect(getStatus()).toBe(400);
    expect(getBody()).toMatchObject({ code: "missing_body" });
  });
});
