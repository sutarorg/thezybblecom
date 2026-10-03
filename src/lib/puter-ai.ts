/* ------------------------------------------------------------------ */
/* Zybble — reusable client-side AI helper.                            */
/*                                                                     */
/* One implementation shared by every AI surface in the browser: the   */
/* /find request interpreter (through services/api) and the landing-   */
/* page assistant. All calls go to the same-origin Zybble backend      */
/* (/api/ai-chat), which runs DeepSeek V3.2 through Puter's server     */
/* API with a server-only PUTER_AUTH_TOKEN. The browser never loads    */
/* Puter.js, never holds a Puter credential, and is never sent to a    */
/* puter.com sign-in — the redirect users used to hit is gone by       */
/* construction, not by suppression.                                   */
/*                                                                     */
/* The route streams server-sent events of the form                    */
/*   data: {"text": "…"} / data: {"error": "…"} / data: [DONE]         */
/* and this helper surfaces text deltas through onDelta so UIs render  */
/* them as plain text (React escapes text nodes — model output is      */
/* never interpreted as HTML).                                         */
/* ------------------------------------------------------------------ */

/** Same-origin backend route that streams the assistant reply. */
export const AI_CHAT_ROUTE = "/api/ai-chat";

export type PuterChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Friendly, secret-free failure surfaced to the UI. */
export class PuterAIError extends Error {
  constructor(
    message: string,
    readonly code:
      | "ai_unavailable"
      | "ai_timeout"
      | "empty_response"
      | "malformed_response"
      | "category_missing"
      | "provider_error",
  ) {
    super(message);
    this.name = "PuterAIError";
  }
}

/* ------------------------------------------------------------------ */
/* Streaming chat over the Zybble backend                              */
/* ------------------------------------------------------------------ */
const STREAM_TIMEOUT_MS = 45_000;

/** Strip control characters (keeping tabs/newlines) so model output stays
 *  renderable as plain text no matter what the stream carries. */
