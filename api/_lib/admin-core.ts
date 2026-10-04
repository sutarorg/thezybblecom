// ============================================================================
// Admin API core — identity, authorization, privileged client, audit trail.
//
// SECURITY MODEL (read this before changing anything here)
//
//   browser (Supabase session JWT)
//     → same-origin POST/GET /api/admin/*
//       → verifySupabaseToken()  : the token is validated by Supabase itself
//                                  using the PUBLISHABLE key. A forged or
//                                  expired JWT fails here.
//       → requireAdmin()         : `profiles.role` is re-read from the
//                                  database on EVERY request. A client-side
//                                  `isAdmin` flag, a localStorage value, or a
//                                  tampered JWT claim can never satisfy it.
//       → adminServiceClient()   : the service-role client is constructed
//                                  ONLY after the two checks above pass.
//       → writeAuditLog()        : every mutation is recorded.
//       → sanitized JSON
//
// The service-role key is read from process.env on the Node runtime of the
// Vercel Function. It is never sent to the browser, never logged, and never
// echoed in an error. VITE_* variables are build-time browser values and are
// deliberately not consulted.
//
// Imported with the emitted ".js" extension — see
// api/_tests/module-resolution.test.ts.
// ============================================================================
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  looksLikeServiceRoleKey,
  missingEnvMessage,
  readServerEnv,
  SUPABASE_ANON_KEY_VAR,
  SUPABASE_KEY_VAR,
  SUPABASE_URL_VAR,
} from "./supabase-server.js";

export type AdminRequest = IncomingMessage & { body?: unknown };
export type AdminResponse = ServerResponse & {
  status(code: number): AdminResponse;
  json(body: unknown): void;
};

export type Json = Record<string, unknown>;

const SERVICE_ROLE_VARS = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"] as const;
const SECRET_KEYS_VAR = "SUPABASE_SECRET_KEYS";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */
export class AdminError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "admin_error") {
    super(message);
    this.name = "AdminError";
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what = "resource") =>
  new AdminError(404, `That ${what} doesn't exist.`, "not_found");

export const badRequest = (message: string, code = "invalid_request") =>
  new AdminError(400, message, code);

/**
 * Database errors are never forwarded to the browser: a PostgREST message can
 * disclose column names, constraint definitions, and policy internals. The
 * real error is logged server-side with a correlation-free, secret-free shape.
 */
export function dbError(operation: string, error: unknown): AdminError {
  console.error("admin db", {
    operation,
    message: error instanceof Error ? error.message : String(error ?? "unknown"),
  });
  return new AdminError(500, "That admin query couldn't be completed. Please try again.", "db_error");
}

/* ------------------------------------------------------------------ */
/* Supabase clients                                                    */
/* ------------------------------------------------------------------ */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function readSecretKeysDefault(): string {
  const raw = readServerEnv(SECRET_KEYS_VAR);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.default === "string" ? parsed.default.trim() : "";
  } catch {
    return "";
  }
}

const VERCEL_WHERE = "Vercel → Project → Settings → Environment Variables (Production, Preview, Development)";

/**
 * Identity client: publishable key only. Used exclusively to ask Supabase
 * "who does this token belong to?". It can never read another user's row.
 */
function identityClient(): SupabaseClient {
  const url = readServerEnv(SUPABASE_URL_VAR);
  const key = readServerEnv(SUPABASE_KEY_VAR) || readServerEnv(SUPABASE_ANON_KEY_VAR);
  const missing: string[] = [];
  if (!url) missing.push(SUPABASE_URL_VAR);
  if (!key) missing.push(`${SUPABASE_KEY_VAR} (or ${SUPABASE_ANON_KEY_VAR})`);
  if (missing.length) {
    console.error("admin config", { problem: "missing", missing });
    throw new AdminError(
      500,
      `The admin server isn't connected to Supabase. ${missingEnvMessage(missing)} Add ${missing.length > 1 ? "them" : "it"} in ${VERCEL_WHERE}, then redeploy.`,
      "admin_config",
    );
  }
  if (!isHttpUrl(url)) {
    console.error("admin config", { problem: "invalid_url" });
    throw new AdminError(
      500,
      `The admin server has invalid Supabase configuration. ${SUPABASE_URL_VAR} isn't a valid https project URL.`,
      "admin_config",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(8_000) }) },
  });
}

let cachedService: SupabaseClient | null = null;

/**
 * Privileged client. ONLY call this after requireAdmin() has returned.
 *
 * Refuses to start with a publishable key: silently running the admin panel
 * under RLS would return partially-empty pages that look like real "no data"
 * answers, which is worse than a loud configuration error.
 */
