import type { IncomingMessage, ServerResponse } from "node:http";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };

export const maxDuration = 10;

/**
 * Liveness probe for uptime monitors: `GET /api/health` → `200 {"ok":true,…}`.
 *
 * Deliberately dependency-free (no Supabase, SerpApi, or OpenAI calls) so it
 * only reports that the Vercel Function itself is up. Deeper, authenticated
 * status lives in the app; monitors should alarm on non-200 here.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "Use GET /api/health." });
  }
  return res.status(200).json({
    ok: true,
    service: "zybble",
    endpoint: "/api/health",
    time: new Date().toISOString(),
  });
}
