// Shared server-side OpenRouter AI client used by both Vercel and Supabase
// Edge server runtimes (mirrored in supabase/functions/_shared/openrouter.ts).
// This module is deliberately web-standard and server-only: the API key is
// read exclusively from the server runtime environment (OPENROUTER_API_KEY)
// — it is never imported by browser code, never logged, and never
// interpolated into an error message.
//
// Every Zybble AI surface (the Ask Zybble landing-page assistant, /find
// request interpretation, and per-lead analysis) runs server-to-server
// through OpenRouter's OpenAI-compatible endpoint
// (https://openrouter.ai/api/v1/chat/completions) authenticated once with
// the workspace owner's OPENROUTER_API_KEY. The model is DeepSeek V3.2
// (OPENROUTER_MODEL). Zybble users never see a third-party AI sign-in and
// no AI credential ever reaches the browser.
//
// Robustness contract (mirrors api/_lib/openrouter.test.ts):
// - errors are classified by the provider's status AND error.code/error.type,
//   never by status alone. Notably a 429 is a transient rate limit ONLY when
//   the provider reports a rate-limit condition; the same status carrying
//   insufficient_quota / insufficient_credits / billing markers is an
//   account-balance failure (OpenRouter answers it with 402) that no amount
//   of retrying will fix;
// - transient conditions (genuine 429s, 408, 5xx/503 overload, network and
//   timeout failures) are retried with exponential backoff plus jitter inside
//   the caller's time budget, honoring Retry-After as a minimum delay (and
//   refusing to retry sooner than the provider asked);
// - authentication, quota, malformed-request and malformed-response failures
//   fail fast with precise, secret-free OpenRouterError codes, each with its
//   own user-friendly message;
// - malformed/empty/incomplete provider output is never passed through.

export type OpenRouterErrorCode =
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

export class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: OpenRouterErrorCode,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export type OpenRouterServerMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

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

/** The model all Zybble's server-side AI surfaces use (DeepSeek via OpenRouter). */
export function getOpenRouterModel() {
  return serverEnv("OPENROUTER_MODEL") || "deepseek/deepseek-v3.2";
}

/** OpenRouter's OpenAI-compatible endpoint; override only for testing/proxying. */
export function getOpenRouterBaseUrl() {
  const base = serverEnv("OPENROUTER_API_BASE_URL") || "https://openrouter.ai/api/v1";
  return base.replace(/\/+$/, "");
}

/**
 * Resolve OPENROUTER_API_KEY or fail with an actionable, secret-free error.
 * The key authorizes server-to-server calls against the site owner's
 * OpenRouter account; it must exist nowhere else (never a VITE_* variable).
 */
export function requireOpenRouterApiKey(): string {
  const apiKey = serverEnv("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new OpenRouterError(
      500,
      `Zybble AI isn't configured on the server. Missing server environment variable: OPENROUTER_API_KEY. ${runtimeConfigHint("OPENROUTER_API_KEY")} Create the key in your OpenRouter dashboard (openrouter.ai → Keys → Create key) and never expose it in frontend code.`,
      "missing_key",
    );
  }
  return apiKey;
}

