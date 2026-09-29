/* ------------------------------------------------------------------ */
/* Supabase browser client — publishable key only.                     */
/* When env vars are absent the app runs in demo mode with mock data,  */
/* so the marketing preview keeps working without a backend.           */
/* ------------------------------------------------------------------ */
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const BACKEND_ENABLED = Boolean(url && publishableKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!BACKEND_ENABLED) return null;
  if (!client) {
    client = createClient(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
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
