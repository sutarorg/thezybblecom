/* ------------------------------------------------------------------ */
/* Zybble — production service layer.                                  */
/* No mock data, no simulated success. Reads go through RLS-guarded    */
/* PostgREST; provider/money actions go through Edge Functions.        */
/* ------------------------------------------------------------------ */
import { getSupabase, BACKEND_ENABLED } from "./supabase";
import { planFromId, planLabel } from "../data/plans";
import { mergeTags, validateTag } from "../lib/tags";
import { formatAppDate, setRuntimePreferences, type RuntimePreferences } from "../lib/datetime";
import { parseApiResponse } from "./api-response";
import { readFunctionError } from "./edge-error";
import type {
  ActivityItem,
  ExportRecord,
  Invoice,
  Lead,
  LeadList,
  LeadStatus,
  Note,
  Role,
  SearchRecord,
  TeamMember,
  Workspace,
} from "../data/types";

export { BACKEND_ENABLED };

export const CONFIG_ERROR =
  "Zybble isn't connected to its backend yet. Add your Supabase environment variables to continue.";

class NotConfigured extends Error {
  constructor() {
    super(CONFIG_ERROR);
  }
}

function requireClient() {
  const sb = getSupabase();
  if (!sb) throw new NotConfigured();
  return sb;
}

/* ------------------------------------------------------------------ */
/* Workspace selection                                                 */
/* ------------------------------------------------------------------ */
const WS_KEY = "zybble.workspace";

