// Server-side /find request interpretation contract — Supabase Edge (Deno)
// copy of api/_lib/interpret.ts; keep the two textually in sync.
//
// The interpretation runs inside the Zybble backend (DeepSeek V3.2 through
// OpenRouter, OPENROUTER_API_KEY). The contract is unchanged and mirrors
// src/lib/openrouter-ai.ts — the model only fills the filter form, every
// value is validated and clamped here, and the search itself is NEVER run.

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

export const INTERPRET_SYSTEM_PROMPT = `You turn a user's lead-discovery request into search-form filters.
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
 * business category was produced. Nothing the model emitted reaches the
 * search form unvalidated.
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
