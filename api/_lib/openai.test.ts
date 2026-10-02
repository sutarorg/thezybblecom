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

  it.each([
    [401, "provider_auth", "The AI provider rejected the server credentials."],
    [429, "rate_limited", "Zybble AI is rate-limited. Please try again shortly."],
    [500, "provider_unavailable", "Zybble AI is temporarily unavailable. Please try again shortly."],
  ])("maps provider status %s safely", async (status, code, message) => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider body", { status })));
    await expect(openAIJson(options)).rejects.toMatchObject({ status: status === 401 || status >= 500 ? 502 : status, code, message });
  });

  it("maps timeout and malformed successful responses", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    await expect(openAIJson({ ...options, timeoutMs: 10 })).rejects.toMatchObject({ status: 504, code: "provider_unreachable" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(openAIJson(options)).rejects.toMatchObject({ status: 502, code: "malformed_response" });
  });
});
