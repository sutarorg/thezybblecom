// Shared open-state normalization for Supabase Edge Functions.
//
// Pure, dependency-free TypeScript so the exact same module can be imported
// by every Edge Function (Deno, explicit .ts specifier) and by the Node-side
// regression tests (vitest) — the behavior must never drift from the Vercel
// implementation in api/_lib/search-core.ts.

export type OpenState = "open" | "closed" | "unknown";

/**
 * Normalize a provider "open_state"/hours string into open/closed/unknown.
 *
 * Real provider shapes (SerpApi Google Maps and friends) include:
 *   "Open", "Open · Closes 9 PM", "Open · Closes 10 PM", "Open 24 hours",
 *   "Currently open", "Closed", "Closed · Opens 8 AM", "Temporarily closed",
 *   "Permanently closed".
 *
 * The leading token is the current state; anything after "·"/"⋅" describes the
 * NEXT transition ("Closes 9 PM" ⇒ still open, "Opens 8 AM" ⇒ still closed).
 * So a business must never be classified as closed merely because its text
 * contains the word "close" (e.g. "Open · Closes 9 PM" is OPEN).
 */
export function normalizeOpenState(value: unknown): OpenState {
  if (typeof value !== "string") return "unknown";
  const text = value.trim().toLowerCase();
  if (!text) return "unknown";

  // Explicit long-term closures always win, wherever they appear.
  if (/\b(?:permanently|temporarily)\s+closed\b/.test(text)) return "closed";

  // The leading state token is authoritative in provider payloads.
  if (/^closed\b/.test(text)) return "closed";
  if (/^open\b/.test(text)) return "open";

  // Common natural-language states without the leading-token shape.
  if (/\b(?:currently open|open now|open 24 hours?)\b/.test(text)) return "open";
  if (/\bpermanently closed\b|\bclosed now\b/.test(text)) return "closed";

  // "Closes 9 PM" describes a business that is open right now; "Opens 8 AM"
  // describes one that is closed right now.
  if (/\bcloses\b/.test(text)) return "open";
  if (/\bopens\b/.test(text)) return "closed";

  // Remaining explicit mentions.
  if (/\bclosed\b/.test(text)) return "closed";
  if (/\bopen\b/.test(text)) return "open";

  return "unknown";
}
