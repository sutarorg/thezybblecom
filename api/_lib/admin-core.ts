// ============================================================================
// Admin console — request plumbing, authorization and the audit trail.
//
// SECURITY MODEL (the whole point of this file)
//
//   browser  ──(Supabase session JWT, same-origin)──▶  /api/admin/*
//                                                        │
//                 1. Bearer token extracted              │
//                 2. token verified with Supabase auth   │
//                 3. profiles.role re-read server-side   │
//                 4. ONLY THEN privileged queries run    │
//                 5. every mutation writes an audit row  │
//
// The browser never receives a service-role key, a provider secret, or a raw
// database error. `isAdmin` in the client is a UX hint only: this module is
// the enforcement point, and it re-reads the role from the database on EVERY
// request, so a stale/forged client state, a tampered localStorage value or a
// hand-crafted curl request all fail the same way.
//
// NOTE: imported with the emitted ".js" extension (see
// api/_tests/module-resolution.test.ts) because Vercel compiles api/**/*.ts to
// .js without rewriting import specifiers.
// ============================================================================
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SupabaseServerConfigError } from "./supabase-server.js";
import { createServiceClient } from "./supabase-service.js";

export const ADMIN_ROUTE = "/api/admin";

export type VercelRequest = IncomingMessage & { body?: unknown };
export type VercelResponse = ServerResponse & {
  status(code: number): VercelResponse;
  json(body: unknown): void;
};
export type Json = Record<string, unknown>;

/** Every failure the admin API can return. Messages are always safe to show. */
export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "admin_error") {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what = "That record") =>
  new AdminApiError(404, `${what} doesn't exist.`, "not_found");

/* ------------------------------------------------------------------ */
/* Request parsing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Resolve `/api/admin/users/<id>` → ["users", "<id>"].
 *
 * In production, vercel.json rewrites `/api/admin/:path*` onto this single
 * function and passes the tail as `?path=`; the raw URL is used as a fallback
 * so the route also works when called directly as `/api/admin?path=…` or by
 * the Vite dev middleware.
 */
export function adminPathSegments(req: VercelRequest): string[] {
  const raw = req.url ?? "";
  const url = new URL(raw, "http://localhost");
  const fromQuery = url.searchParams.get("path") ?? "";
  const fromPath = url.pathname.replace(/^\/api\/admin\/?/, "");
  const source = fromQuery || fromPath;
  return source
    .split("/")
    .map((segment) => decodeURIComponent(segment.trim()))
    .filter(Boolean);
}

export function adminQuery(req: VercelRequest): URLSearchParams {
  const url = new URL(req.url ?? "", "http://localhost");
  url.searchParams.delete("path");
  return url.searchParams;
}

export function jsonBody(req: VercelRequest): Json {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body as Json;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
    } catch {
      throw new AdminApiError(400, "That request wasn't valid JSON.", "invalid_json");
    }
  }
  return {};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, what: string): string {
  const id = String(value ?? "").trim();
  if (!UUID.test(id)) throw new AdminApiError(400, `That ${what} id isn't valid.`, "invalid_id");
  return id;
}

export function optionalUuid(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return UUID.test(id) ? id : null;
}

export function readString(params: URLSearchParams, key: string, max = 160): string | null {
  const value = (params.get(key) ?? "").trim();
  if (!value) return null;
  return value.slice(0, max);
}

