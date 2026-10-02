export type EdgeErrorService = "search" | "AI" | "export" | "invite" | "billing";

function safeClientError(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const message = value.trim();
  if (
    !message ||
    message.length > 500 ||
    /\n\s*at\s|<\/?(?:html|body|script)|\bBearer\s+|\bsk-[a-z0-9_-]+|https?:\/\//i.test(message)
  ) {
    return fallback;
  }
  return message;
}

/**
 * Supabase JS has several error shapes: FunctionsHttpError includes a
 * Response in `context`, while relay/network failures only expose the vague
 * "Failed to send a request to the Edge Function" message. Read a structured
 * response when it exists and classify opaque cases without exposing URLs,
 * tokens, provider bodies, or stack traces.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readFunctionError(error: any, functionName = "requested", service: EdgeErrorService = "AI"): Promise<string> {
  const fallback = `The ${service} service couldn't complete that action. Please try again.`;
  try {
    const context = error?.context;
    if (context) {
      const status = Number(context.status ?? error?.status ?? 0);
      let body: unknown = null;
      if (typeof context.clone === "function" && typeof context.clone().text === "function") {
        const response = context.clone() as Response;
        const text = await response.text().catch(() => "");
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
      } else if (typeof context.json === "function") {
        body = await context.json().catch(() => null);
      }
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const record = body as Record<string, unknown>;
        const message = typeof record.error === "string" ? record.error : record.detail;
        if (typeof message === "string" && message.trim()) return safeClientError(message, fallback);
      }
      if (status === 404) return `The requested Edge Function "${functionName}" is not deployed.`;
      if (status === 401) return "Your session expired — sign in again.";
      if (status === 403) return "You don't have access to complete that action.";
      if (status === 429) return `The ${service} service is busy or rate-limited. Please try again shortly.`;
    }
  } catch {
    /* fall through to a safe classification */
  }

  const name = String(error?.name ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  if (/failed to (send a request|fetch)|network|cors|load failed/.test(message)) {
    return `The requested Edge Function "${functionName}" couldn't be reached. Check that it is deployed and try again.`;
  }
  if (message.includes("not found") || message.includes("404")) {
    return `The requested Edge Function "${functionName}" is not deployed.`;
  }
  if (name.toLowerCase().includes("relay")) {
    return `The requested Edge Function "${functionName}" couldn't be reached. Check that it is deployed and try again.`;
  }
  return safeClientError(error?.message, fallback);
}