/** True when the provider body's error object looks like an account-balance failure. */
export function isOpenRouterQuotaError(info: ProviderErrorInfo | null) {
  if (!info) return false;
  if (
    info.code.includes("insufficient_quota") ||
    info.code.includes("insufficient_credits") ||
    info.code.includes("spend_limit_exceeded")
  ) return true;
  if (info.type.includes("insufficient_quota") || info.type.includes("billing")) return true;
  return /exceeded (your )?current quota|insufficient (credits?|funds?|balance)/.test(info.message);
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

/** True only for failures a retry can plausibly fix. */
function isTransientFailure(status: number, info: ProviderErrorInfo | null) {
  if (status === 408 || status >= 500) return true; // timeout / outage / 503 overload
  if (status === 429) return !isOpenRouterQuotaError(info); // genuine rate limit only
  return false;
}

/** Classify a failing provider response by status + error body; secret-free. */
function failureFromResponse(status: number, payload: Record<string, unknown>, model: string): OpenRouterError {
  const info = providerErrorInfo(payload);
  const message = info?.message ?? "";
  const errorCode = info?.code ?? "";

  // 401/403 — the server-side OPENROUTER_API_KEY is rejected; users cannot
  // fix this by retrying or rephrasing.
  if (status === 401 || status === 403) {
    return new OpenRouterError(502, "The AI provider rejected the server credentials.", "provider_auth");
  }
  if (
    (status === 404 || status === 400) &&
    (errorCode.includes("model") || message.includes("model") || message.includes("does not exist"))
  ) {
    return new OpenRouterError(
      502,
      `The configured AI model “${model}” isn't available from the AI provider. Check the OPENROUTER_MODEL server configuration${serverEnv("OPENROUTER_API_BASE_URL") ? " and OPENROUTER_API_BASE_URL" : ""}, then redeploy.`,
      "model_invalid",
    );
  }
  // 402 Payment Required or any explicit quota marker — an account-balance
  // failure no amount of retrying will fix. The message is actionable for
  // the site owner and never blames the visitor.
  if (status === 402 || isOpenRouterQuotaError(info)) {
    return new OpenRouterError(
      502,
      "Zybble AI ran out of usage quota on its server account. An administrator needs to review the OpenRouter account credits before AI features work again.",
      "provider_quota",
    );
  }
  if (status === 429) {
    return new OpenRouterError(429, "Zybble AI is rate-limited. Please try again shortly.", "rate_limited");
  }
  if (status >= 500 || status === 408) {
    return new OpenRouterError(502, "Zybble AI is temporarily unavailable. Please try again shortly.", "provider_unavailable");
  }
  // 4xx without a more specific meaning: our request was malformed for the
  // provider. Never retried, never labeled a rate limit.
  return new OpenRouterError(502, "Zybble AI couldn't process that request. Please try rephrasing it.", "provider_request_invalid");
}

/**
 * Best-guess HTTP classification for an error carried in a 200 response
 * body. Some gateways wrap provider failures in a success status — classify
 * by the error content exactly as failureFromResponse would classify the
 * honest status, so quota/auth/model failures keep their precise meaning.
 */
function statusFromErrorPayload(payload: Record<string, unknown>): number {
  const info = providerErrorInfo(payload);
  if (!info) return 502;
  if (isOpenRouterQuotaError(info)) return 429; // the 429 branch reclassifies it as quota
  const haystack = `${info.code} ${info.type} ${info.message}`;
  if (/invalid_api_key|api_key_incorrect|invalid_token|unauthorized|forbidden|authentication/.test(haystack)) return 401;
  if (/model/.test(haystack) || /does not exist/.test(haystack)) return 404;
  if (/rate.?limit|too many|throttl/.test(haystack)) return 429;
  return 502;
}

/** Log-safe category for metrics; mirrors failureFromResponse without bodies. */
function failureCategory(status: number, info: ProviderErrorInfo | null): OpenRouterErrorCode {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 429) return isOpenRouterQuotaError(info) ? "provider_quota" : "rate_limited";
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
  return error instanceof TypeError || (error instanceof Error && /fetch|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket/i.test(error.message));
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

type AttemptFailure = { error: OpenRouterError; response: Response | null };

function timeoutFailure(timedOut: boolean): OpenRouterError {
  return new OpenRouterError(
    timedOut ? 504 : 502,
    timedOut
      ? "Zybble AI took too long to respond. Please try again."
      : "Zybble AI couldn't reach the AI provider. Please try again shortly.",
    timedOut ? "provider_timeout" : "provider_network",
  );
}

/* ------------------------------------------------------------------ */
/* Response payload extraction (OpenAI-compatible shapes)              */
/* ------------------------------------------------------------------ */
function contentPartsText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const record = part as Record<string, unknown>;
        return typeof record.text === "string" ? record.text : "";
      })
      .join("");
  }
  return "";
}

/** Full assistant text from a non-streamed chat.completion payload. */
export function completionMessageText(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const message = (choice as Record<string, unknown>).message;
    if (message && typeof message === "object") {
      const text = contentPartsText((message as Record<string, unknown>).content);
      if (text.trim()) return text;
    }
  }
  // Defensive: some gateways mirror the Responses API shape.
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  return "";
}

