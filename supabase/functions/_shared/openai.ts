// Shared OpenAI Responses API client used by both Vercel and Supabase Edge
// server runtimes. This module is deliberately web-standard and server-only.
//
// Robustness contract (mirrored in api/_lib/openai.ts):
// - transient provider failures (429 rate limit, 5xx, network/timeout) are
//   retried with bounded backoff inside the caller's time budget;
// - persistent failures surface as precise, secret-free OpenAIError codes;
// - malformed/empty/incomplete provider output is never passed through.

export type OpenAIErrorCode =
  | "missing_key"
  | "provider_unreachable"
  | "provider_auth"
  | "rate_limited"
  | "empty_response"
  | "malformed_response"
  | "provider_unavailable"
  | "model_invalid";

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

/** Where to fix a missing server variable, phrased for the active runtime. */
function runtimeConfigHint(variableName: string) {
  const runtime = globalThis as unknown as RuntimeGlobals;
  return runtime.Deno
    ? `Set ${variableName} as a Supabase Edge Function secret (supabase secrets set ${variableName}=…), then redeploy the function.`
    : `Add ${variableName} in Vercel → Project → Settings → Environment Variables, then redeploy.`;
}

export function getOpenAIModel() {
  return serverEnv("OPENAI_MODEL") || "o4-mini";
}

