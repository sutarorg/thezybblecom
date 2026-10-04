// ============================================================================
// ai-lead — consent-based email capture for the Zybble AI assistant.
//
// The assistant only shows an email field after the visitor explicitly
// accepts an offer ("Want me to send that to your inbox?"), so everything
// arriving here is consented. The route validates + normalizes the email,
// applies best-effort anti-abuse limits, and forwards the lead to Web3Forms
// server-side. The browser never talks to the form provider for AI leads and
// a failure here must never break the chat — the client treats any error as
// a soft, retryable state.
//
// Privacy: only the fields below are stored/forwarded — never the
// conversation transcript. Nothing sensitive is logged.
// ============================================================================
import type { IncomingMessage, ServerResponse } from "node:http";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };

export const maxDuration = 15;

const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";
/* Web3Forms access keys are public-by-design (they can only submit to the
   inbox they were created for). The env var is still preferred so the key
   can be rotated without a code change; this fallback keeps the feature
   working out of the box and matches the key already used by /contact. */
const FALLBACK_ACCESS_KEY = "05b0c5ca-dd84-41c9-9611-304238cb58de";

function accessKey(): string {
  return process.env.WEB3FORMS_ACCESS_KEY?.trim() || FALLBACK_ACCESS_KEY;
}

/* ------------------------------------------------------------------ */
/* Best-effort per-instance anti-abuse                                 */
/* ------------------------------------------------------------------ */
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX_REQUESTS = 5;
const ipBuckets = new Map<string, { reset: number; count: number }>();
/** Recently captured emails — absorbs double-clicks and replay spam. */
const recentEmails = new Map<string, number>();
const DUPLICATE_WINDOW_MS = 10 * 60_000;

function clientIp(req: VercelRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = value?.split(",")[0]?.trim();
  if (first) return first;
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  if (ipBuckets.size > 5_000) {
    for (const [key, bucket] of ipBuckets) if (bucket.reset <= now) ipBuckets.delete(key);
  }
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.reset <= now) {
    ipBuckets.set(ip, { reset: now + RATE_WINDOW_MS, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX_REQUESTS;
}

function isRecentDuplicate(email: string): boolean {
  const now = Date.now();
  if (recentEmails.size > 5_000) {
    for (const [key, ts] of recentEmails) if (ts + DUPLICATE_WINDOW_MS <= now) recentEmails.delete(key);
  }
  const last = recentEmails.get(email);
  recentEmails.set(email, now);
  return Boolean(last && last + DUPLICATE_WINDOW_MS > now);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parseBody(req: VercelRequest): Record<string, unknown> | null {
  const raw = req.body;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Clamp an optional free-text attribution field to a safe plain string. */
function field(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if ((req.method ?? "").toUpperCase() !== "POST") {
    return res.status(405).json({ error: "Use POST /api/ai-lead." });
  }

  if (isRateLimited(clientIp(req))) {
    return res.status(429).json({ error: "Too many requests. Please try again in a few minutes." });
  }

  const body = parseBody(req);
  if (!body) return res.status(400).json({ error: "Invalid request." });

  // Honeypot: real UI never fills this field.
  if (field(body.website, 64)) return res.status(200).json({ ok: true });

  const email = field(body.email, 254).toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }

  // Idempotent: a duplicate inside the window reports success without
  // forwarding again, so double-clicks never produce double submissions.
  if (isRecentDuplicate(email)) return res.status(200).json({ ok: true });

  const lead = {
    access_key: accessKey(),
    subject: "Zybble AI lead — new email capture",
    from_name: "Zybble AI",
    email,
    source: "zybble_ai",
    page: field(body.page, 200),
    first_question: field(body.firstQuestion, 400),
    conversation_intent: field(body.intent, 120),
    referrer: field(body.referrer, 300),
    utm_source: field(body.utmSource, 120),
    utm_medium: field(body.utmMedium, 120),
    utm_campaign: field(body.utmCampaign, 120),
    captured_at: new Date().toISOString(),
  };

  try {
    const upstream = await fetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await upstream.json().catch(() => ({}))) as { success?: boolean };
    if (upstream.ok && data.success) return res.status(200).json({ ok: true });
    // Upstream details stay server-side; the client gets a safe message.
    return res.status(502).json({ error: "We couldn't save your email right now. Please try again." });
  } catch {
    return res.status(502).json({ error: "We couldn't save your email right now. Please try again." });
  }
}
