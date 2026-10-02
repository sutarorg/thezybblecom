// Shared OpenAI Responses API client used by both Vercel and Supabase Edge
// server runtimes. This module is deliberately web-standard and server-only.

export type OpenAIErrorCode =
  | "missing_key"
  | "provider_unreachable"
  | "provider_auth"
  | "rate_limited"
  | "empty_response"
  | "malformed_response"
  | "provider_unavailable";

export class OpenAIError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: OpenAIErrorCode,
  ) {
    super(message);
    this.name = "OpenAIError";
  }
}

type RuntimeGlobals = {
  Deno?: { env?: { get(name: string): string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

function serverEnv(name: string) {
  const runtime = globalThis as unknown as RuntimeGlobals;
  return runtime.Deno?.env?.get(name)?.trim() || runtime.process?.env?.[name]?.trim() || "";
}

export function getOpenAIModel() {
  return serverEnv("OPENAI_MODEL") || "o4-mini";
}

function responseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if ((record.type === "output_text" || record.type === "text") && typeof record.text === "string") {
        parts.push(record.text);
      }
    }
  }
  return parts.join("\n").trim();
}

export async function openAIJson(options: {
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<Record<string, unknown>> {
  const apiKey = serverEnv("OPENAI_API_KEY");
  const model = getOpenAIModel();
  if (!apiKey) {
    throw new OpenAIError(500, "Zybble AI isn't configured on the server.", "missing_key");
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
      body: JSON.stringify({
        model,
        instructions: options.instructions,
        input: options.input,
        max_output_tokens: options.maxOutputTokens ?? 2_000,
        text: {
          format: {
            type: "json_schema",
            name: options.schemaName,
            strict: true,
            schema: options.schema,
          },
        },
      }),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new OpenAIError(
      timedOut ? 504 : 502,
      timedOut
        ? "Zybble AI took too long to respond. Please try again."
        : "Zybble AI couldn't be reached. Please try again shortly.",
      "provider_unreachable",
    );
  }

  const raw = await response.text().catch(() => "");
  let payload: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      if (response.ok) {
        console.warn("openai malformed response", { status: response.status, model, bodyLength: raw.length });
        throw new OpenAIError(502, "Zybble AI returned malformed data. Please try again.", "malformed_response");
      }
    }
  }

  if (!response.ok) {
    console.warn("openai request failed", {
      status: response.status,
      model,
      category:
        response.status === 401 || response.status === 403
          ? "provider_auth"
          : response.status === 429
            ? "rate_limited"
            : response.status >= 500
              ? "provider_unavailable"
              : "provider_request",
    });
    if (response.status === 401 || response.status === 403) {
      throw new OpenAIError(502, "The AI provider rejected the server credentials.", "provider_auth");
    }
    if (response.status === 429) {
      throw new OpenAIError(429, "Zybble AI is rate-limited. Please try again shortly.", "rate_limited");
    }
    throw new OpenAIError(
      502,
      response.status >= 500
        ? "Zybble AI is temporarily unavailable. Please try again shortly."
        : "Zybble AI couldn't process that request. Please try rephrasing it.",
      "provider_unavailable",
    );
  }

  const text = responseText(payload);
  if (!text) {
    console.warn("openai empty response", {
      status: response.status,
      model,
      responseStatus: typeof payload.status === "string" ? payload.status : "unknown",
    });
    throw new OpenAIError(502, "Zybble AI returned an empty response. Please try again.", "empty_response");
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    console.warn("openai structured output was not JSON", { model, outputLength: text.length });
    throw new OpenAIError(502, "Zybble AI returned malformed data. Please try again.", "malformed_response");
  }
}