export function sanitizeStreamText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** Race one SSE read against an inactivity timeout. */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new PuterAIError(
                "Zybble AI took too long to respond. Please try again.",
                "ai_timeout",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A server-reported failure: keep the curated message, stay secret-free. */
function serverErrorMessage(value: unknown): string {
  if (typeof value !== "string") return "Zybble AI couldn't complete that request. Please try again.";
  const message = value.trim();
  if (!message || message.length > 300 || /https?:\/\/|<\/?[a-z]|\\n\s*at\s/i.test(message)) {
    return "Zybble AI couldn't complete that request. Please try again.";
  }
  return message;
}

/** Map a fetch-level failure to a safe, friendly message. */
function toPuterAIError(error: unknown): PuterAIError {
  if (error instanceof PuterAIError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new PuterAIError(
      "Zybble AI took too long to respond. Please try again.",
      "ai_timeout",
    );
  }
  // TypeError from fetch = network/DNS/CORS — the service is unreachable.
  return new PuterAIError(
    "Zybble AI couldn't be reached. Check your connection and try again.",
    "ai_unavailable",
  );
}

export type StreamPuterChatOptions = {
  /** Called for every streamed text delta, already sanitized. */
  onDelta?: (delta: string) => void;
  /** Per-chunk inactivity timeout in milliseconds. */
  timeoutMs?: number;
};

/**
 * The one shared AI call: POST the conversation to the Zybble backend and
 * consume the SSE stream. Every {"text": …} frame is forwarded through
 * onDelta (sanitized) and accumulated; the promise resolves with the
 * complete text. An {"error": …} frame, a truncated stream, or an empty
 * completion rejects — partial text is never presented as a result.
 */
export async function streamPuterChat(
  messages: PuterChatMessage[],
  options?: StreamPuterChatOptions,
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? STREAM_TIMEOUT_MS;
  const controller = new AbortController();

  let response: Response;
  try {
    response = await fetch(AI_CHAT_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    });
  } catch (error) {
    throw toPuterAIError(error);
  }

  if (!response.ok) {
    // Pre-stream failures are ordinary JSON: { error, code }.
    let message: string | undefined;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      message = typeof body?.error === "string" ? body.error : undefined;
    } catch {
      message = undefined;
    }
    if (response.status === 429) {
      throw new PuterAIError(
        message ?? "Zybble AI is busy right now. Please try again shortly.",
        "provider_error",
      );
    }
    throw new PuterAIError(serverErrorMessage(message), "provider_error");
  }

  if (!response.body) {
    throw new PuterAIError(
      "Zybble AI couldn't load in this browser. Please try again.",
      "ai_unavailable",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  const handleEvent = (rawEvent: string) => {
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(data) as Record<string, unknown>;
    } catch {
      throw new PuterAIError("Zybble AI returned malformed data. Please try again.", "malformed_response");
    }
    if (typeof frame.error === "string") {
      throw new PuterAIError(serverErrorMessage(frame.error), "provider_error");
    }
    if (typeof frame.text === "string" && frame.text) {
      const delta = sanitizeStreamText(frame.text);
      if (delta) {
        full += delta;
        options?.onDelta?.(delta);
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await readWithTimeout(reader, timeoutMs).catch((error) => {
        throw toPuterAIError(error);
      });
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer)) !== null) {
        handleEvent(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleEvent(buffer);
  } catch (error) {
    controller.abort();
    throw toPuterAIError(error);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  if (!full.trim()) {
    throw new PuterAIError("Zybble AI returned an empty response. Please try again.", "empty_response");
  }
  return full;
}

/* ------------------------------------------------------------------ */
/* /find — natural-language request → search filters                   */
/*                                                                     */
/* The interpretation itself runs server-side in /api/ai-interpret;    */
/* this module carries the shared contract: the model only fills the   */
/* filter form, every value is validated and clamped (mirrored         */
/* server-side in api/_lib/interpret.ts), and the search itself is     */
/* NEVER run.                                                          */
/* ------------------------------------------------------------------ */
export type InterpretedSearchFilters = {
  category?: string;
  location?: string;
  quantity?: number;
  minRating?: string;
  priceLevel?: string;
  businessSize?: string;
  requireWebsite?: boolean;
  requirePhone?: boolean;
  requireEmail?: boolean;
  openNow?: boolean;
};

export type SearchInterpretation = {
  filters: InterpretedSearchFilters;
  summary: string;
  notes: string[];
};

/** Per-search clamp applied to AI-proposed quantities (matches the server). */
export const MAX_INTERPRET_LEADS = 240;

function explicitlyRequestedBusinessSize(request: string, size: string) {
  const text = request.toLowerCase();
  if (size === "small")
    return /\bsmall(?:[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized))?\b/.test(text);
  if (size === "medium")
    return /\bmedium(?:[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized))?\b/.test(text);
  return /\benterprise(?:s)?\b|\blarge[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized)\b/.test(text);
}

/**
 * Validate and clamp a raw interpretation. Returns null when no usable
 * business category was produced. Mirrors the validation the server applies
 * before the filters leave /api/ai-interpret — kept here as defense-in-depth
 * for every response path (same-origin route and Edge fallback alike).
 */
export function cleanInterpretResult(
  raw: Record<string, unknown>,
  request = "",
): SearchInterpretation | null {
  const filters: InterpretedSearchFilters = {};

  if (typeof raw.category === "string" && raw.category.trim()) {
    filters.category = raw.category.trim().slice(0, 80);
  }
  if (typeof raw.location === "string" && raw.location.trim()) {
    filters.location = raw.location.trim().slice(0, 100);
  }
  const quantity =
    typeof raw.quantity === "number"
      ? raw.quantity
      : typeof raw.quantity === "string" && /^\d+$/.test(raw.quantity.trim())
        ? Number(raw.quantity.trim())
        : null;
  if (quantity !== null && Number.isFinite(quantity)) {
    filters.quantity = Math.max(1, Math.min(MAX_INTERPRET_LEADS, Math.round(quantity)));
  }
  if (typeof raw.minRating === "string" && ["3", "3.5", "4", "4.5"].includes(raw.minRating)) {
    filters.minRating = raw.minRating;
  }
  if (typeof raw.priceLevel === "string" && ["1", "2", "3", "4"].includes(raw.priceLevel)) {
    filters.priceLevel = raw.priceLevel;
  }
  if (
    typeof raw.businessSize === "string" &&
    ["small", "medium", "enterprise"].includes(raw.businessSize) &&
    explicitlyRequestedBusinessSize(request, raw.businessSize)
  ) {
    filters.businessSize = raw.businessSize;
  }
  for (const key of ["requireWebsite", "requirePhone", "requireEmail", "openNow"] as const) {
    if (raw[key] === true) filters[key] = true;
  }

  if (!filters.category) return null;
  return {
    filters,
    summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.slice(0, 240) : "Search filters prepared.",
    notes: Array.isArray(raw.notes)
      ? raw.notes
          .filter((note): note is string => typeof note === "string" && note.trim().length > 0)
          .slice(0, 2)
          .map((note) => note.slice(0, 160))
      : [],
  };
}

/**
 * The server-side interpretation shape ({ ok, model, filters, summary,
 * notes }) re-validated and clamped client-side. Returns null when the
 * payload lacks a usable business category.
 */
export function cleanServerInterpretation(payload: unknown, request: string): SearchInterpretation | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const body = payload as Record<string, unknown>;
  const filters =
    body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)
      ? (body.filters as Record<string, unknown>)
      : {};
  return cleanInterpretResult({ ...filters, summary: body.summary, notes: body.notes }, request);
}

/**
 * Pull the first JSON object out of a model reply — plain JSON, a fenced
 * ```json block, or JSON surrounded by prose. Returns null when no object
 * can be recovered.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
