// Shared OpenAI Responses API client used by both Vercel and Supabase Edge
// server runtimes. This module is deliberately web-standard and server-only.
// The API key is read exclusively from the server runtime environment
// (OPENAI_API_KEY) — it is never imported by browser code, never logged, and
// never interpolated into an error message.
//
// Robustness contract (mirrored in supabase/functions/_shared/openai.ts),
// aligned with https://developers.openai.com/api/docs/guides/rate-limits
// and the platform error-code reference:
// - errors are classified by the provider's status AND error.code/error.type,
//   never by status alone. Notably a 429 is a transient rate limit ONLY when
//   the provider reports a rate-limit condition; the same status carrying
//   insufficient_quota / project_spend_limit_exceeded is a billing failure
//   that no amount of retrying will fix;
// - transient conditions (genuine 429s, 408, 5xx/503 overload, network and
//   timeout failures) are retried with exponential backoff plus jitter inside
//   the caller's time budget, honoring Retry-After as a minimum delay (and
//   refusing to retry sooner than the provider asked);
// - authentication, quota, malformed-request and malformed-response failures
//   fail fast with precise, secret-free OpenAIError codes, each with its own
//   user-friendly message;
// - malformed/empty/incomplete provider output is never passed through.

export type OpenAIErrorCode =
  | "missing_key"
  | "provider_auth"
  | "provider_quota"
  | "rate_limited"
  | "provider_request_invalid"
  | "provider_timeout"
  | "provider_network"
  | "provider_unreachable"
  | "provider_unavailable"
  | "model_invalid"
  | "empty_response"
  | "malformed_response";

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
/* Provider error classification                                       */
/* ------------------------------------------------------------------ */

/** Normalized view of the provider's error object (code/type/message). */
type ProviderErrorInfo = { code: string; type: string; message: string };

function providerErrorInfo(payload: Record<string, unknown>): ProviderErrorInfo | null {
  const error = payload.error && typeof payload.error === "object"
    ? (payload.error as Record<string, unknown>)
    : null;
  if (!error) return null;
  return {
    code: typeof error.code === "string" ? error.code.toLowerCase() : "",
    type: typeof error.type === "string" ? error.type.toLowerCase() : "",
    message: typeof error.message === "string" ? error.message.toLowerCase() : "",
  };
}

/**
 * A 429 is a transient rate limit ONLY when the provider says so. The same
 * status is also used for exhausted credit balances and enforced spend
 * limits (error.code `insufficient_quota` / `project_spend_limit_exceeded`
 * or type `insufficient_quota`) — billing conditions that never recover by
 * retrying and must be reported as quota failures instead of "rate-limited".
 */
export function isQuotaError(info: ProviderErrorInfo | null) {
  if (!info) return false;
  if (info.code.includes("insufficient_quota") || info.code.includes("spend_limit_exceeded")) return true;
  if (info.type.includes("insufficient_quota")) return true;
  if (info.type.includes("billing")) return true;
  return /exceeded (your )?current quota/.test(info.message);
}

/** True only for failures a retry can plausibly fix. */
function isTransientFailure(status: number, info: ProviderErrorInfo | null) {
  if (status === 408 || status >= 500) return true; // timeout / outage / 503 overload
  if (status === 429) return !isQuotaError(info);   // genuine rate limit only
  return false;
}

/** Classify a non-OK provider response; never includes secrets. */
function failureFromResponse(response: Response, payload: Record<string, unknown>, model: string): OpenAIError {
  const info = providerErrorInfo(payload);
  const message = info?.message ?? "";
  const errorCode = info?.code ?? "";

  // 401 invalid_api_key / 403 permission errors — the server-side key is
  // rejected; users cannot fix this by retrying or rephrasing.
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
    if (isQuotaError(info)) {
      return new OpenAIError(
        402,
        "Zybble AI ran out of usage quota. An administrator needs to review the AI provider plan and billing before AI features work again.",
        "provider_quota",
      );
    }
    return new OpenAIError(429, "Zybble AI is rate-limited. Please try again shortly.", "rate_limited");
  }
  if (response.status >= 500 || response.status === 408) {
    return new OpenAIError(502, "Zybble AI is temporarily unavailable. Please try again shortly.", "provider_unavailable");
  }
  // 4xx without a more specific meaning: our request was malformed for the
  // provider (bad input, unsupported parameter). Never retried, never
  // labeled a rate limit.
  return new OpenAIError(502, "Zybble AI couldn't process that request. Please try rephrasing it.", "provider_request_invalid");
}

