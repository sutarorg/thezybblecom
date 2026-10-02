import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler, { cleanInterpretResult } from "./ai-interpret";

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

describe("AI interpretation validation", () => {
  it("clamps filters and keeps an explicitly requested business size", () => {
    const result = cleanInterpretResult(
      { ...base, quantity: 500, businessSize: "medium" },
      "Find medium-sized dentists in Austin",
    );
    expect(result.filters).toMatchObject({ category: "dentists", quantity: 240, businessSize: "medium" });
  });

  it("drops a business size the user did not request", () => {
    const result = cleanInterpretResult(
      { ...base, businessSize: "enterprise" },
      "Find 100 dentists in Austin with websites and 4+ ratings",
    );
    expect(result.filters).not.toHaveProperty("businessSize");
  });

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