export function readEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = (params.get(key) ?? "").trim();
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function readInt(params: URLSearchParams, key: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(params.get(key) ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export type Pagination = { page: number; pageSize: number; offset: number };

export function readPagination(params: URLSearchParams, defaultSize = 25): Pagination {
  const pageSize = readInt(params, "pageSize", defaultSize, 5, 100);
  const page = readInt(params, "page", 1, 1, 10_000);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Hard ceiling so one request can never ask the database for a year of days. */
const MAX_RANGE_DAYS = 400;

export type DateRange = { from: string; to: string; days: number };

/**
 * Resolve ?range=today|7d|30d|90d|custom (+ ?from/?to for custom) into an
 * explicit, clamped UTC window. Defaults to the last 30 days.
 */
export function readRange(params: URLSearchParams): DateRange {
  const now = new Date();
  const preset = params.get("range") ?? "30d";
  const parseDate = (value: string | null) => {
    if (!value) return null;
    const parsed = new Date(value.length <= 10 ? `${value}T00:00:00.000Z` : value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  let from: Date;
  let to: Date = now;

  if (preset === "custom") {
    const customFrom = parseDate(params.get("from"));
    const customTo = parseDate(params.get("to"));
    from = customFrom ?? new Date(now.getTime() - 30 * 86_400_000);
    to = customTo ? new Date(customTo.getTime() + (params.get("to")!.length <= 10 ? 86_400_000 : 0)) : now;
  } else if (preset === "today") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  } else if (preset === "7d") {
    from = new Date(now.getTime() - 7 * 86_400_000);
  } else if (preset === "90d") {
    from = new Date(now.getTime() - 90 * 86_400_000);
  } else if (preset === "all") {
    from = new Date("2024-01-01T00:00:00.000Z");
  } else {
    from = new Date(now.getTime() - 30 * 86_400_000);
  }

  if (to.getTime() <= from.getTime()) to = new Date(from.getTime() + 86_400_000);
  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
  if (days > MAX_RANGE_DAYS) from = new Date(to.getTime() - MAX_RANGE_DAYS * 86_400_000);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    days: Math.min(days, MAX_RANGE_DAYS),
  };
}

/* ------------------------------------------------------------------ */
/* Authorization                                                       */
/* ------------------------------------------------------------------ */

export type AdminContext = {
  sb: SupabaseClient;
  user: User;
  adminName: string;
  adminEmail: string;
  ip: string | null;
  userAgent: string | null;
};

function bearerToken(req: VercelRequest): string {
  const header = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new AdminApiError(401, "Sign in to use the admin console.", "auth_missing");
  return token;
}

function clientIp(req: VercelRequest): string | null {
  const header = req.headers["x-forwarded-for"];
  const value = Array.isArray(header) ? header[0] : header;
  const first = value?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : null;
}

/**
 * The single authorization gate for every admin endpoint.
 *
 * 1. The bearer token must be a valid Supabase session (verified by Supabase,
 *    not by us decoding the JWT ourselves).
 * 2. `profiles.role` is re-read from the database for that user id.
 * 3. Anything other than 'admin' is a 403 — no exceptions, no env override,
 *    no "trusted email" list.
 */
export async function requireAdmin(req: VercelRequest): Promise<AdminContext> {
  const token = bearerToken(req);
  const sb = createServiceClient("admin", ADMIN_ROUTE);

  const {
    data: { user },
    error,
  } = await sb.auth.getUser(token);
  if (error && (error.name === "AuthRetryableFetchError" || error.status === 0)) {
    // The token may be perfectly valid — we simply couldn't reach Supabase.
    // Saying "your session expired" here would send the operator chasing the
    // wrong problem.
    console.error("admin authorization", { route: ADMIN_ROUTE, code: "auth_unreachable" });
    throw new AdminApiError(503, "We couldn't reach the authentication service. Try again in a moment.", "auth_unreachable");
  }
  if (error || !user) throw new AdminApiError(401, "Your session expired — sign in again.", "auth_invalid");

  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("admin authorization", { route: ADMIN_ROUTE, code: "profile_read_failed" });
    throw new AdminApiError(500, "We couldn't verify your access. Please try again.", "profile_read_failed");
  }
  if (!profile || profile.role !== "admin") {
    console.warn("admin authorization denied", { route: ADMIN_ROUTE, userId: user.id });
    throw new AdminApiError(403, "You don't have access to the Zybble admin console.", "forbidden");
  }

  const agent = req.headers["user-agent"];
  return {
    sb,
    user,
    adminName: String(profile.name ?? ""),
    adminEmail: user.email ?? "",
    ip: clientIp(req),
    userAgent: (Array.isArray(agent) ? agent[0] : agent)?.slice(0, 240) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Audit trail                                                         */
/* ------------------------------------------------------------------ */

export type AuditEntry = {
  action: string;
  targetType: "user" | "workspace" | "plan" | "subscription" | "usage" | "webhook" | "system";
  targetId?: string | null;
  targetLabel?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  metadata?: Json;
  result?: "success" | "failure";
  error?: string | null;
};

/**
 * Write one immutable audit row. Never throws: an audit write that fails must
 * be loud in the logs, but it must not convert a completed privileged
 * operation into a client-visible error (which would make the operator think
 * nothing happened). The table is append-only at the database level.
 */
export async function writeAudit(ctx: AdminContext, entry: AuditEntry): Promise<void> {
  const { error } = await ctx.sb.from("admin_audit_logs").insert({
    admin_user_id: ctx.user.id,
    admin_email: ctx.adminEmail,
    admin_name: ctx.adminName,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    target_label: entry.targetLabel ?? null,
    summary: entry.summary,
    before_state: entry.before ?? null,
    after_state: entry.after ?? null,
    metadata: entry.metadata ?? {},
    result: entry.result ?? "success",
    error: entry.error ?? null,
    ip: ctx.ip,
    user_agent: ctx.userAgent,
  });
  if (error) {
    console.error("admin audit write failed", {
      route: ADMIN_ROUTE,
      action: entry.action,
      targetType: entry.targetType,
      code: error.code,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Database access helpers                                             */
/* ------------------------------------------------------------------ */

/**
 * Call one of the admin SECURITY DEFINER functions (migration 0008). These
 * are granted to `service_role` only, so they are unreachable from a browser
 * session even with a valid customer JWT.
 */
export async function adminRpc<T>(ctx: AdminContext, fn: string, args: Json = {}): Promise<T> {
  const { data, error } = await ctx.sb.rpc(fn, args);
  if (error) {
    // Raw Postgres errors are logged, never returned: they can leak schema
    // details, and they are useless to the operator reading a toast.
    console.error("admin query failed", { route: ADMIN_ROUTE, fn, code: error.code });
    throw new AdminApiError(500, "We couldn't load that data. Please try again.", "query_failed");
  }
  return data as T;
}

/** Translate any thrown value into a safe JSON error response. */
export function respondWithError(res: VercelResponse, error: unknown, context: string) {
  const apiError =
    error instanceof AdminApiError
      ? error
      : error instanceof SupabaseServerConfigError
        ? new AdminApiError(error.status, error.message, error.code)
        : new AdminApiError(500, "The admin service couldn't complete that action. Please try again.", "unknown");

  if (!(error instanceof AdminApiError)) {
    console.error("admin request failed", {
      route: ADMIN_ROUTE,
      context,
      status: apiError.status,
      code: apiError.code,
      name: error instanceof Error ? error.name : typeof error,
    });
  }
  return res.status(apiError.status).json({ error: apiError.message, code: apiError.code });
}
