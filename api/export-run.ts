import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };
type Json = Record<string, unknown>;

export const maxDuration = 60;

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "export_error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const CSV_COLUMNS = [
  "name", "category", "rating", "reviews", "price", "business_size", "employee_count", "phone", "email", "emails",
  "website", "address", "city", "state", "postal_code", "country", "latitude", "longitude", "status", "tags", "source",
] as const;

function env(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}
function bodyOf(req: VercelRequest): Json {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body as Json;
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
    } catch { throw new ApiError(400, "The export request wasn't valid JSON.", "invalid_json"); }
  }
  throw new ApiError(400, "An export request is required.", "missing_body");
}
function tokenOf(req: VercelRequest) {
  const value = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const token = value?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError(401, "Your session expired — sign in again.", "auth_missing");
  return token;
}
function client(token: string): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!url || !key) {
    const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)"].filter(Boolean).join(" and ");
    console.error("api request", { route: "/api/export-run", status: 500, code: "supabase_config", missing });
    throw new ApiError(500, `The export server isn't connected to Supabase. Missing env var(s): ${missing}.`, "supabase_config");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
async function requireMember(sb: SupabaseClient, workspaceId: string, userId: string) {
  const { data, error } = await sb.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (error || !data) throw new ApiError(403, "You don't have access to that workspace.", "workspace_forbidden");
}
export function csvEscape(value: unknown): string {
  if (value == null) return "";
  const text = Array.isArray(value) ? value.join("; ") : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
async function leadsForExport(sb: SupabaseClient, workspaceId: string, opts: { leadIds: string[]; searchId: string | null; listId: string | null }) {
  if (opts.leadIds.length) {
    const { data, error } = await sb.from("leads").select("*").eq("workspace_id", workspaceId).in("id", opts.leadIds).order("name");
    if (error) throw new ApiError(500, "Couldn't read the selected leads.", "read_failed");
    return data ?? [];
  }
  if (opts.searchId) {
    const { data: search } = await sb.from("lead_searches").select("id").eq("id", opts.searchId).eq("workspace_id", workspaceId).maybeSingle();
    if (!search) throw new ApiError(404, "That search wasn't found in this workspace.", "search_not_found");
    const { data, error } = await sb.from("leads").select("*").eq("workspace_id", workspaceId).eq("search_id", opts.searchId).order("name").limit(50000);
    if (error) throw new ApiError(500, "Couldn't read the search leads.", "read_failed");
    return data ?? [];
  }
  if (opts.listId) {
    const { data: list } = await sb.from("lead_lists").select("id").eq("id", opts.listId).eq("workspace_id", workspaceId).maybeSingle();
    if (!list) throw new ApiError(404, "That list wasn't found in this workspace.", "list_not_found");
    const { data, error } = await sb.from("lead_list_members").select("leads(*)").eq("list_id", opts.listId).limit(50000);
    if (error) throw new ApiError(500, "Couldn't read the list leads.", "read_failed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((m: any) => m.leads).filter(Boolean);
  }
  throw new ApiError(400, "Choose leads, a list, or a search to export.", "empty_scope");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = bodyOf(req);
    const workspaceId = String(body.workspaceId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new ApiError(400, "A valid workspace is required.", "workspace_invalid");
    const leadIds = Array.isArray(body.leadIds) ? body.leadIds.map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];
    const searchId = body.searchId ? String(body.searchId) : null;
    const listId = body.listId ? String(body.listId) : null;
    const source = String(body.source ?? "Selection").slice(0, 120);
    if (!leadIds.length && !searchId && !listId) throw new ApiError(400, "Choose leads, a list, or a search to export.", "empty_scope");
    if (leadIds.length > 50000) throw new ApiError(400, "Export is limited to 50,000 leads per file.", "too_many");

    const token = tokenOf(req);
    const sb = client(token);
    const { data: auth, error: authError } = await sb.auth.getUser(token);
    if (authError || !auth.user) throw new ApiError(401, "Your session expired — sign in again.", "auth_invalid");
    await requireMember(sb, workspaceId, auth.user.id);

    const fileNameRaw = String(body.fileName ?? "").trim() || `${source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "leads"}-${new Date().toISOString().slice(0, 10)}.csv`;
    const fileName = fileNameRaw.endsWith(".csv") ? fileNameRaw : `${fileNameRaw}.csv`;

    const leads = await leadsForExport(sb, workspaceId, { leadIds, searchId, listId });
    if (!leads.length) throw new ApiError(422, "There are no leads to export.", "no_leads");

    const csv = [CSV_COLUMNS.join(","), ...leads.map((lead) => CSV_COLUMNS.map((c) => csvEscape((lead as Json)[c])).join(","))].join("\n");

    const { data: exportRow, error: insertError } = await sb.from("exports").insert({
      workspace_id: workspaceId,
      user_id: auth.user.id,
      file_name: fileName,
      source,
      lead_count: leads.length,
      format: "csv",
      status: "completed",
      csv,
      completed_at: new Date().toISOString(),
    }).select("id, file_name, lead_count, status").single();
    if (insertError || !exportRow) throw new ApiError(500, "Couldn't persist the export.", "persist_failed");

    await sb.rpc("increment_usage_counter", { ws: workspaceId, metric: "exports", delta: 1 }).then(() => undefined);

    return res.status(200).json({ ...exportRow, csv });
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(500, "Export failed. Please try again.", "unknown");
    if (!(error instanceof ApiError)) console.error("api request", { route: "/api/export-run", status: 500, code: "unknown" });
    return res.status(apiError.status).json({ error: apiError.message, code: apiError.code });
  }
}
