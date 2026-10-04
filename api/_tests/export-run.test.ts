import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler, { csvEscape, neutralizeCsvFormula } from "../export-run";

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

  it("neutralizes spreadsheet formulas so an exported lead cannot execute", () => {
    /* Business names and tags are third-party/teammate controlled text, and
       Excel, LibreOffice and Sheets all evaluate a cell starting with these
       characters. The apostrophe prefix keeps the cell literal. */
    expect(csvEscape("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(csvEscape("=HYPERLINK(\"http://evil\",\"click\")")).toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(csvEscape("@SUM(1+9)*cmd")).toBe("'@SUM(1+9)*cmd");
    expect(csvEscape("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(csvEscape("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(csvEscape("\tTabLead")).toBe("'\tTabLead");
    expect(neutralizeCsvFormula("=1+1")).toBe("'=1+1");
  });

  it("leaves real numbers and international phone numbers untouched", () => {
    /* Over-escaping would corrupt every phone column in the product. */
    expect(csvEscape("+91 98765 43210")).toBe("+91 98765 43210");
    expect(csvEscape("+1 (415) 555-0123")).toBe("+1 (415) 555-0123");
    expect(csvEscape(-12)).toBe("-12");
    expect(csvEscape("-4.5")).toBe("-4.5");
    expect(csvEscape("4.7")).toBe("4.7");
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