export function getSelectedWorkspaceId(): string | null {
  try {
    return localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
}
export function setSelectedWorkspaceId(id: string) {
  try {
    localStorage.setItem(WS_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

/* ------------------------------------------------------------------ */
/* Row mappers                                                         */
/* ------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-explicit-any */
function mapLead(row: any): Lead {
  return {
    id: row.id,
    business_id: row.data_id ?? row.id,
    place_id: row.place_id ?? "",
    name: row.name,
    title: row.title ?? row.name,
    category: row.category ?? "Business",
    categories: row.categories ?? [],
    types: row.types ?? [],
    description: row.description ?? null,
    rating: row.rating != null ? Number(row.rating) : 0,
    reviews: row.reviews ?? 0,
    price: row.price ?? null,
    price_level: row.price_level ?? null,
    business_size: row.business_size ?? "unknown",
    employee_count: row.employee_count ?? null,
    business_size_source: row.business_size_source ?? "unknown",
    business_size_confidence: Number(row.business_size_confidence ?? 0),
    popular_times: row.popular_times ?? null,
    phone: row.phone ?? "",
    phone_normalized: row.phone_normalized ?? "",
    email: row.email ?? null,
    emails: row.emails ?? [],
    website: row.website ?? null,
    website_domain: row.website_domain ?? null,
    address: row.address ?? "",
    street: row.street ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    postal_code: row.postal_code ?? "",
    country: row.country ?? "",
    country_code: row.country_code ?? "",
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
    plus_code: row.plus_code ?? "",
    hours: row.hours ?? {},
    open_state: row.open_state ?? "unknown",
    hours_display: row.hours_display ?? "",
    services: row.services ?? [],
    service_options: row.service_options ?? [],
    amenities: row.amenities ?? [],
    attributes: row.attributes ?? [],
    photos: row.photos ?? 0,
    thumbnail: row.thumbnail ?? null,
    logo: row.logo ?? null,
    maps_url: row.maps_url ?? "",
    google_maps_url: row.google_maps_url ?? "",
    source: row.source ?? "",
    source_url: row.source_url ?? "",
    data_id: row.data_id ?? "",
    data_cid: row.data_cid ?? "",
    kgmid: row.kgmid ?? "",
    owner: null,
    owner_name: row.owner_name ?? null,
    owner_link: row.owner_link ?? null,
    booking_links: row.booking_links ?? [],
    menu_links: row.menu_links ?? [],
    social_links: row.social_links ?? [],
    search_query: row.search_query ?? "",
    search_location: row.search_location ?? "",
    collected_at: row.collected_at ?? row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    status: (row.status ?? "new") as LeadStatus,
    tags: row.tags ?? [],
    notes: (row.lead_notes ?? []).map((n: any) => ({
      id: n.id,
      author: n.author_name ?? "You",
      body: n.body,
      at: n.created_at,
    })),
    list_ids: (row.lead_list_members ?? []).map((m: any) => m.list_id),
  };
}

const LEAD_SELECT = "*, lead_notes(id, body, created_at, author_id), lead_list_members(list_id)";

const LIST_TINTS = [
  "text-emerald-700 bg-emerald-50",
  "text-sky-700 bg-sky-50",
  "text-amber-700 bg-amber-50",
  "text-violet-700 bg-violet-50",
  "text-rose-700 bg-rose-50",
  "text-stone-600 bg-stone-100",
];
function tintFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return LIST_TINTS[h % LIST_TINTS.length];
}

function mapList(row: any): LeadList {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    color: tintFor(row.id ?? row.name ?? ""),
    lead_count: row.lead_count ?? row.lead_list_members?.[0]?.count ?? 0,
    owner: row.owner_name ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    workspace_id: row.workspace_id,
  };
}

function mapSearch(row: any): SearchRecord {
  const status: SearchRecord["status"] =
    row.status === "completed" ? "completed" : row.status === "failed" ? "failed" : "partial";
  return {
    id: row.id,
    query: row.query,
    location: row.location ?? "—",
    results: row.result_count ?? 0,
    status,
    list_id: row.saved_list_id ?? null,
    saved: Boolean(row.saved_list_id),
    at: row.created_at,
  };
}

function mapExport(row: any): ExportRecord {
  return {
    id: row.id,
    file_name: row.file_name,
    source: row.source,
    leads: row.lead_count ?? 0,
    format: "CSV",
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at ?? null,
  };
}

function mapWorkspace(row: any): Workspace {
  return {
    id: row.id,
    name: row.name,
    owner: row.owner_name ?? "",
    plan: planLabel(row.plan_id),
    members: row.workspace_members?.[0]?.count ?? 1,
    leads_used: row.leads_used ?? 0,
    leads_limit: planFromId(row.plan_id).leadAllowance,
    searches: row.searches ?? 0,
    lists: row.lists ?? 0,
    created_at: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* Session / profile                                                   */
/* ------------------------------------------------------------------ */
export type AppUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  initials: string;
  plan: string;
  planId: string;
  isAdmin: boolean;
};

/**
 * Never let a hung network call freeze the UI. Supabase's getSession()
 * can stall when a stored token is stale and the refresh endpoint is
 * unreachable — that used to leave the app on a permanent splash.
 */
function withTimeout<T>(promise: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    const sessionResult = await withTimeout(sb.auth.getSession(), 8000, {
      data: { session: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const session = sessionResult?.data?.session ?? null;
    if (!session) return null;

    void touchAppSession().catch(() => undefined);
    void getUserPreferences().catch(() => undefined);

    const emailName = session.user.email?.split("@")[0] ?? "User";

    // Profile/subscription are enrichment — never block sign-in on them.
    const [profileRes, subRes] = await Promise.all([
      withTimeout(
        sb.from("profiles").select("name, avatar_url, role").eq("id", session.user.id).maybeSingle(),
        6000,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { data: null } as any
      ),
      withTimeout(
        sb.from("subscriptions").select("plan_id, status").eq("user_id", session.user.id).maybeSingle(),
        6000,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { data: null } as any
      ),
    ]);

    const profile = profileRes?.data ?? null;
    const sub = subRes?.data ?? null;

    const name: string = profile?.name || emailName;
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s: string) => s[0]!.toUpperCase())
      .join("");

    const planId = sub && ["active", "trialing"].includes(sub.status) ? sub.plan_id : "free";

    return {
      id: session.user.id,
      name,
      email: session.user.email ?? "",
      avatarUrl: profile?.avatar_url ?? null,
      initials,
      plan: planLabel(planId),
      planId,
      isAdmin: profile?.role === "admin",
    };
  } catch (e) {
    console.error("getCurrentUser failed:", e);
    return null;
  }
}

export async function updateProfile(name: string, email: string) {
  const sb = requireClient();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) throw new Error("Your session expired — sign in again.");
  const { error } = await sb.from("profiles").update({ name }).eq("id", session.user.id);
  if (error) throw new Error(readableError(error.message));
  if (email && email !== session.user.email) {
    const { error: mailErr } = await sb.auth.updateUser({ email });
    if (mailErr) throw new Error(mailErr.message);
  }
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */
export async function signIn(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return { error: error ? friendlyAuthError(error.message) : null };
}

export async function signUp(name: string, email: string, password: string) {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR, needsConfirm: false };
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo: `${window.location.origin}/overview`,
    },
  });
  return {
    error: error ? friendlyAuthError(error.message) : null,
    needsConfirm: Boolean(data.user && !data.session),
  };
}

