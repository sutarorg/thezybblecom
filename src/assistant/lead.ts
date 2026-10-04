/* ------------------------------------------------------------------ */
/* Zybble AI — progressive, consent-based email lead capture.          */
/*                                                                     */
/* Principles (enforced here and in the Assistant UI):                 */
/*  - the assistant's first answer is NEVER gated or interrupted;      */
/*  - an email is offered at most once per session, only after the     */
/*    visitor shows real intent (or sustained engagement);             */
/*  - declining is remembered for the whole session — no re-asks;      */
/*  - the email field only appears after the visitor says yes;         */
/*  - a capture failure degrades softly and never touches the chat.    */
/* ------------------------------------------------------------------ */

export type LeadState = "none" | "offered" | "declined" | "captured";

const STATE_KEY = "zybble.ai.lead.state";

export function getLeadState(): LeadState {
  try {
    const value = sessionStorage.getItem(STATE_KEY);
    if (value === "offered" || value === "declined" || value === "captured") return value;
  } catch {
    /* storage unavailable → treat as none (worst case: one offer) */
  }
  return "none";
}

export function setLeadState(state: LeadState) {
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Intent detection — deterministic, local, no AI involved.            */
/* Matches the "meaningful intent" moments where an optional inbox     */
/* follow-up is genuinely useful rather than interruptive.             */
/* ------------------------------------------------------------------ */
const INTENTS: { name: string; pattern: RegExp }[] = [
  { name: "pricing", pattern: /\b(pricing|price|cost|how much|plan|plans|subscription|upgrade|billing)\b/i },
  { name: "getting_started", pattern: /\b(get(ting)? started|start(ing)?|sign ?up|try (it|zybble)|free trial|begin|set ?up)\b/i },
  { name: "recommendation", pattern: /\b(recommend|which (plan|one)|best (plan|option)|should i|right for (me|us))\b/i },
  { name: "resource_request", pattern: /\b(checklist|guide|template|resource|summary|send|share|copy of|write (this|that) down)\b/i },
  { name: "email_interest", pattern: /\b(email (it|me|this)|inbox|mail (it|me))\b/i },
  { name: "team_usage", pattern: /\b(my (team|agency|company)|for (our|my) (team|agency|clients))\b/i },
];

/** Returns the matched intent name, or null. */
export function detectLeadIntent(text: string): string | null {
  for (const intent of INTENTS) {
    if (intent.pattern.test(text)) return intent.name;
  }
  return null;
}

/** Engagement fallback: offer after this many user turns even without an
 *  explicit intent match — sustained interest is itself a signal. Never
 *  less than 2, so the first answer is always offer-free. */
export const ENGAGEMENT_TURNS = 4;
/** With a detected intent, still wait until at least the 2nd user turn so
 *  the very first reply is never accompanied by an ask. */
export const MIN_TURNS_WITH_INTENT = 2;

export function shouldOfferLead(userTurns: number, intent: string | null): boolean {
  if (getLeadState() !== "none") return false;
  if (intent && userTurns >= MIN_TURNS_WITH_INTENT) return true;
  return userTurns >= ENGAGEMENT_TURNS;
}

/* ------------------------------------------------------------------ */
/* Attribution                                                         */
/* ------------------------------------------------------------------ */
export type LeadPayload = {
  email: string;
  page: string;
  firstQuestion: string;
  intent: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  /** Honeypot — always empty from the real UI. */
  website?: string;
};

export function collectAttribution(firstQuestion: string, intent: string | null): Omit<LeadPayload, "email"> {
  let utm = { utmSource: "", utmMedium: "", utmCampaign: "" };
  try {
    const params = new URLSearchParams(window.location.search);
    utm = {
      utmSource: params.get("utm_source") ?? "",
      utmMedium: params.get("utm_medium") ?? "",
      utmCampaign: params.get("utm_campaign") ?? "",
    };
  } catch {
    /* ignore */
  }
  return {
    page: window.location.pathname,
    firstQuestion: firstQuestion.slice(0, 400),
    intent: intent ?? "engaged_conversation",
    referrer: document.referrer.slice(0, 300),
    ...utm,
  };
}

/* ------------------------------------------------------------------ */
/* Submission                                                          */
/* ------------------------------------------------------------------ */
export async function submitAiLead(payload: LeadPayload): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch("/api/ai-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, message: typeof data.error === "string" ? data.error : undefined };
  } catch {
    return { ok: false };
  }
}
