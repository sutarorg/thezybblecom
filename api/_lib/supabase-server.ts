// ============================================================================
// Server-side Supabase configuration for the Vercel Functions in api/.
//
// The browser bundle configures Supabase with VITE_SUPABASE_URL /
// VITE_SUPABASE_PUBLISHABLE_KEY, which Vite inlines at BUILD time. Those
// variables never reach the Node runtime of a Vercel Function, so every
// server route resolves its own runtime configuration through this module:
//
//   SUPABASE_URL               (required) project URL
//   SUPABASE_PUBLISHABLE_KEY   (required) publishable key
//   SUPABASE_ANON_KEY          (optional) legacy anon-key fallback
//
// Values are trimmed (dashboard copy/paste often carries stray whitespace)
// and validated (URL shape; secret keys are rejected so RLS stays enforced).
// Every failure names the exact variable to fix and never logs or returns
// the configured value itself.
//
// NOTE: like the other files in api/_lib, this module is imported with the
// emitted ".js" extension (see api/module-resolution.test.ts) because Vercel
// compiles api/**/*.ts to .js without rewriting import specifiers.
// ============================================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL_VAR = "SUPABASE_URL";
export const SUPABASE_KEY_VAR = "SUPABASE_PUBLISHABLE_KEY";
export const SUPABASE_ANON_KEY_VAR = "SUPABASE_ANON_KEY";

export type SupabaseKeyVariable = typeof SUPABASE_KEY_VAR | typeof SUPABASE_ANON_KEY_VAR;

export type ValidSupabaseServerConfig = {
  url: string;
  key: string;
  keyVariable: SupabaseKeyVariable;
};

export type SupabaseConfigProblem = "missing" | "invalid_url" | "secret_key" | "client_creation";

/**
 * Thrown when the Vercel Function cannot build a user-scoped Supabase client.
 * Each route maps this onto its own ApiError so the JSON response carries the
 * actionable, secret-free message verbatim.
 */
export class SupabaseServerConfigError extends Error {
  readonly status = 500;
  readonly code = "supabase_config";
  readonly problem: SupabaseConfigProblem;
  readonly missing: string[];

  constructor(message: string, problem: SupabaseConfigProblem, missing: string[] = []) {
    super(message);
    this.name = "SupabaseServerConfigError";
    this.problem = problem;
    this.missing = missing;
  }
}

/** Read the first non-empty server environment variable, trimmed. */
export function readServerEnv(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** "Missing server environment variable: NAME." — plural-aware. */
export function missingEnvMessage(variableNames: string[]): string {
  const list = variableNames.map((name) => name.trim()).filter(Boolean);
  if (list.length === 0) return "Missing server environment variable.";
  if (list.length === 1) return `Missing server environment variable: ${list[0]}.`;
  return `Missing server environment variables: ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}.`;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Reject service-role / secret keys: these API routes must run with the
 * caller's bearer token so row-level security and reserve_leads() remain the
 * security boundary. A secret key would silently bypass RLS, so it is a hard
 * configuration error. New-style secrets start with `sb_secret_`; legacy
 * service-role keys are JWTs whose payload carries "role": "service_role".
 */
export function looksLikeServiceRoleKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  if (!key.startsWith("eyJ")) return false;
  try {
    const payloadPart = key.split(".")[1] ?? "";
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64)) as { role?: unknown };
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

const VERCEL_WHERE = "Vercel → Project → Settings → Environment Variables (Production, Preview, Development)";

/**
 * Resolve and validate the server-side Supabase configuration. Throws
 * SupabaseServerConfigError with an actionable, secret-free message that
 * names exactly which variable is absent or malformed.
 */
export function requireSupabaseServerConfig(serverLabel: string): ValidSupabaseServerConfig {
  const url = readServerEnv(SUPABASE_URL_VAR);
  const publishableKey = readServerEnv(SUPABASE_KEY_VAR);
  const anonKey = readServerEnv(SUPABASE_ANON_KEY_VAR);
  const key = publishableKey || anonKey;
  const keyVariable: SupabaseKeyVariable = publishableKey ? SUPABASE_KEY_VAR : SUPABASE_ANON_KEY_VAR;

  const missing: string[] = [];
  if (!url) missing.push(SUPABASE_URL_VAR);
  if (!key) missing.push(`${SUPABASE_KEY_VAR} (or ${SUPABASE_ANON_KEY_VAR})`);
  if (missing.length > 0) {
    // VITE_* values are build-time browser variables and never satisfy these
    // process.env lookups — the most common production misconfiguration, so
    // the error says so explicitly instead of failing opaquely.
    const message =
      `The ${serverLabel} server isn't connected to Supabase. ${missingEnvMessage(missing)} ` +
      `Add ${missing.length > 1 ? "them" : "it"} in ${VERCEL_WHERE}, then redeploy. ` +
      `VITE_SUPABASE_* variables are browser build values and cannot be used here.`;
    console.error("server config", { runtime: "vercel-function", code: "supabase_config", problem: "missing", missing });
    throw new SupabaseServerConfigError(message, "missing", missing);
  }

  if (!isHttpUrl(url)) {
    const message =
      `The ${serverLabel} server has invalid Supabase configuration. ` +
      `${SUPABASE_URL_VAR} isn't a valid URL — it should be your project URL such as YOUR_PROJECT.supabase.co with the https scheme. ` +
      `Update the value in ${VERCEL_WHERE}, then redeploy.`;
    console.error("server config", { runtime: "vercel-function", code: "supabase_config", problem: "invalid_url" });
    throw new SupabaseServerConfigError(message, "invalid_url");
  }

  if (looksLikeServiceRoleKey(key)) {
    const message =
      `The ${serverLabel} server has invalid Supabase configuration. ` +
      `${keyVariable} is a server secret key, which would bypass row-level security. ` +
      `Use the project's publishable key so user authorization and RLS stay enforced. ` +
      `Update the value in ${VERCEL_WHERE}, then redeploy.`;
    console.error("server config", { runtime: "vercel-function", code: "supabase_config", problem: "secret_key", keyVariable });
    throw new SupabaseServerConfigError(message, "secret_key");
  }

  return { url, key, keyVariable };
}

/**
 * Create a user-scoped Supabase client for a Vercel Function. The caller's
 * bearer token is forwarded on every database request, so RLS policies and
 * reserve_leads() evaluate as the signed-in user — never as a server role.
 */
export function createUserSupabaseClient(
  config: ValidSupabaseServerConfig,
  token: string,
  options: { serverLabel?: string; requestTimeoutMs?: number } = {},
): SupabaseClient {
  const label = options.serverLabel ?? "server";
  const databaseFetch: typeof fetch | undefined = options.requestTimeoutMs
    ? (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(options.requestTimeoutMs as number) })
    : undefined;
  try {
    return createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { Authorization: `Bearer ${token}` },
        ...(databaseFetch ? { fetch: databaseFetch } : {}),
      },
    });
  } catch {
    console.error("server config", { runtime: "vercel-function", code: "supabase_config", problem: "client_creation" });
    throw new SupabaseServerConfigError(
      `The ${label} server has invalid Supabase configuration. ` +
        `Check ${SUPABASE_URL_VAR} and ${config.keyVariable} for formatting errors.`,
      "client_creation",
    );
  }
}
