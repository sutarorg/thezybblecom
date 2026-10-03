/* ------------------------------------------------------------------ */
/* Zybble — reusable client-side Puter.js AI helper.                   */
/*                                                                     */
/* One implementation shared by every AI surface in the browser: the   */
/* /find request interpreter and the landing-page assistant. All calls */
/* go through puter.ai.chat(...) with model deepseek/deepseek-v3.2 and */
/* stream: true; streamed part.text values are surfaced through an     */
/* onDelta callback so UIs render them as plain text (React escapes    */
/* text nodes — no HTML from the model is ever interpreted).           */
/*                                                                     */
/* Puter.js is loaded by the <script src="https://js.puter.com/v2/">   */
/* tag in index.html; ensurePuter() waits for it and self-heals by     */
/* injecting the same tag once if it is missing or was blocked.        */
/* No API key of any kind is required — Puter's User-Pays model keeps  */
/* provider credentials entirely out of this codebase.                 */
/* ------------------------------------------------------------------ */

/** Official Puter.js script tag (also present in index.html). */
export const PUTER_SCRIPT_SRC = "https://js.puter.com/v2/";

/** The only model Zybble's client-side AI surfaces use. */
export const PUTER_MODEL = "deepseek/deepseek-v3.2";

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
/* Minimal structural types for the Puter.js global (no official       */
/* type package exists; these describe only what we consume).          */
/* ------------------------------------------------------------------ */
type PuterStreamPart = {
  type?: unknown;
  text?: unknown;
  message?: unknown;
};
type PuterChatCompletion = {
  text?: unknown;
  message?: { content?: unknown } | Array<{ text?: unknown }>;
};
type PuterChatResult = AsyncIterable<PuterStreamPart> | PuterChatCompletion;

interface PuterGlobal {
  ai: {
    chat(
      prompt: string | PuterChatMessage[],
      options?: { model?: string; stream?: boolean },
    ): Promise<PuterChatResult>;
  };
}

declare global {
  interface Window {
    puter?: PuterGlobal;
  }
}

/* ------------------------------------------------------------------ */
/* Puter.js availability                                               */
/* ------------------------------------------------------------------ */
const PUTER_LOAD_TIMEOUT_MS = 15_000;
const PUTER_POLL_MS = 150;

let scriptInjected = false;

function injectPuterScript() {
  if (scriptInjected || typeof document === "undefined") return;
  scriptInjected = true;
  if (document.querySelector(`script[src="${PUTER_SCRIPT_SRC}"]`)) return;
  const script = document.createElement("script");
  script.src = PUTER_SCRIPT_SRC;
  script.async = true;
  document.head.appendChild(script);
}

function isPuterReady(puter: PuterGlobal | undefined): puter is PuterGlobal {
  return Boolean(puter?.ai && typeof puter.ai.chat === "function");
}

/**
 * Resolve the Puter.js global, waiting for the index.html script tag and
 * injecting it once if it never loaded. Throws a friendly PuterAIError when
 * AI is unavailable in this browser.
 */
export async function ensurePuter(timeoutMs = PUTER_LOAD_TIMEOUT_MS): Promise<PuterGlobal> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (isPuterReady(window.puter)) return window.puter;
    injectPuterScript();
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, PUTER_POLL_MS));
  }
  throw new PuterAIError(
    "Zybble AI couldn't load in your browser. Check your connection (or content blocker) and try again.",
    "ai_unavailable",
  );
}

/* ------------------------------------------------------------------ */
/* Streaming chat                                                      */
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

/** Text carried by one streamed part; anything else is ignored. */
function streamPartText(part: PuterStreamPart): string {
  if (part?.type === "error") {
    const message = typeof part.message === "string" ? part.message : "";
    throw new PuterAIError(
      message && !/https?:\/\//i.test(message) && message.length < 300
        ? `Zybble AI couldn't complete that request. ${message}`
        : "Zybble AI couldn't complete that request. Please try again.",
      "provider_error",
    );
  }
  return typeof part?.text === "string" ? sanitizeStreamText(part.text) : "";
}

/** Defensive text extraction for a non-streamed completion object. */
function completionText(result: PuterChatCompletion): string {
  if (typeof result?.text === "string") return sanitizeStreamText(result.text);
  const message = result?.message;
  if (message && !Array.isArray(message)) {
    const content = message.content;
    if (typeof content === "string") return sanitizeStreamText(content);
    if (Array.isArray(content)) {
      return content
        .map((part) => (part && typeof part.text === "string" ? part.text : ""))
        .join("");
    }
  }
  return "";
}

/** Race one stream chunk against an inactivity timeout. */
async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
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

/** Map a raw puter.ai.chat failure to a safe, friendly message. */
function toPuterAIError(error: unknown): PuterAIError {
  if (error instanceof PuterAIError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/permission|auth|sign.?in|log.?in|token/i.test(message)) {
    return new PuterAIError(
      "Zybble AI runs on Puter — complete the quick Puter sign-in (allow the pop-up) and try again.",
      "provider_error",
    );
  }
  if (/usage|limit|quota|credit/i.test(message)) {
    return new PuterAIError(
      "Zybble AI usage was declined by Puter. Check your Puter account and try again.",
      "provider_error",
    );
  }
  return new PuterAIError(
    "Zybble AI couldn't complete that request. Please try again.",
    "provider_error",
  );
}