export async function requestPasswordReset(email: string) {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset?step=update`,
  });
  return { error: error ? friendlyAuthError(error.message) : null };
}

export async function updatePassword(password: string) {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };
  const { error } = await sb.auth.updateUser({ password });
  return { error: error ? friendlyAuthError(error.message) : null };
}

export async function signOut() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
}

function friendlyAuthError(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "That email and password don't match.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "An account with this email already exists. Try logging in.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts — please wait a moment and try again.";
  if (m.includes("email not confirmed")) return "Confirm your email first — check your inbox.";
  if (m.includes("weak password")) return "Choose a stronger password.";
  return message;
}

/* ------------------------------------------------------------------ */
/* Workspaces                                                          */
/* ------------------------------------------------------------------ */
export async function listWorkspaces(): Promise<Workspace[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("workspaces")
    .select("*, workspace_members(count)")
    .order("created_at", { ascending: true });
  if (error) throw new Error(readableError(error.message));
  return (data ?? []).map(mapWorkspace);
}

/**
 * Server-side recovery for users whose signup provisioning failed or whose
 * workspace was removed: the security-definer RPC re-links or creates their
 * personal workspace exactly once (per-user advisory lock in Postgres), so
 * it can never produce duplicates. Real rows only — never fabricated data.
 */
export async function ensurePersonalWorkspace(): Promise<string | null> {
  const sb = requireClient();
  const { data, error } = await sb.rpc("ensure_personal_workspace");
  if (error) throw new Error(readableError(error.message));
  return (data as string) ?? null;
}

/**
 * All workspaces the user can see, self-healing: if the list comes back
 * empty we ask the server to (re)provision the personal workspace and list
 * again before giving up.
 */
export async function listWorkspacesWithRecovery(): Promise<Workspace[]> {
  let all = await listWorkspaces();
  if (!all.length) {
    await ensurePersonalWorkspace();
    all = await listWorkspaces();
  }
  return all;
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("workspaces")
    .select("*, workspace_members(count)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(readableError(error.message));
  return data ? mapWorkspace(data) : null;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const sb = requireClient();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) throw new Error("Your session expired — sign in again.");
  const { data, error } = await sb
    .from("workspaces")
    .insert({ name, owner_id: session.user.id, is_client: true })
    .select("*, workspace_members(count)")
    .single();
  if (error) throw new Error(readableError(error.message));
  await sb
    .from("workspace_members")
    .insert({ workspace_id: data.id, user_id: session.user.id, role: "owner" });
  return mapWorkspace(data);
}

export async function getDefaultWorkspace(): Promise<Workspace | null> {
  const all = await listWorkspacesWithRecovery();
  if (!all.length) return null;
  const selected = getSelectedWorkspaceId();
  const workspace = all.find((w) => w.id === selected) ?? all[0];
  /* Drop a stale selection (deleted workspace / different account on this
     browser) so the next load starts from a valid pointer. */
  if (selected && workspace.id !== selected) setSelectedWorkspaceId(workspace.id);
  return workspace;
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */
export type OverviewData = {
  kpi: {
    leadsFound: number;
    leadsSaved: number;
    searches: number;
    exported: number;
    remaining: number;
    allowance: number;
  };
  searches: SearchRecord[];
  lists: LeadList[];
  activity: ActivityItem[];
};

function periodStart() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export async function getOverview(workspaceId: string, planId: string): Promise<OverviewData> {
  const sb = requireClient();
  const allowance = planFromId(planId).leadAllowance;

  const [searches, lists, usage, activity, leadCount] = await Promise.all([
    sb.from("lead_searches").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5),
    sb.from("lead_lists").select("*, lead_list_members(count)").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(4),
    sb.from("usage_counters").select("*").eq("workspace_id", workspaceId).eq("period_start", periodStart()).maybeSingle(),
    sb.from("activity_logs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listRows = (lists.data ?? []).map((l: any) =>
    mapList({ ...l, lead_count: l.lead_list_members?.[0]?.count ?? 0 })
  );
  const used = usage.data?.leads_used ?? 0;

  return {
    kpi: {
      leadsFound: leadCount.count ?? 0,
      leadsSaved: listRows.reduce((a, l) => a + l.lead_count, 0),
      searches: usage.data?.searches ?? 0,
      exported: usage.data?.exports ?? 0,
      remaining: Math.max(0, allowance - used),
      allowance,
    },
    searches: (searches.data ?? []).map(mapSearch),
    lists: listRows,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activity: (activity.data ?? []).map((a: any) => ({
      id: String(a.id),
      kind: a.kind,
      text: a.text,
      at: a.created_at,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Search — structured filters, explicitly triggered by the user       */
/* ------------------------------------------------------------------ */
export type SearchFilters = {
  category: string;
  location: string;
  quantity: number;
  minRating: string;
  priceLevel: string;
  businessSize: string;
  sort: string;
  requireWebsite: boolean;
  requirePhone: boolean;
  requireEmail: boolean;
  openNow: boolean;
};

export const EMPTY_FILTERS: SearchFilters = {
  category: "",
  location: "",
  quantity: 50,
  minRating: "",
  priceLevel: "",
  businessSize: "",
  sort: "relevance",
  requireWebsite: false,
  requirePhone: false,
  requireEmail: false,
  openNow: false,
};

export type SearchRunResult = {
  searchId: string;
  leads: Lead[];
  stats: {
    requested: number;
    savedCount: number;
    status?: "completed" | "partial";
    message?: string;
    insights: string[];
  };
};

export async function runSearch(
  workspaceId: string,
  filters: SearchFilters
): Promise<{ result?: SearchRunResult; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };

  /*
   * Production searches run through our same-origin Vercel Function. That is
   * where SERPAPI_API_KEY lives on a Vercel deployment; the browser never sees
   * it. The request still carries the Supabase session and every database write
   * is made with that user-scoped token, so RLS and reserve_leads() remain the
   * authorization and quota boundaries.
   *
   * Plain `vite` development has no /api runtime. In that one case (a 404 or
   * an HTML SPA fallback), retain the Supabase Edge Function path documented
   * for non-Vercel/local deployments.
   */
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return { error: "Your session expired — sign in again." };

  let sameOriginError = "";
  try {
    const response = await fetch("/api/search-run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ workspaceId, filters }),
    });
    const parsed = await parseApiResponse<Record<string, unknown>>(response, "search");
    if (parsed.data) return searchRunResponse(parsed.data);
    if (!parsed.shouldFallback) return { error: parsed.error ?? "The search couldn't complete." };
    sameOriginError = parsed.error ?? "";
  } catch {
    // The same-origin route may be unavailable; use the Edge Function below.
    sameOriginError = "We couldn't reach the search server. Check your connection and try again.";
  }

  const { data, error } = await sb.functions.invoke("search-run", {
    body: { workspaceId, filters },
    // Do not rely on the SDK's implicit session lookup. Supplying the token
    // explicitly makes the JWT boundary visible and works with publishable
    // keys and verify_jwt=true Edge Functions in production.
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    const fallbackError = await readFunctionError(error, "search-run", "search");
    return { error: fallbackError || sameOriginError || "The search couldn't complete." };
  }
  if (data?.error) return { error: String(data.error) };
  return searchRunResponse(data);
}

function searchRunResponse(data: unknown): { result?: SearchRunResult; error?: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "The search server returned incomplete data. Please try again." };
  }
  const body = data as Record<string, unknown>;
  const stats = body.stats;
  const leads = body.leads;
  if (
    typeof body.searchId !== "string" ||
    !Array.isArray(leads) ||
    !stats ||
    typeof stats !== "object" ||
    Array.isArray(stats) ||
    typeof (stats as Record<string, unknown>).savedCount !== "number" ||
    !leads.every((lead) => lead && typeof lead === "object" && typeof (lead as Record<string, unknown>).id === "string" && typeof (lead as Record<string, unknown>).name === "string")
  ) {
    return { error: "The search server returned incomplete lead data. Please try again." };
  }
  const typedStats = stats as SearchRunResult["stats"];
  return {
    result: {
      searchId: body.searchId,
      leads: leads.map((lead) => mapLead(lead)),
      stats: {
        ...typedStats,
        insights: Array.isArray(typedStats.insights) ? typedStats.insights.map(String) : [],
      },
    },
  };
}

/** Interpretation only — never consumes lead quota, never runs a search. */
export type Interpretation = {
  filters: Partial<SearchFilters>;
  summary: string;
  notes: string[];
};

export async function interpretRequest(
  workspaceId: string,
  request: string
): Promise<{ result?: Interpretation; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };

  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return { error: "Your session expired — sign in again." };

  /* Prefer the same-origin server function, where OPENAI_API_KEY remains
     server-only. Non-Vercel deployments retain the Supabase fallback. */
  try {
    const response = await fetch("/api/ai-interpret", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ workspaceId, request }),
    });
    const parsed = await parseApiResponse<Interpretation>(response, "AI");
    if (parsed.data) return interpretationResponse(parsed.data);
    if (!parsed.shouldFallback) return { error: parsed.error ?? "Zybble AI couldn't interpret that request." };
  } catch {
    // Same-origin route unavailable; use the deployed Edge Function below.
  }

  const { data, error } = await sb.functions.invoke("ai-interpret", {
    body: { workspaceId, request },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: await readFunctionError(error, "ai-interpret", "AI") };
  if (data?.error) return { error: String(data.error) };
  return interpretationResponse(data);
}

function interpretationResponse(data: unknown): { result?: Interpretation; error?: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "Zybble AI returned incomplete filter data. Please try again." };
  }
  const body = data as Record<string, unknown>;
  const filters = body.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters) || typeof (filters as Record<string, unknown>).category !== "string") {
    return { error: "Zybble AI couldn't identify a business category. Try rephrasing." };
  }
  return {
    result: {
      filters: filters as Partial<SearchFilters>,
      summary: typeof body.summary === "string" ? body.summary : "Search filters prepared.",
      notes: Array.isArray(body.notes) ? body.notes.map(String).slice(0, 2) : [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */
export type LeadFilters = {
  search?: string;
  city?: string;
  category?: string;
  minRating?: number;
  status?: LeadStatus | "";
  tag?: string;
  withWebsite?: boolean;
  withEmail?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listLeads(
  workspaceId: string,
  f: LeadFilters
): Promise<{ rows: Lead[]; total: number }> {
  const sb = getSupabase();
  if (!sb) return { rows: [], total: 0 };
  const pageSize = f.pageSize ?? 25;
  const from = ((f.page ?? 1) - 1) * pageSize;

  let q = sb
    .from("leads")
    .select(LEAD_SELECT, { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (f.status) q = q.eq("status", f.status);
  if (f.tag) q = q.contains("tags", [f.tag]);
  if (f.city) q = q.eq("city", f.city);
  if (f.category) q = q.eq("category", f.category);
  if (f.minRating) q = q.gte("rating", f.minRating);
  if (f.withWebsite) q = q.not("website", "is", null);
  if (f.withEmail) q = q.not("email", "is", null);
  if (f.search) q = q.or(`name.ilike.%${f.search}%,city.ilike.%${f.search}%,category.ilike.%${f.search}%`);

  const { data, count, error } = await q;
  if (error) throw new Error(readableError(error.message));
  return { rows: (data ?? []).map(mapLead), total: count ?? 0 };
}

/** Distinct facet values so filter dropdowns reflect real data only. */
export async function getLeadFacets(workspaceId: string) {
  const sb = getSupabase();
  if (!sb) return { cities: [] as string[], categories: [] as string[], tags: [] as string[] };
  const { data } = await sb
    .from("leads")
    .select("city, category, tags")
    .eq("workspace_id", workspaceId)
    .limit(2000);
  const cities = new Set<string>();
  const categories = new Set<string>();
  const tags = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (data ?? []).forEach((r: any) => {
    if (r.city) cities.add(r.city);
    if (r.category) categories.add(r.category);
    (r.tags ?? []).forEach((tag: string) => tags.add(tag));
  });
  return { cities: [...cities].sort(), categories: [...categories].sort(), tags: [...tags].sort() };
}

export async function getLead(id: string, workspaceId?: string): Promise<Lead | null> {
  const sb = getSupabase();
  if (!sb) return null;
  let q = sb.from("leads").select(LEAD_SELECT).eq("id", id);
  if (workspaceId) q = q.eq("workspace_id", workspaceId);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return mapLead(data);
}

export async function updateLeadStatus(id: string, status: LeadStatus) {
  const sb = requireClient();
  const { error } = await sb.from("leads").update({ status }).eq("id", id);
  if (error) throw new Error(readableError(error.message));
}

export async function updateLeadTags(id: string, tags: string[]) {
  const sb = requireClient();
  const normalized: string[] = [];
  for (const raw of tags) {
    const checked = validateTag(raw);
    if (!checked.ok) throw new Error(checked.error);
    if (!normalized.includes(checked.tag)) normalized.push(checked.tag);
  }
  const { error } = await sb.from("leads").update({ tags: normalized }).eq("id", id);
  if (error) throw new Error(readableError(error.message));
}

export async function applyTagToLeads(leadIds: string[], tag: string, mode: "add" | "remove" = "add") {
  const sb = requireClient();
  const checked = validateTag(tag);
  if (!checked.ok) throw new Error(checked.error);
  const { data, error } = await sb.from("leads").select("id, tags").in("id", leadIds);
  if (error) throw new Error(readableError(error.message));
  for (const row of data ?? []) {
    const existing = Array.isArray(row.tags) ? row.tags : [];
    const tags = mode === "add" ? mergeTags(existing, [checked.tag]) : existing.filter((t: string) => t !== checked.tag);
    const { error: updateError } = await sb.from("leads").update({ tags }).eq("id", row.id);
    if (updateError) throw new Error(readableError(updateError.message));
  }
}

export async function addLeadNote(leadId: string, body: string): Promise<Note> {
  const sb = requireClient();
  const user = await getCurrentUser();
  if (!user) throw new Error("Your session expired — sign in again.");
  const { data, error } = await sb
    .from("lead_notes")
    .insert({ lead_id: leadId, author_id: user.id, body })
    .select()
    .single();
  if (error) throw new Error(readableError(error.message));
  return { id: data.id, author: user.name, body: data.body, at: data.created_at };
}

export async function deleteLeadNote(noteId: string) {
  const sb = requireClient();
  await sb.from("lead_notes").delete().eq("id", noteId);
}

export async function deleteLeads(ids: string[]) {
  const sb = requireClient();
  const { error } = await sb.from("leads").delete().in("id", ids);
  if (error) throw new Error(readableError(error.message));
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */
export async function getLists(workspaceId: string): Promise<LeadList[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("lead_lists")
    .select("*, lead_list_members(count)")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(readableError(error.message));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((l: any) =>
    mapList({ ...l, lead_count: l.lead_list_members?.[0]?.count ?? 0 })
  );
}

export async function getList(id: string): Promise<LeadList | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("lead_lists")
    .select("*, lead_list_members(count)")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapList({ ...(data as any), lead_count: (data as any).lead_list_members?.[0]?.count ?? 0 });
}

export async function createList(workspaceId: string, name: string, description: string) {
  const sb = requireClient();
  const user = await getCurrentUser();
  if (!user) throw new Error("Your session expired — sign in again.");
  const { data, error } = await sb
    .from("lead_lists")
    .insert({ workspace_id: workspaceId, owner_id: user.id, name, description })
    .select()
    .single();
  if (error) throw new Error(readableError(error.message));
  return mapList({ ...data, lead_count: 0 });
}

export async function deleteList(id: string) {
  const sb = requireClient();
  const { error } = await sb.from("lead_lists").delete().eq("id", id);
  if (error) throw new Error(readableError(error.message));
}

export async function listMembers(listId: string): Promise<Lead[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("lead_list_members")
    .select(`leads(${LEAD_SELECT})`)
    .eq("list_id", listId);
  if (error) throw new Error(readableError(error.message));
  return (data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => m.leads)
    .filter(Boolean)
    .map(mapLead);
}

export async function addToList(listId: string, leadIds: string[]) {
  const sb = requireClient();
  const rows = leadIds.map((id) => ({ list_id: listId, lead_id: id }));
  const { error } = await sb
    .from("lead_list_members")
    .upsert(rows, { onConflict: "list_id,lead_id" });
  if (error) throw new Error(readableError(error.message));
}

export async function removeFromList(listId: string, leadIds: string[]) {
  const sb = requireClient();
  await sb.from("lead_list_members").delete().eq("list_id", listId).in("lead_id", leadIds);
}

/* ------------------------------------------------------------------ */
/* Search history                                                      */
/* ------------------------------------------------------------------ */
export async function getSearches(workspaceId: string): Promise<SearchRecord[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("lead_searches")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(readableError(error.message));
  return (data ?? []).map(mapSearch);
}

export async function deleteSearch(id: string) {
  const sb = requireClient();
  const { error } = await sb.from("lead_searches").delete().eq("id", id);
  if (error) throw new Error(readableError(error.message));
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */
export async function getExports(workspaceId: string): Promise<ExportRecord[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("exports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(readableError(error.message));
  return (data ?? []).map(mapExport);
}

export async function runExport(opts: {
  workspaceId: string;
  leadIds?: string[];
  listId?: string;
  searchId?: string;
  source: string;
  fileName?: string;
}) {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return { error: "Your session expired — sign in again." };

  try {
    const response = await fetch("/api/export-run", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(opts),
    });
    const parsed = await parseApiResponse<{ id: string; file_name: string; lead_count: number; status: string; csv?: string }>(response, "export");
    if (parsed.data) return { export: parsed.data };
    if (!parsed.shouldFallback) return { error: parsed.error ?? "Export failed." };
  } catch {
    // Same-origin route unavailable; fall back to Edge Function below.
  }

  const { data, error } = await sb.functions.invoke("export-run", {
    body: opts,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: await readFunctionError(error, "export-run", "export") };
  if (data?.error) return { error: data.error };
  return { export: data as { id: string; file_name: string; lead_count: number; status: string; csv?: string } };
}

export function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadExport(
  id: string
): Promise<{ csv?: string; fileName?: string; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };
  const { data, error } = await sb
    .from("exports")
    .select("csv, file_name, status")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return { error: "That export is no longer available." };
  if (data.status !== "completed") return { error: "This export is still processing." };
  return { csv: data.csv ?? "", fileName: data.file_name };
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */
export async function getTeam(workspaceId: string): Promise<TeamMember[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const [{ data: members, error }, { data: invites }] = await Promise.all([
    sb
      .from("workspace_members")
      .select("user_id, role, created_at, profiles:user_id(name, avatar_url)")
      .eq("workspace_id", workspaceId),
    sb
      .from("workspace_invitations")
      .select("id, email, role, status, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "pending"),
  ]);
  if (error) throw new Error(readableError(error.message));

  const wsName = (await getWorkspace(workspaceId))?.name ?? "";

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const active: TeamMember[] = (members ?? []).map((m: any) => {
    const name = m.profiles?.name ?? "Member";
    return {
      id: m.user_id,
      name,
      email: "",
      role: m.role as Role,
      workspace: wsName,
      status: "active",
      joined_at: m.created_at,
      initials: name.split(/\s+/).slice(0, 2).map((p: string) => p[0]?.toUpperCase() ?? "").join(""),
      tint: tintFor(m.user_id),
    };
  });

  const pending: TeamMember[] = (invites ?? []).map((i: any) => ({
    id: i.id,
    name: i.email.split("@")[0],
    email: i.email,
    role: i.role as Role,
    workspace: wsName,
    status: "invited",
    joined_at: i.created_at,
    initials: i.email.slice(0, 2).toUpperCase(),
    tint: tintFor(i.email),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return [...active, ...pending];
}

export async function inviteMember(workspaceId: string, email: string, role: "admin" | "member") {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return { error: "Your session expired — sign in again." };

  try {
    const response = await fetch("/api/team-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ workspaceId, email, role }),
    });
    const parsed = await parseApiResponse<{ emailSent?: boolean }>(response, "invite");
    if (parsed.data) return { ok: true as const, emailSent: Boolean(parsed.data.emailSent) };
    if (!parsed.shouldFallback) return { error: parsed.error ?? "Invitation failed." };
  } catch {
    // Same-origin route unavailable; fall back to Edge Function below.
  }

  const { data, error } = await sb.functions.invoke("team-invite", {
    body: { workspaceId, email, role },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: await readFunctionError(error, "team-invite", "invite") };
  if (data?.error) return { error: data.error };
  return { ok: true as const, emailSent: Boolean(data?.emailSent ?? data?.ok) };
}

export async function removeMember(workspaceId: string, memberId: string, status: string) {
  const sb = requireClient();
  if (status === "invited") {
    const { error } = await sb.from("workspace_invitations").delete().eq("id", memberId);
    if (error) throw new Error(readableError(error.message));
    return;
  }
  const { error } = await sb
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", memberId);
  if (error) throw new Error(readableError(error.message));
}

/* ------------------------------------------------------------------ */
/* Usage                                                               */
/* ------------------------------------------------------------------ */
export type UsageData = {
  used: number;
  allowance: number;
  remaining: number;
  searches: number;
  exports: number;
  aiRuns: number;
  leadsSaved: number;
  resetDate: string;
  monthly: { label: string; value: number }[];
};

export async function getUsage(workspaceId: string, planId: string): Promise<UsageData> {
  const sb = requireClient();
  const allowance = planFromId(planId).leadAllowance;
  const start = periodStart();
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const nextStart = next.toISOString().slice(0, 10);

  const [leadCount, searchCount, exportCount, aiCount, listsRes, history] = await Promise.all([
    sb.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("collected_at", start).lt("collected_at", nextStart),
    sb.from("lead_searches").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", start).lt("created_at", nextStart),
    sb.from("exports").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", start).lt("created_at", nextStart),
    sb.from("ai_requests").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", start).lt("created_at", nextStart),
    sb.from("lead_lists").select("id").eq("workspace_id", workspaceId),
    sb.from("usage_counters").select("*").eq("workspace_id", workspaceId).order("period_start", { ascending: true }).limit(12),
  ]);

  const listIds = (listsRes.data ?? []).map((l) => l.id);
  const savedCount = listIds.length
    ? await sb.from("lead_list_members").select("lead_id", { count: "exact", head: true }).in("list_id", listIds)
    : { count: 0 };

  const used = leadCount.count ?? 0;
  const reset = new Date(`${nextStart}T00:00:00Z`);

  return {
    used,
    allowance,
    remaining: Math.max(0, allowance - used),
    searches: searchCount.count ?? 0,
    exports: exportCount.count ?? 0,
    aiRuns: aiCount.count ?? 0,
    leadsSaved: savedCount.count ?? 0,
    resetDate: formatAppDate(reset),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monthly: (history.data ?? []).map((row: any) => ({
      label: new Date(row.period_start).toLocaleDateString(undefined, { month: "short" }),
      value: row.leads_used ?? 0,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */
export async function analyzeLead(leadId: string, workspaceId: string) {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return { error: "Your session expired — sign in again." };

  const { data, error } = await sb.functions.invoke("ai-analyze", {
    body: { leadId, workspaceId },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: await readFunctionError(error, "ai-analyze", "AI") };
  if (data?.error) return { error: String(data.error) };
  if (!data || typeof data !== "object" || typeof data.summary !== "string" || !Array.isArray(data.points)) {
    return { error: "Zybble AI returned incomplete analysis. Please try again." };
  }
  return { result: data as { summary: string; points: string[]; outreach_angle?: string; model: string } };
}

export async function getLeadInsight(
  leadId: string
): Promise<{ summary: string; points: string[] } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("ai_insights")
    .select("summary, points")
    .eq("lead_id", leadId)
    .maybeSingle();
  return data ?? null;
}

/* ------------------------------------------------------------------ */
/* Preferences + app sessions                                          */
/* ------------------------------------------------------------------ */
export type UserPreferences = RuntimePreferences;

export async function getUserPreferences(): Promise<UserPreferences> {
  const sb = requireClient();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) throw new Error("Your session expired — sign in again.");
  const { data, error } = await sb
    .from("user_preferences")
    .select("appearance, timezone, language, date_format")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw new Error(readableError(error.message));
  const prefs = {
    appearance: data?.appearance ?? "system",
    timezone: data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    language: data?.language ?? "en",
    date_format: data?.date_format ?? "MMM D, YYYY",
  } as UserPreferences;
  setRuntimePreferences(prefs);
  return prefs;
}

export async function saveUserPreferences(prefs: UserPreferences) {
  const sb = requireClient();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) throw new Error("Your session expired — sign in again.");
  const { error } = await sb.from("user_preferences").upsert(
    { user_id: session.user.id, ...prefs },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(readableError(error.message));
  setRuntimePreferences(prefs);
}

function sessionIdFromJwt(accessToken: string) {
  try {
    const [, payload] = accessToken.split(".");
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return String(json.session_id ?? json.sid ?? json.jti ?? accessToken.slice(-16));
  } catch {
    return accessToken.slice(-16);
  }
}

export type AppSessionRecord = {
  id: string;
  session_id: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  current: boolean;
};

export async function touchAppSession() {
  const sb = getSupabase();
  if (!sb) return;
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return;
  const session_id = sessionIdFromJwt(session.access_token);
  await sb.from("app_sessions").upsert(
    {
      user_id: session.user.id,
      session_id,
      user_agent: navigator.userAgent,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "user_id,session_id" }
  );
  const { data } = await sb
    .from("app_sessions")
    .select("revoked_at")
    .eq("user_id", session.user.id)
    .eq("session_id", session_id)
    .maybeSingle();
  if (data?.revoked_at) await sb.auth.signOut();
}

export async function listAppSessions(): Promise<AppSessionRecord[]> {
  const sb = requireClient();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return [];
  await touchAppSession();
  const current = sessionIdFromJwt(session.access_token);
  const { data, error } = await sb
    .from("app_sessions")
    .select("id, session_id, user_agent, created_at, last_seen_at, revoked_at")
    .order("last_seen_at", { ascending: false });
  if (error) throw new Error(readableError(error.message));
  return (data ?? []).map((row) => ({ ...row, current: row.session_id === current }));
}

export async function revokeAppSession(id: string) {
  const sb = requireClient();
  const { error } = await sb.from("app_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(readableError(error.message));
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */
export type BillingState = {
  planId: string;
  plan: string;
  status: string;
  renewalDate: string | null;
  invoices: Invoice[];
  seats: { used: number; limit: number };
  paymentMethodLast4: string | null;
};

export async function getBilling(workspaceId: string): Promise<BillingState> {
  const sb = requireClient();
  const user = await getCurrentUser();
  if (!user) throw new Error("Your session expired — sign in again.");

  const [{ data: sub }, { data: invoices }, { count: memberCount }] = await Promise.all([
    sb.from("subscriptions").select("*").eq("user_id", user.id).maybeSingle(),
    sb.from("invoices").select("*").eq("user_id", user.id).order("issued_at", { ascending: false }).limit(12),
    sb.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ]);

  const planId = sub && ["active", "trialing"].includes(sub.status) ? sub.plan_id : "free";

  return {
    planId,
    plan: planLabel(planId),
    status: sub?.status ?? "active",
    renewalDate: sub?.current_period_end
      ? new Date(sub.current_period_end).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invoices: (invoices ?? []).map((i: any) => ({
      id: i.number,
      date: i.issued_at,
      description: i.description,
      amount: `$${(i.amount_cents / 100).toFixed(2)}`,
      status: i.status,
    })),
    seats: { used: memberCount ?? 1, limit: planFromId(planId).maxUsers },
    paymentMethodLast4: null,
  };
}

export async function startCheckout(planId: "growth" | "agency" | "scale") {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return { error: "Your session expired — sign in again." };
  const { data, error } = await sb.functions.invoke("billing", {
    body: { action: "checkout", plan: planId },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: await readFunctionError(error, "billing", "billing") };
  if (data?.error) return { error: data.error };
  return { url: data?.url as string };
}

export async function cancelSubscription() {
  const sb = getSupabase();
  if (!sb) return { error: CONFIG_ERROR };
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return { error: "Your session expired — sign in again." };
  const { data, error } = await sb.functions.invoke("billing", {
    body: { action: "cancel" },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: await readFunctionError(error, "billing", "billing") };
  if (data?.error) return { error: data.error };
  return { ok: true as const };
}

export async function syncBilling() {
  const sb = getSupabase();
  if (!sb) return;
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return;
  await sb.functions.invoke("billing", {
    body: { action: "sync" },
    headers: { Authorization: `Bearer ${session.access_token}` },
  }).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Error helpers                                                       */
/* ------------------------------------------------------------------ */
export function readableError(message: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("list_limit")) return "Your plan includes one lead list. Upgrade for unlimited lists.";
  if (m.includes("seat_limit")) return "You've reached your plan's team-seat limit.";
  if (m.includes("client_workspaces_not_available"))
    return "Client workspaces are available on Agency and Scale.";
  if (m.includes("invalid_tag_one_word")) return "Tags must be one word — no spaces.";
  if (m.includes("invalid_tag")) return "Use lowercase one-word tags with letters, numbers, hyphens, or underscores.";
  if (m.includes("duplicate key")) return "That already exists.";
  if (m.includes("row-level security") || m.includes("permission") || m.includes("not_authorized"))
    return "You don't have access to that resource.";
  if (m.includes("jwt") || m.includes("expired")) return "Your session expired — sign in again.";
  return message || "Something went wrong.";
}