/** Optional gateway/proxy base URL; defaults to the OpenAI API. */
export function getOpenAIBaseUrl() {
  const base = serverEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1";
  return base.replace(/\/+$/, "");
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

/* ------------------------------------------------------------------ */
/* Retry policy                                                        */
/* ------------------------------------------------------------------ */
const MAX_ATTEMPTS = 3;
const RETRY_SLACK_MS = 4_000; // wall-clock headroom for retries of FAST failures
const MAX_BACKOFF_MS = 2_000;

function isRetryableStatus(status: number) {
  return status === 429 || status === 408 || status >= 500;
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError || error instanceof Error && /fetch|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket/i.test(error.message);
}

/** Parse Retry-After (seconds or HTTP-date); clamped to [0, MAX_BACKOFF_MS]. */
function retryAfterMs(response: Response | null | undefined) {
  const raw = response?.headers?.get("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_BACKOFF_MS, seconds * 1_000);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.min(MAX_BACKOFF_MS, Math.max(0, date - Date.now()));
  return 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AttemptFailure = { error: OpenAIError; response: Response | null };

/** Classify a non-OK provider response; never includes secrets. */
function failureFromResponse(response: Response, payload: Record<string, unknown>, model: string): OpenAIError {
  const providerError = payload.error && typeof payload.error === "object"
    ? (payload.error as Record<string, unknown>)
    : null;
  const message = providerError && typeof providerError.message === "string" ? providerError.message.toLowerCase() : "";
  const errorCode = providerError && typeof providerError.code === "string" ? providerError.code.toLowerCase() : "";

  if (response.status === 401 || response.status === 403) {
    return new OpenAIError(502, "The AI provider rejected the server credentials.", "provider_auth");
  }
  if (
    (response.status === 404 || response.status === 400) &&
    (errorCode.includes("model") || message.includes("model") || message.includes("does not exist"))
  ) {
    return new OpenAIError(
      502,
      `The configured AI model “${model}” isn't available from the AI provider. Check the OPENAI_MODEL server configuration${serverEnv("OPENAI_BASE_URL") ? " and OPENAI_BASE_URL" : ""}, then redeploy.`,
      "model_invalid",
    );
  }
  if (response.status === 429) {
    return new OpenAIError(429, "Zybble AI is rate-limited. Please try again shortly.", "rate_limited");
  }
  if (response.status >= 500 || response.status === 408) {
    return new OpenAIError(502, "Zybble AI is temporarily unavailable. Please try again shortly.", "provider_unavailable");
  }
  return new OpenAIError(502, "Zybble AI couldn't process that request. Please try rephrasing it.", "provider_unavailable");
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
  const baseUrl = getOpenAIBaseUrl();
  const perAttemptTimeout = options.timeoutMs ?? 25_000;
  if (!apiKey) {
    throw new OpenAIError(
      500,
      `Zybble AI isn't configured on the server. Missing server environment variable: OPENAI_API_KEY. ${runtimeConfigHint("OPENAI_API_KEY")}`,
      "missing_key",
    );
  }

  const overallDeadline = Date.now() + perAttemptTimeout + RETRY_SLACK_MS;
  let lastFailure: AttemptFailure | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = overallDeadline - Date.now();
    if (remaining <= 250 && attempt > 1) break;

    let response: Response;
    try {
      const timeoutMs = Math.max(1_000, Math.min(perAttemptTimeout, overallDeadline - Date.now()));
      response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
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
      const timedOut = isTimeoutError(error);
      const network = isNetworkError(error);
      if (timedOut || network) {
        lastFailure = {
          error: new OpenAIError(
            timedOut ? 504 : 502,
            timedOut
              ? "Zybble AI took too long to respond. Please try again."
              : "Zybble AI couldn't be reached. Please try again shortly.",
            "provider_unreachable",
          ),
          response: null,
        };
        if (attempt < MAX_ATTEMPTS && overallDeadline - Date.now() > 1_000) {
          await sleep(Math.min(400 * attempt, MAX_BACKOFF_MS));
          continue;
        }
      }
      throw lastFailure?.error ?? new OpenAIError(
        502,
        "Zybble AI couldn't be reached. Please try again shortly.",
        "provider_unreachable",
      );
    }

    const raw = await response.text().catch(() => "");
    let payload: Record<string, unknown> = {};
    let parsedOk = false;
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
          parsedOk = true;
        }
      } catch {
        parsedOk = false;
      }
    }

    if (!response.ok) {
      // Well-known statuses are classified by the status itself so a
      // non-JSON error body can never mask the real failure.
      const knownStatus =
        response.status === 401 || response.status === 403 ||
        response.status === 429 || response.status === 408 || response.status >= 500;
      if (!knownStatus && !parsedOk && raw.trim()) {
        console.warn("openai malformed error response", { status: response.status, model, bodyLength: raw.length });
        lastFailure = {
          error: new OpenAIError(502, "Zybble AI returned malformed data. Please try again.", "malformed_response"),
          response,
        };
      } else {
        console.warn("openai request failed", {
          status: response.status,
          model,
          attempt,
          category:
            response.status === 401 || response.status === 403
              ? "provider_auth"
              : response.status === 429
                ? "rate_limited"
                : response.status >= 500
                  ? "provider_unavailable"
                  : "provider_request",
        });
        lastFailure = { error: failureFromResponse(response, payload, model), response };
      }
      // Transient provider conditions are retried within the time budget.
      if (
        attempt < MAX_ATTEMPTS &&
        isRetryableStatus(response.status) &&
        lastFailure.error.code !== "model_invalid" &&
        overallDeadline - Date.now() > 1_000
      ) {
        const backoff = Math.max(retryAfterMs(response), Math.min(400 * attempt, MAX_BACKOFF_MS));
        await sleep(backoff);
        continue;
      }
      throw lastFailure.error;
    }

    if (!raw.trim()) {
      console.warn("openai empty response", { status: response.status, model, attempt });
      lastFailure = { error: new OpenAIError(502, "Zybble AI returned an empty response. Please try again.", "empty_response"), response };
      throw lastFailure.error;
    }
    if (!parsedOk) {
      console.warn("openai malformed response", { status: response.status, model, bodyLength: raw.length });
      throw new OpenAIError(502, "Zybble AI returned malformed data. Please try again.", "malformed_response");
    }

    // Some gateways return 200 with an error body — treat it as a failure.
    if (payload.error && typeof payload.error === "object") {
      const errorRecord = payload.error as Record<string, unknown>;
      const errorStatus = typeof errorRecord.status === "number" ? errorRecord.status : response.status;
      const failure = failureFromResponse({ status: errorStatus } as Response, payload, model);
      console.warn("openai error payload with 200 status", { model, code: failure.code });
      throw failure;
    }

    const text = responseText(payload);
    if (!text) {
      const incomplete = payload.status === "incomplete";
      console.warn("openai empty response", {
        status: response.status,
        model,
        responseStatus: typeof payload.status === "string" ? payload.status : "unknown",
        incomplete,
      });
      throw new OpenAIError(
        502,
        incomplete
          ? "Zybble AI returned a truncated response. Please try again."
          : "Zybble AI returned an empty response. Please try again.",
        "empty_response",
      );
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

  throw lastFailure?.error ?? new OpenAIError(502, "Zybble AI couldn't be reached. Please try again shortly.", "provider_unreachable");
}
