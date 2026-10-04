// ============================================================================
// ai-chat — Zybble's browser-facing AI bridge (landing-page assistant).
//
// AI runs server-to-server: this route forwards a validated conversation to
// OpenRouter's OpenAI-compatible endpoint (https://openrouter.ai/api/v1)
// with the server-only OPENROUTER_API_KEY and streams the reply back as
// server-sent events. No OpenRouter credential, no third-party AI script,
// and no sign-in flow ever reaches the browser.
//
// Wire contract (response `Content-Type: text/event-stream`):
//   data: {"text": "…delta…"}\n\n        — one per streamed token chunk
//   data: {"error": "friendly message"}\n\n — mid-stream failure (then DONE)
//   data: [DONE]\n\n                     — always the terminal event
// Pre-stream failures return ordinary JSON: { error, code } with a status.
// The upstream OpenRouter SSE format is never exposed to the browser — every
// event is transcoded here.
// ============================================================================
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  OpenRouterError,
  completionMessageText,
  getOpenRouterModel,
  openRouterChatStream,
  streamChunkDelta,
  type OpenRouterServerMessage,
} from "./_lib/openrouter.js";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };

export const maxDuration = 60;

/* The assistant is public (the marketing page has no session), so the route
   stays callable without a Zybble account. Abuse is bounded instead:
   - only the assistant conversation shape is accepted (a system prompt that
     carries the product-assistant marker + user/assistant turns),
   - hard caps on message count and characters,
   - a best-effort per-IP rate limit per warm instance,
   - the model and token budget are fixed server-side and can never be set
     from the request body. OPENROUTER_API_KEY is the real credential and it
     leaves the server in no response, log line, or error message. */

/** Keep in sync with assistantSystemPrompt() in src/assistant/prompt.ts. */
export const ASSISTANT_MARKER = 'You are "Zybble AI", the assistant on the Zybble website';

const MAX_MESSAGES = 24;
/* The system message is the generated assistant fact sheet (see
   src/assistant/prompt.ts), not user input — it's the same on every request
   and currently runs well over 40,000 characters. Its cap just needs enough
   headroom for the knowledge base to keep growing; it carries no abuse risk
   since the client can't set its content. */
const LIMITS: Record<OpenRouterServerMessage["role"], number> = {
  system: 80_000,
  user: 4_000,
  assistant: 8_000,
};
const MAX_TOTAL_CHARS = 120_000;
const ASSISTANT_MAX_OUTPUT_TOKENS = 1_200;
const UPSTREAM_TIMEOUT_MS = 40_000;