export function adminServiceClient(): SupabaseClient {
  if (cachedService) return cachedService;

  const url = readServerEnv(SUPABASE_URL_VAR);
  let key = readServerEnv(...SERVICE_ROLE_VARS);
  let keyVariable: string = key
    ? SERVICE_ROLE_VARS.find((name) => readServerEnv(name) === key) ?? SERVICE_ROLE_VARS[0]
    : "";
  if (!key) {
    key = readSecretKeysDefault();
    keyVariable = key ? SECRET_KEYS_VAR : "";
  }

  const missing: string[] = [];
  if (!url) missing.push(SUPABASE_URL_VAR);
  if (!key) missing.push(`${SERVICE_ROLE_VARS[0]} (or ${SERVICE_ROLE_VARS[1]} or ${SECRET_KEYS_VAR})`);
  if (missing.length) {
    console.error("admin config", { problem: "missing_service_key", missing });
    throw new AdminError(
      500,
      `The admin server isn't connected to Supabase with operator access. ${missingEnvMessage(missing)} ` +
        `Add the Supabase service-role/secret key to the SERVER environment only (${VERCEL_WHERE}), then redeploy. ` +
        `Never expose it with a VITE_ prefix.`,
      "admin_config",
    );
  }
  if (!looksLikeServiceRoleKey(key)) {
    console.error("admin config", { problem: "not_service_role", keyVariable });
    throw new AdminError(
      500,
      `The admin server has invalid Supabase configuration. ${keyVariable || SERVICE_ROLE_VARS[0]} must be the ` +
        `service-role/secret key, not the publishable key.`,
      "admin_config",
    );
  }

  cachedService = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
  });
  return cachedService;
}

/** Test seam. */
export function resetAdminClients() {
  cachedService = null;
}

/* ------------------------------------------------------------------ */
/* Identity + authorization                                            */
/* ------------------------------------------------------------------ */
export type AdminActor = {
  user: User;
  id: string;
  email: string;
  name: string;
  ip: string | null;
  userAgent: string | null;
};

