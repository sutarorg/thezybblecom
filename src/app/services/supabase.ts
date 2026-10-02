/* ------------------------------------------------------------------ */
/* Supabase browser client — publishable key only.                     */
/* When env vars are absent or invalid the app refuses to authenticate  */
/* and shows an explicit backend configuration state. There is no      */
/* demo/mock data path anywhere in the product.                        */
/* ------------------------------------------------------------------ */
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";

const configuredUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const configuredPublishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

function isSupabaseUrl(value: string) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

// Trimming matters here: values copied from dashboards or .env files can carry
// an invisible leading non-breaking space, which makes fetch fail before a
// request ever reaches Supabase and surfaces as the opaque Edge error.
export const BACKEND_ENABLED = Boolean(
  isSupabaseUrl(configuredUrl) && configuredPublishableKey.length > 0,
);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!BACKEND_ENABLED) return null;
  if (!client) {
    try {
      client = createClient(configuredUrl, configuredPublishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    } catch {
      // Do not print the URL or key. A malformed build-time value is a safe,
      // actionable configuration error rather than a network/Edge failure.
      client = null;
    }
  }
  return client;
}

export async function getSession(): Promise<Session | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ?? null;
}

export type { Session };