/** One streamed delta from a chat.completion.chunk payload (SSE event). */
export function streamChunkDelta(payload: Record<string, unknown>): string {
  if (payload.error && typeof payload.error === "object") {
    // Mid-stream provider failures surface as a 200-body error event. Details
    // must never reach the browser (they may echo internals) — use a safe,
    // generic message.
    throw new OpenRouterError(
      502,
      "Zybble AI couldn't complete that request. Please try again.",
      "provider_unavailable",
    );
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const delta = (choice as Record<string, unknown>).delta;
    if (delta && typeof delta === "object") {
      const text = contentPartsText((delta as Record<string, unknown>).content);
      if (text) return text;
    }
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* The one provider call (chat.completions, streaming or buffered)     */
/* ------------------------------------------------------------------ */
async function openRouterChatCompletions(options: {
  messages: OpenRouterServerMessage[];
  stream: boolean;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const apiKey = requireOpenRouterApiKey();
  const model = getOpenRouterModel();
  const baseUrl = getOpenRouterBaseUrl();
  const perAttemptTimeout = options.timeoutMs ?? 25_000;

  const overallDeadline = Date.now() + perAttemptTimeout + RETRY_SLACK_MS;
  let lastFailure: AttemptFailure | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = overallDeadline - Date.now();
    if (remaining <= 250 && attempt > 1) break;

    let response: Response;
    try {
      const timeoutMs = Math.max(1_000, Math.min(perAttemptTimeout, overallDeadline - Date.now()));
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: openRouterHeaders(apiKey),
        signal: options.signal
          ? // Overall attempt timeout still applies; a caller-provided abort
            // (e.g. client disconnect) wins too.
            AbortSignal.any([AbortSignal.timeout(timeoutMs), options.signal])
          : AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          messages: options.messages,
          max_tokens: options.maxOutputTokens ?? 2_000,
          stream: options.stream,
        }),
      });
    } catch (error) {
      // A caller-initiated abort is not a provider failure — surface it as-is
      // so the route can stop quietly instead of reporting an outage.
      if (options.signal?.aborted) throw error;
      const timedOut = isTimeoutError(error);
      const network = isNetworkError(error);
      if (timedOut || network) {
        lastFailure = { error: timeoutFailure(timedOut), response: null };
        if (attempt < MAX_ATTEMPTS && overallDeadline - Date.now() > 1_000) {
          await sleep(backoffMs(attempt));
          continue;
        }
      }
      throw lastFailure?.error ?? new OpenRouterError(
        502,
        "Zybble AI couldn't be reached. Please try again shortly.",
        "provider_unreachable",
      );
    }

    // Success: return the response untouched. For streaming requests the
    // caller owns the body from here on — retrying once bytes flow would
    // duplicate output, so no further retry logic applies.
    if (response.ok) return response;

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

    const info = providerErrorInfo(payload);
    const knownStatus =
      response.status === 401 || response.status === 403 ||
      response.status === 429 || response.status === 408 || response.status >= 500;
    if (!knownStatus && !parsedOk && raw.trim()) {
      console.warn("openrouter malformed error response", { status: response.status, model, bodyLength: raw.length });
      lastFailure = {
        error: new OpenRouterError(502, "Zybble AI returned malformed data. Please try again.", "malformed_response"),
        response,
      };
    } else {
      console.warn("openrouter request failed", {
        status: response.status,
        model,
        attempt,
        category: failureCategory(response.status, info),
        providerCode: info?.code || undefined,
        providerType: info?.type || undefined,
      });
      lastFailure = { error: failureFromResponse(response.status, payload, model), response };
    }
    // Only transient conditions are retried — auth, quota and request-shape
    // failures are final. Retry-After is a MINIMUM wait: when it exceeds this
    // function's budget we stop rather than retrying sooner than asked.
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

  throw lastFailure?.error ?? new OpenRouterError(502, "Zybble AI couldn't be reached. Please try again shortly.", "provider_unreachable");
}

/**
 * Request headers for OpenRouter: the OpenAI-compatible auth header plus the
 * optional attribution headers (HTTP-Referer / X-Title), configurable through
 * OPENROUTER_HTTP_REFERER / OPENROUTER_X_TITLE. The API key never leaves the
 * Authorization header — it is not logged and never appears in an error.
 */
function openRouterHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const referer = serverEnv("OPENROUTER_HTTP_REFERER") || "https://zybble.com";
  if (referer) headers["HTTP-Referer"] = referer;
  const title = serverEnv("OPENROUTER_X_TITLE") || "Zybble";
  if (title) headers["X-Title"] = title;
  return headers;
}

/**
 * Buffered completion: resolves with the full assistant text. Never returns
 * an empty string — blank, truncated and non-JSON completions throw.
 */
export async function openRouterChatJson(options: {
  messages: OpenRouterServerMessage[];
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await openRouterChatCompletions({ ...options, stream: false });

  const raw = await response.text().catch(() => "");
  if (!raw.trim()) {
    console.warn("openrouter empty response", { model: getOpenRouterModel() });
    throw new OpenRouterError(502, "Zybble AI returned an empty response. Please try again.", "empty_response");
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    payload = parsed as Record<string, unknown>;
  } catch {
    console.warn("openrouter malformed response", { model: getOpenRouterModel(), bodyLength: raw.length });
    throw new OpenRouterError(502, "Zybble AI returned malformed data. Please try again.", "malformed_response");
  }

  // Some gateways return 200 with an error body — classify it by the error
  // content exactly like the matching HTTP status (quota/auth still fail
  // fast and keep their precise codes).
  if (payload.error && typeof payload.error === "object") {
    const failure = failureFromResponse(statusFromErrorPayload(payload), payload, getOpenRouterModel());
    console.warn("openrouter error payload with 200 status", { model: getOpenRouterModel(), code: failure.code });
    throw failure;
  }

  const text = completionMessageText(payload).trim();
  if (!text) {
    console.warn("openrouter empty completion", { model: getOpenRouterModel() });
    throw new OpenRouterError(502, "Zybble AI returned an empty response. Please try again.", "empty_response");
  }
  return text;
}

/**
 * Streaming completion: resolves with the upstream 200 response whose body
 * carries OpenAI-compatible SSE chunks (or, defensively, a buffered JSON
 * completion when the gateway ignores `stream`). Failures that happen BEFORE
 * streaming starts throw (and may have been retried); once bytes flow the
 * caller owns the stream.
 */
export async function openRouterChatStream(options: {
  messages: OpenRouterServerMessage[];
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Response> {
  return openRouterChatCompletions({ ...options, stream: true });
}