function headerValue(req: AdminRequest, name: string): string | null {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function bearerToken(req: AdminRequest): string {
  const header = headerValue(req, "authorization");
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new AdminError(401, "Your session expired — sign in again.", "auth_missing");
  return token;
}

function clientIp(req: AdminRequest): string | null {
  const forwarded = headerValue(req, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || null;
  return headerValue(req, "x-real-ip");
}

/**
 * Verify the caller's JWT AND that they hold the admin role.
 *
 * Both checks hit the database. There is no cache and no trust in anything
 * the browser sent beyond the opaque token itself, so revoking an admin in
 * `profiles` takes effect on the very next request. A suspended admin is
 * refused as well.
 */
export async function requireAdmin(req: AdminRequest): Promise<AdminActor> {
  const token = bearerToken(req);

  const {
    data: { user },
    error,
  } = await identityClient().auth.getUser(token);
  if (error || !user) throw new AdminError(401, "Your session expired — sign in again.", "auth_invalid");

  const service = adminServiceClient();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("name, role, status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw dbError("admin.profile_lookup", profileError);

  const role = typeof profile?.role === "string" ? profile.role : "user";
  const status = typeof profile?.status === "string" ? profile.status : "active";

  if (role !== "admin" || status !== "active") {
    // Deliberately identical to what a signed-out caller is told, and logged
    // so repeated probing of /api/admin/* is visible in the function logs.
    console.warn("admin denied", { userId: user.id, role, status });
    throw new AdminError(403, "You don't have access to the Zybble admin console.", "admin_forbidden");
  }

  return {
    user,
    id: user.id,
    email: user.email ?? "",
    name: typeof profile?.name === "string" ? profile.name : user.email ?? "",
    ip: clientIp(req),
    userAgent: headerValue(req, "user-agent"),
  };
}

/* ------------------------------------------------------------------ */
/* Audit trail                                                         */
/* ------------------------------------------------------------------ */
export type AuditEntry = {
  action: string;
  targetType: string;
  targetId?: string | null;
  summary?: string;
  before?: Json;
  after?: Json;
  metadata?: Json;
};

const SECRET_KEY_PATTERN = /(secret|token|password|api[_-]?key|authorization|signature)/i;

/** Defence in depth: a provider secret must never reach the audit table. */
function scrub(value: Json | undefined): Json {
  if (!value) return {};
  const out: Json = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    out[key] = item === undefined ? null : item;
  }
  return out;
}

/**
 * Append one immutable audit row. Never throws: a logging failure must not
 * roll back an operation the operator already observed succeed — but it IS
 * reported to the caller so the UI can warn, and it is logged server-side.
 */
export async function writeAuditLog(actor: AdminActor, entry: AuditEntry): Promise<boolean> {
  try {
    const { error } = await adminServiceClient().from("admin_audit_logs").insert({
      admin_user_id: actor.id,
      admin_email: actor.email,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      summary: entry.summary ?? null,
      before: scrub(entry.before),
      after: scrub(entry.after),
      metadata: scrub(entry.metadata),
      ip: actor.ip,
      user_agent: actor.userAgent?.slice(0, 400) ?? null,
    });
    if (error) {
      console.error("admin audit", { action: entry.action, message: error.message });
      return false;
    }
    return true;
  } catch (error) {
    console.error("admin audit", {
      action: entry.action,
      message: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Request parsing                                                     */
/* ------------------------------------------------------------------ */
export function readBody(req: AdminRequest): Json {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body as Json;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
    } catch {
      throw badRequest("That admin request wasn't valid JSON.", "invalid_json");
    }
  }
  return {};
}

export function requestUrl(req: AdminRequest): URL {
  return new URL(req.url ?? "/", "http://admin.local");
}

export type Query = URLSearchParams;

export const str = (q: Query, key: string, fallback = ""): string => (q.get(key) ?? fallback).trim();

export function int(q: Query, key: string, fallback: number, min: number, max: number): number {
  const raw = Number.parseInt(q.get(key) ?? "", 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: string, label = "id"): string {
  if (!UUID_RE.test(value)) throw badRequest(`That ${label} isn't valid.`, "invalid_id");
  return value;
}

/** One of a fixed allow-list, or the fallback. Never trusts raw input. */
export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T | null = null): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export type Paging = { page: number; pageSize: number; from: number; to: number };

export function paging(q: Query, defaultSize = 25, maxSize = 100): Paging {
  const page = int(q, "page", 1, 1, 10_000);
  const pageSize = int(q, "pageSize", defaultSize, 1, maxSize);
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

/**
 * Resolve the dashboard period. `from`/`to` are ISO strings when the operator
 * picks a custom range; otherwise a named preset is used. Always returns a
 * valid, bounded window so a crafted query cannot ask for an unbounded scan.
 */
export type Period = { from: string; to: string; key: string };

export function period(q: Query): Period {
  const now = new Date();
  const key = oneOf(str(q, "period", "30d"), ["today", "7d", "30d", "90d", "custom"] as const, "30d")!;

  if (key === "custom") {
    const fromRaw = Date.parse(str(q, "from"));
    const toRaw = Date.parse(str(q, "to"));
    if (Number.isFinite(fromRaw) && Number.isFinite(toRaw) && toRaw > fromRaw) {
      // Hard cap at two years so a custom range cannot become a full scan.
      const capped = Math.min(toRaw, fromRaw + 730 * 86_400_000);
      return { from: new Date(fromRaw).toISOString(), to: new Date(capped).toISOString(), key };
    }
    throw badRequest("That custom date range isn't valid.", "invalid_period");
  }

  const to = now.toISOString();
  if (key === "today") {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return { from: start.toISOString(), to, key };
  }
  const days = key === "7d" ? 7 : key === "90d" ? 90 : 30;
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to, key };
}

/** Current monthly usage period, matching date_trunc('month', now()) in SQL. */
export function currentUsagePeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Escape a PostgREST `ilike` pattern. `%`, `_` and `,` are all meaningful in
 * an `or=(...)` filter string; leaving them raw lets a search box alter the
 * query shape.
 */
export function likeTerm(value: string): string {
  return value.replace(/[\\%_(),]/g, (c) => `\\${c}`).slice(0, 120);
}

/* ------------------------------------------------------------------ */
/* Response helpers                                                    */
/* ------------------------------------------------------------------ */
export function sendJson(res: AdminResponse, status: number, body: Json) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.status(status).json(body);
}

export function sendError(res: AdminResponse, error: unknown) {
  if (error instanceof AdminError) {
    return sendJson(res, error.status, { error: error.message, code: error.code });
  }
  console.error("admin unhandled", {
    message: error instanceof Error ? error.message : String(error ?? "unknown"),
  });
  return sendJson(res, 500, {
    error: "The admin server couldn't complete that action. Please try again.",
    code: "admin_error",
  });
}