/** Log-safe category for metrics; mirrors failureFromResponse without bodies. */
function failureCategory(status: number, info: ProviderErrorInfo | null): OpenAIErrorCode {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 429) return isQuotaError(info) ? "provider_quota" : "rate_limited";
  if (status >= 500 || status === 408) return "provider_unavailable";
  return "provider_request_invalid";
}

/* ------------------------------------------------------------------ */
/* Retry policy — exponential backoff with jitter, Retry-After aware   */
/* ------------------------------------------------------------------ */
const MAX_ATTEMPTS = 3;
const RETRY_SLACK_MS = 4_000; // wall-clock headroom for retries of FAST failures
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 2_000;

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError || error instanceof Error && /fetch|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket/i.test(error.message);
}

/**
 * Parse Retry-After (seconds delta or HTTP-date) as raw milliseconds.
 * Deliberately NOT clamped: when the provider asks for a longer wait than
 * this short-lived function can honor, the correct response is to stop
 * retrying rather than to retry sooner than requested.
 */
function retryAfterMs(response: Response | null | undefined) {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return 0;
}

/** Exponential backoff with ±25% jitter (doubles per attempt, capped). */
function backoffMs(attempt: number) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  return exp * (0.75 + Math.random() * 0.5);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AttemptFailure = { error: OpenAIError; response: Response | null };

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
              : "Zybble AI couldn't reach the AI provider. Please try again shortly.",
            timedOut ? "provider_timeout" : "provider_network",
          ),
          response: null,
        };
        if (attempt < MAX_ATTEMPTS && overallDeadline - Date.now() > 1_000) {
          await sleep(backoffMs(attempt));
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
      const info = providerErrorInfo(payload);
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
          category: failureCategory(response.status, info),
          providerCode: info?.code || undefined,
          providerType: info?.type || undefined,
        });
        lastFailure = { error: failureFromResponse(response, payload, model), response };
      }
      // Only transient conditions (genuine rate limits, timeouts, 5xx,
      // overload) are retried — auth, quota and request-shape failures are
      // final by definition. The provider's Retry-After is a MINIMUM wait:
      // when it exceeds this short-lived function's budget we stop and
      // report the failure instead of retrying sooner than asked.
      if (
        attempt < MAX_ATTEMPTS &&
        isTransientFailure(response.status, info) &&
        overallDeadline - Date.now() > 1_000
      ) {
        const serverWait = retryAfterMs(response);
        if (serverWait <= MAX_BACKOFF_MS) {
          await sleep(Math.max(serverWait, backoffMs(attempt)));
          continue;
        }
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

    // Some gateways return 200 with an error body — classify and (only for
    // genuine transient rate limits / overloads) retry it like the real
    // status. Quota and auth errors in this shape fail just as fast.
    if (payload.error && typeof payload.error === "object") {
      const errorRecord = payload.error as Record<string, unknown>;
      const errorStatus = typeof errorRecord.status === "number" ? errorRecord.status : response.status;
      const info = providerErrorInfo(payload);
      const failure = failureFromResponse({ status: errorStatus } as Response, payload, model);
      console.warn("openai error payload with 200 status", { model, code: failure.code });
      if (
        attempt < MAX_ATTEMPTS &&
        isTransientFailure(errorStatus, info) &&
        overallDeadline - Date.now() > 1_000
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }
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
