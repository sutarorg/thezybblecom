export type ApiService = "search" | "AI" | "export" | "invite" | "billing";

export type ParsedApiResponse<T> = {
  data?: T;
  error?: string;
  code?: string;
  /** Extra machine-readable fields from a structured error body, if any. */
  payload?: Record<string, unknown>;
  /** True only when the route itself is unavailable and an Edge fallback is safe to try. */
  shouldFallback: boolean;
};

function defaultMessage(service: ApiService, status: number) {
  if (status === 401) return "Your session expired — sign in again.";
  if (status === 402) return `The ${service} service ran out of usage quota. An administrator must review the provider plan and billing before it works again.`;
  if (status === 403) return "You don't have access to complete that action.";
  if (status === 408 || status === 504) return `The ${service} service timed out. Please try again.`;
  if (status === 429) return `The ${service} service is busy or rate-limited. Please try again shortly.`;
  if (status >= 500) return `The ${service} service is temporarily unavailable. Please try again shortly.`;
  if (status === 404) return `The ${service} route isn't available on this deployment.`;
  return `The ${service} server couldn't complete that action. Please try again.`;
}

/**
 * Only surface concise application errors. Platform pages, stack traces,
 * credentials, and internal URLs must never be rendered into the app.
 */
function safeMessage(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const message = value.trim();
  if (!message || message.length > 500) return fallback;
  if (/\n\s*at\s|<\/?(?:html|body|script)|\bBearer\s+|\bsk-[a-z0-9_-]+|https?:\/\//i.test(message)) {
    return fallback;
  }
  return message;
}

function looksLikeHtml(text: string) {
  return /^\s*<!doctype\s+html|^\s*<html\b|<body\b|<title>.*(?:error|vercel)/is.test(text);
}

/**
 * Read once as text, then attempt JSON parsing regardless of Content-Type.
 * This accepts application/json, application/problem+json, and JSON sent with
 * missing or incorrect headers while safely classifying platform responses.
 *
 * A fallback is deliberately limited to a missing route. Retrying a 5xx or
 * timeout can run a real search twice after the first request has already
 * reserved quota, so provider/application failures are returned directly.
 */
export async function parseApiResponse<T = Record<string, unknown>>(
  response: Response,
  service: ApiService,
): Promise<ParsedApiResponse<T>> {
  const text = await response.text().catch(() => "");
  const fallback = defaultMessage(service, response.status);
  let parsed: unknown;
  let hasJson = false;

  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
      hasJson = true;
    } catch {
      hasJson = false;
    }
  }

  if (hasJson && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const body = parsed as Record<string, unknown>;
    const errorValue = body.error ?? body.detail;
    const code = typeof body.code === "string" ? body.code : undefined;
    if (!response.ok || errorValue != null) {
      return {
        error: safeMessage(errorValue, fallback),
        code,
        payload: body,
        shouldFallback: response.status === 404,
      };
    }
    return { data: body as T, shouldFallback: false };
  }

  const contentType = response.headers.get("content-type") ?? "";
  const html = looksLikeHtml(text) || contentType.toLowerCase().includes("text/html");
  // A 404 is the only safe automatic fallback. HTML from a timed-out or
  // crashed function may still represent a request that reached the provider.
  const shouldFallback = response.status === 404;
  // Log only safe response metadata. Never log the body, auth headers, or URL.
  console.warn(`${service} API returned a non-JSON response`, {
    status: response.status,
    contentType: contentType.slice(0, 100),
    bodyLength: text.length,
    html,
    requestId: response.headers.get("x-vercel-id") ?? response.headers.get("x-request-id") ?? undefined,
  });
  return { error: fallback, code: html ? "platform_response" : "non_json_response", shouldFallback };
}

export function safeApiMessage(value: unknown, fallback: string) {
  return safeMessage(value, fallback);
}
