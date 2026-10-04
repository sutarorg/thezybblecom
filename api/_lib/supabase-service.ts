// ============================================================================
// Privileged (service-role) Supabase configuration for Vercel Functions.
//
// Extracted from api/billing.ts so the billing route and the admin console
// share ONE definition of "how a server route gets write access to Supabase",
// including the guard that refuses a publishable/anon key where a secret key
// is required.
//
// This client bypasses row-level security by design. Every caller must have
// authorized the request BEFORE creating it:
//   • /api/billing   — acts only on the authenticated caller's own rows.
//   • /api/admin/*   — verifies the caller's JWT and `profiles.role = 'admin'`
//                      before any privileged read or write.
//
// The key never leaves the Node runtime: it is read from process.env, never
// logged, never echoed into a response, and never exposed as a VITE_ value.
//
// NOTE: imported with the emitted ".js" extension (see
// api/_tests/module-resolution.test.ts) because Vercel compiles api/**/*.ts to
// .js without rewriting import specifiers.
// ============================================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  looksLikeServiceRoleKey,
  missingEnvMessage,
  readServerEnv,
  SupabaseServerConfigError,
  SUPABASE_URL_VAR,
} from "./supabase-server.js";

export const SERVICE_ROLE_VARS = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"] as const;
export const SECRET_KEYS_VAR = "SUPABASE_SECRET_KEYS";

export type SupabaseServiceConfig = {
  url: string;
  key: string;
  keyVariable: string;
};

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Supabase's newer projects expose their secret keys as a JSON document in
 * SUPABASE_SECRET_KEYS. Only the `default` entry is used.
 */
function readSecretKeysDefault(label: string): string {
  const raw = readServerEnv(SECRET_KEYS_VAR);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.default === "string" ? parsed.default.trim() : "";
  } catch {
    throw new SupabaseServerConfigError(
      `The ${label} server has invalid Supabase secret configuration. ${SECRET_KEYS_VAR} must be the JSON value Supabase provides, with a string default key.`,
      "invalid_url",
    );
  }
}

/**
 * Resolve the service-role configuration, with messages that name the exact
 * variable to fix and never contain the value itself.
 */
export function requireSupabaseServiceConfig(label: string, route: string): SupabaseServiceConfig {
  const url = readServerEnv(SUPABASE_URL_VAR);
  let key = readServerEnv(...SERVICE_ROLE_VARS);
  let keyVariable = key
    ? SERVICE_ROLE_VARS.find((name) => readServerEnv(name) === key) ?? SERVICE_ROLE_VARS[0]
    : "";

  if (!key) {
    key = readSecretKeysDefault(label);
    keyVariable = key ? SECRET_KEYS_VAR : "";
  }

  const missing: string[] = [];
  if (!url) missing.push(SUPABASE_URL_VAR);
  if (!key) missing.push(`${SERVICE_ROLE_VARS[0]} (or ${SERVICE_ROLE_VARS[1]} or ${SECRET_KEYS_VAR})`);

  if (missing.length > 0) {
    const message =
      `The ${label} server isn't connected to Supabase with write access. ${missingEnvMessage(missing)} ` +
      `Add the Supabase service-role/secret key only to the server environment, then redeploy. ` +
      `Do not use VITE_SUPABASE_* or the publishable key for ${label} writes.`;
    console.error("server config", { runtime: "vercel-function", route, code: "supabase_config", problem: "missing", missing });
    throw new SupabaseServerConfigError(message, "missing", missing);
  }

  if (!isHttpUrl(url)) {
    const message =
      `The ${label} server has invalid Supabase configuration. ` +
      `${SUPABASE_URL_VAR} isn't a valid URL — it should be your project URL with the https scheme.`;
    console.error("server config", { runtime: "vercel-function", route, code: "supabase_config", problem: "invalid_url" });
    throw new SupabaseServerConfigError(message, "invalid_url");
  }

  if (!looksLikeServiceRoleKey(key)) {
    const message =
      `The ${label} server has invalid Supabase configuration. ` +
      `${keyVariable || SERVICE_ROLE_VARS[0]} must be the Supabase service-role/secret key, not the publishable/anon key. ` +
      `${label[0].toUpperCase()}${label.slice(1)} writes are server-only and never use VITE_SUPABASE_* values.`;
    console.error("server config", { runtime: "vercel-function", route, code: "supabase_config", problem: "not_service_role", keyVariable });
    throw new SupabaseServerConfigError(message, "secret_key");
  }

  return { url, key, keyVariable };
}

/** Privileged Supabase client. Create it only after authorizing the caller. */
export function createServiceClient(
  label: string,
  route: string,
  options: { requestTimeoutMs?: number } = {},
): SupabaseClient {
  const config = requireSupabaseServiceConfig(label, route);
  const timeout = options.requestTimeoutMs ?? 10_000;
  try {
    return createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(timeout) }),
      },
    });
  } catch {
    console.error("server config", { runtime: "vercel-function", route, code: "supabase_config", problem: "client_creation", keyVariable: config.keyVariable });
    throw new SupabaseServerConfigError(
      `The ${label} server has invalid Supabase configuration. Check ${SUPABASE_URL_VAR} and the service-role key for formatting errors.`,
      "client_creation",
    );
  }
}