/* Best-effort per-IP token window. Serverless instances scale horizontally,
   so this is a per-instance governor, not a hard quota — documented in the
   deployment notes. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const buckets = new Map<string, { reset: number; count: number }>();

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "ai_error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function clientIp(req: VercelRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = value?.split(",")[0]?.trim();
  if (first) return first;
  const real = req.headers["x-real-ip"];
  const single = Array.isArray(real) ? real[0] : real;
  return single?.trim() || req.socket?.remoteAddress || "unknown";
}

function isRateLimited(ip: string) {
  const now = Date.now();
  if (buckets.size > 5_000) {
    for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
  }
  const bucket = buckets.get(ip);
  if (!bucket || bucket.reset <= now) {
    buckets.set(ip, { reset: now + RATE_WINDOW_MS, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX_REQUESTS;
}

function messagesOf(req: VercelRequest): OpenRouterServerMessage[] {
  const raw = req.body;
  let body: Record<string, unknown> | null = null;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) body = raw as Record<string, unknown>;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "The AI request wasn't valid JSON.", "invalid_json");
    }
  }
  if (!body) throw new ApiError(400, "A conversation is required.", "missing_body");

  const list = body.messages;
  if (!Array.isArray(list) || list.length === 0) {
    throw new ApiError(400, "A conversation is required.", "messages_missing");
  }
  if (list.length > MAX_MESSAGES) {
    throw new ApiError(400, "That conversation is too long — start a new one.", "messages_too_many");
  }

  const messages: OpenRouterServerMessage[] = [];
  let total = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") throw new ApiError(400, "The conversation was malformed.", "message_invalid");
    const role = (entry as Record<string, unknown>).role;
    const content = (entry as Record<string, unknown>).content;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new ApiError(400, "The conversation was malformed.", "message_invalid");
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new ApiError(400, "The conversation was malformed.", "message_invalid");
    }
    if (content.length > LIMITS[role]) {
      throw new ApiError(400, "That message is too long.", "message_too_long");
    }
    total += content.length;
    messages.push({ role, content });
  }
  if (total > MAX_TOTAL_CHARS) {
    throw new ApiError(400, "That conversation is too long — start a new one.", "conversation_too_long");
  }
  // Keep the proxy pinned to the product assistant: authenticated app routes
  // (ai-interpret, ai-analyze) build their own prompts server-side, so this
  // endpoint only needs to serve the public assistant conversation shape.
  const [first, ...turns] = messages;
  if (first!.role !== "system" || !first!.content.includes(ASSISTANT_MARKER)) {
    throw new ApiError(400, "The conversation was malformed.", "message_invalid");
  }
  if (turns.some((m) => m.role === "system") || !turns.some((m) => m.role === "user")) {
    throw new ApiError(400, "The conversation was malformed.", "message_invalid");
  }
  return messages;
}

/** JSON response that works on Vercel, the local dev middleware, and tests. */
function sendJson(res: VercelResponse, status: number, body: Record<string, unknown>) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(body);
    return;
  }
  res.statusCode = status;
  if (typeof res.setHeader === "function") res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sseFrame(payload: Record<string, unknown> | "[DONE]") {
  return payload === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(payload)}\n\n`;
}

/* ------------------------------------------------------------------ */
/* Upstream OpenRouter SSE → Zybble SSE transcoding                     */
/* ------------------------------------------------------------------ */
async function pipeUpstream(upstream: Response, write: (frame: Record<string, unknown> | "[DONE]") => void) {
  const contentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
  let forwardedText = false;

  // Defensive: the gateway answered with a buffered JSON completion instead
  // of a stream — emit it as one delta so the browser contract never changes.
  if (!contentType.includes("text/event-stream")) {
    const raw = await upstream.text().catch(() => "");
    let payload: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      payload = null;
    }
    const text = payload ? completionMessageText(payload) : "";
    if (!text.trim()) {
      throw new OpenRouterError(502, "Zybble AI returned an empty response. Please try again.", "empty_response");
    }
    write({ text });
    write("[DONE]");
    return;
  }

  if (!upstream.body) {
    throw new OpenRouterError(502, "Zybble AI is temporarily unavailable. Please try again shortly.", "provider_unavailable");
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleEvent = (rawEvent: string) => {
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return; // comments / keepalives / sentinel
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return; // skip a malformed upstream chunk rather than breaking the reply
    }
    const delta = streamChunkDelta(payload); // throws on upstream error events
    if (delta) {
      forwardedText = true;
      write({ text: delta });
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
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
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  if (!forwardedText) {
    throw new OpenRouterError(502, "Zybble AI returned an empty response. Please try again.", "empty_response");
  }
  // The DONE sentinel terminates the browser stream even when the provider
  // closed its body without one.
  write("[DONE]");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed", code: "method_not_allowed" });
  }

  try {
    if (isRateLimited(clientIp(req))) {
      throw new ApiError(429, "Zybble AI is busy right now. Please try again shortly.", "rate_limited");
    }
    const messages = messagesOf(req);

    const abort = new AbortController();
    // Stop paying for tokens the moment the browser goes away.
    if (typeof req.on === "function") req.on("close", () => abort.abort());

    const upstream = await openRouterChatStream({
      messages,
      maxOutputTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      signal: abort.signal,
    });

    // Stream transcoded SSE back. Raw Node response APIs are used on purpose:
    // they behave identically on Vercel and in the local dev middleware.
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();

    const write = (frame: Record<string, unknown> | "[DONE]") => {
      res.write(sseFrame(frame));
    };

    try {
      await pipeUpstream(upstream, write);
    } catch (error) {
      // Pre-stream provider failures already returned JSON; once headers went
      // out, the only honest signal left is an in-stream error event.
      const message =
        error instanceof OpenRouterError
          ? error.message
          : "Zybble AI couldn't complete that request. Please try again.";
      write({ error: message });
      write("[DONE]");
    }
    res.end();

    console.log("api request", {
      route: "/api/ai-chat",
      status: 200,
      model: getOpenRouterModel(),
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const apiError =
      error instanceof ApiError
        ? error
        : error instanceof OpenRouterError
          ? new ApiError(error.status, error.message, error.code)
          : new ApiError(500, "The AI service couldn't complete that action. Please try again.", "unknown");
    console.error("api request", {
      route: "/api/ai-chat",
      status: apiError.status,
      code: apiError.code,
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, apiError.status, { error: apiError.message, code: apiError.code });
  }
}