export type StreamPuterChatOptions = {
  /** Called for every streamed part.text delta, already sanitized. */
  onDelta?: (delta: string) => void;
  /** Per-chunk inactivity timeout in milliseconds. */
  timeoutMs?: number;
};

/**
 * The one shared AI call: puter.ai.chat(messages, { model, stream: true }).
 * Consumes the stream, forwards every part.text through onDelta, and
 * resolves with the complete text. Falls back defensively to a non-streamed
 * completion shape if the runtime ignores `stream`.
 */
export async function streamPuterChat(
  messages: PuterChatMessage[],
  options?: StreamPuterChatOptions,
): Promise<string> {
  const puter = await ensurePuter();
  const timeoutMs = options?.timeoutMs ?? STREAM_TIMEOUT_MS;

  let response: PuterChatResult;
  try {
    response = await puter.ai.chat(messages, { model: PUTER_MODEL, stream: true });
  } catch (error) {
    throw toPuterAIError(error);
  }

  if (response && typeof (response as AsyncIterable<PuterStreamPart>)[Symbol.asyncIterator] === "function") {
    let full = "";
    const iterator = (response as AsyncIterable<PuterStreamPart>)[Symbol.asyncIterator]();
    for (;;) {
      let chunk: IteratorResult<PuterStreamPart>;
      try {
        chunk = await nextWithTimeout(iterator, timeoutMs);
      } catch (error) {
        throw toPuterAIError(error);
      }
      if (chunk.done) break;
      const delta = streamPartText(chunk.value);
      if (delta) {
        full += delta;
        options?.onDelta?.(delta);
      }
    }
    if (!full.trim()) {
      throw new PuterAIError("Zybble AI returned an empty response. Please try again.", "empty_response");
    }
    return full;
  }

  const text = completionText(response as PuterChatCompletion);
  if (!text.trim()) {
    throw new PuterAIError("Zybble AI returned an empty response. Please try again.", "empty_response");
  }
  options?.onDelta?.(text);
  return text;
}

/* ------------------------------------------------------------------ */
/* /find — natural-language request → search filters                   */
/*                                                                     */
/* Same contract the server-side interpreter used to enforce: the      */
/* model only fills the filter form, every value is validated and      */
/* clamped client-side, and the search itself is NEVER run.            */
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

const MAX_INTERPRET_LEADS = 240;

const INTERPRET_SYSTEM_PROMPT = `You turn a user's lead-discovery request into search-form filters.
You only fill the form; you do not run a search, consume quota, create leads, or claim that results were found.
Do not invent requirements. Use null for optional values the user did not request and false for requirements the user did not state.
Only set businessSize to small, medium, or enterprise when the user actually requests that size.
Keep category suitable for a Google Maps business search. Keep summary and notes concise.
Respond with ONLY a JSON object (no markdown, no code fences) using exactly this shape:
{"category": "string — the requested business category", "location": "string or null — only the location stated by the user", "quantity": "integer or null — the requested quantity", "minRating": "one of null, '3', '3.5', '4', '4.5'", "priceLevel": "one of null, '1', '2', '3', '4'", "businessSize": "one of null, 'small', 'medium', 'enterprise' — only when explicitly requested", "requireWebsite": false, "requirePhone": false, "requireEmail": false, "openNow": false, "summary": "one short sentence", "notes": ["at most two short strings"]}`;

function explicitlyRequestedBusinessSize(request: string, size: string) {
  const text = request.toLowerCase();
  if (size === "small")
    return /\bsmall(?:[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized))?\b/.test(text);
  if (size === "medium")
    return /\bmedium(?:[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized))?\b/.test(text);
  return /\benterprise(?:s)?\b|\blarge[- ](?:business(?:es)?|compan(?:y|ies)|firm(?:s)?|organization(?:s)?|sized)\b/.test(text);
}

/**
 * Validate and clamp a raw model interpretation. Returns null when no usable
 * business category was produced. Mirrors the validation the server-side
 * interpreter always applied before any value reached the search form.
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

/**
 * Interpret a plain-language lead request into search filters with the
 * shared DeepSeek V3.2 stream. One silent retry when the reply isn't usable
 * JSON; the result is fully validated and clamped. Never runs a search.
 */
export async function interpretSearchRequest(request: string): Promise<SearchInterpretation> {
  let sawCategoryMissing = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const system = attempt === 0
      ? INTERPRET_SYSTEM_PROMPT
      : `${INTERPRET_SYSTEM_PROMPT}\nYour previous reply was not usable. Respond with the JSON object only, and always include a non-empty "category".`;
    const text = await streamPuterChat([
      { role: "system", content: system },
      { role: "user", content: `User request: ${request}` },
    ]);
    const parsed = extractJsonObject(text);
    if (!parsed) continue;
    const cleaned = cleanInterpretResult(parsed, request);
    if (cleaned) return cleaned;
    sawCategoryMissing = true;
  }
  throw new PuterAIError(
    sawCategoryMissing
      ? "Zybble AI couldn't identify a business category. Try rephrasing."
      : "Zybble AI couldn't turn that into filters. Try rephrasing.",
    sawCategoryMissing ? "category_missing" : "malformed_response",
  );
}
