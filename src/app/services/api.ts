/* ------------------------------------------------------------------ */
/* Zybble — typed service layer.                                       */
/* Every provider-touching or money-touching action goes through       */
/* Supabase Edge Functions. Direct PostgREST reads/writes are guarded  */
/* by Row Level Security. When the backend isn't configured, every     */
/* call falls back to the bundled demo data so the preview keeps work. */
/* ------------------------------------------------------------------ */
import { getSupabase, BACKEND_ENABLED } from "./supabase";
import {
  ACTIVITY,
  CURRENT_USER,
  EXPORTS,
  KPI,
  LEADS,
  LISTS,
  PLAN,
  SEARCH_HISTORY,
  TEAM,
  WEEK_LABELS,
  WEEKLY_USAGE,
  WORKSPACES,
} from "../data/mock";
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

/* ------------------------------------------------------------------ */
/* Local workspace selection                                           */
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
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Snake → camel mappers                                               */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLead(row: any): Lead {
  return {
    id: row.id,
    business_id: row.data_id ?? row.id,
    place_id: row.place_id ?? "",
    name: row.name,
    title: row.title ?? `${row.name}`,
    category: row.category ?? "Business",
    categories: row.categories ?? [],
    types: row.types ?? [],
    description: row.description ?? null,
    rating: Number(row.rating ?? 0),
    reviews: row.reviews ?? 0,
    price: row.price ?? null,
    price_level: row.price_level ?? null,
    phone: row.phone ?? "—",
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
    source: row.source ?? "Public business listing",
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
    collected_at: row.collected_at,
    updated_at: row.updated_at,
    status: row.status as LeadStatus,
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

const LEAD_SELECT =
  "*, lead_notes(id, body, created_at, author_id), lead_list_members(list_id)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapList(row: any): LeadList {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    color: "text-emerald-700 bg-emerald-50",
    lead_count: row.lead_count ?? row.lead_list_members?.[0]?.count ?? 0,
    owner: row.owner_name ?? "You",
    created_at: row.created_at,
    updated_at: row.updated_at,
    workspace_id: row.workspace_id,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSearch(row: any): SearchRecord {
  return {
    id: row.id,
    query: row.query,
    location: row.location ?? "—",
    results: row.result_count ?? 0,
    status: row.status === "completed" ? "completed" : row.status === "failed" ? "failed" : "partial",
    list_id: row.saved_list_id ?? null,
    saved: Boolean(row.saved_list_id),
    at: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapWorkspace(row: any): Workspace {
  return {
    id: row.id,
    name: row.name,
    owner: "You",
    plan: row.plan_id ? planLabel(row.plan_id) : "Agency",
    members: row.workspace_members?.[0]?.count ?? 1,
    leads_used: row.leads_used ?? 0,
    leads_limit: row.leads_limit ?? 15000,
    searches: row.searches ?? 0,
    lists: row.lists ?? 0,
    created_at: row.created_at,
  };
}

function planLabel(id: string) {
  return id === "free" ? "Free" : id === "growth" ? "Growth" : id === "agency" ? "Agency" : "Scale";
}

/* ------------------------------------------------------------------ */
/* Current user                                                        */
/* ------------------------------------------------------------------ */
export type AppUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  initials: string;
  plan: string;
};

export async function getCurrentUser(): Promise<AppUser | null> {
  const sb = getSupabase();
  if (!sb) {
    return {
      id: "demo",
      name: CURRENT_USER.name,
      email: CURRENT_USER.email,
      avatarUrl: CURRENT_USER.avatar,
      initials: CURRENT_USER.initials,
      plan: PLAN,
    };
  }
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return null;
  const { data: profile } = await sb.from("profiles").select("name, avatar_url").eq("id", session.user.id).single();
  const name = profile?.name ?? session.user.email?.split("@")[0] ?? "User";
  const initials = name.split(/\s+/).slice(0, 2).map((s: string) => s[0]?.toUpperCase() ?? "").join("");
  let plan = "Free";
  try {
    const { data: sub } = await sb.from("subscriptions").select("plan_id").eq("user_id", session.user.id).maybeSingle();
    if (sub) plan = planLabel(sub.plan_id);
  } catch { /* subscription optional until billing wired */ }
  return { id: session.user.id, name, email: session.user.email ?? "", avatarUrl: profile?.avatar_url ?? null, initials, plan };
}

export async function updateProfile(name: string, email: string) {
  const sb = getSupabase();
  if (!sb) return;
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return;
  await sb.from("profiles").update({ name }).eq("id", session.user.id);
  if (email && email !== session.user.email) {
    await sb.auth.updateUser({ email });
  }
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */
export async function signIn(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) {
    await wait(700);
    return { error: null };
  }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function signUp(name: string, email: string, password: string) {
  const sb = getSupabase();
  if (!sb) {
    await wait(900);
    return { error: null, needsConfirm: false };
  }
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo: `${window.location.origin}/#/overview`,
    },
  });
  return {
    error: error?.message ?? null,
    needsConfirm: Boolean(data.user && !data.session),
  };
}

export async function requestPasswordReset(email: string) {
  const sb = getSupabase();
  if (!sb) {
    await wait(700);
    return { error: null };
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/#/reset?step=update`,
  });
  return { error: error?.message ?? null };
}

export async function updatePassword(password: string) {
  const sb = getSupabase();
  if (!sb) {
    await wait(700);
    return { error: null };
  }
  const { error } = await sb.auth.updateUser({ password });
  return { error: error?.message ?? null };
}

export async function signOut() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/* Workspaces                                                          */
/* ------------------------------------------------------------------ */
export async function listWorkspaces(): Promise<Workspace[]> {
  const sb = getSupabase();
  if (!sb) return WORKSPACES;
  const { data, error } = await sb
    .from("workspaces")
    .select("*, workspace_members(count)")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapWorkspace);
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const sb = getSupabase();
  if (!sb) return WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0];
  const { data, error } = await sb.from("workspaces").select("*, workspace_members(count)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapWorkspace(data) : null;
}

export async function createWorkspace(name: string): Promise<{ workspace?: Workspace; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: "demo" };
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return { error: "Not signed in" };
  const { data, error } = await sb
    .from("workspaces")
    .insert({ name, owner_id: session.user.id, is_client: true })
    .select()
    .single();
  if (error) return { error: readableError(error.message) };
  if (data) {
    await sb.from("workspace_members").insert({ workspace_id: data.id, user_id: session.user.id, role: "owner" });
  }
  return { workspace: data ? mapWorkspace(data) : undefined };
}

export async function getDefaultWorkspace(): Promise<Workspace> {
  const ws = await listWorkspaces();
  const selected = getSelectedWorkspaceId();
  return ws.find((w) => w.id === selected) ?? ws[0];
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */
export type OverviewData = {
  kpi: { leadsFound: number; leadsSaved: number; searches: number; exported: number; remaining: number; allowance: number };
  searches: SearchRecord[];
  lists: LeadList[];
  activity: ActivityItem[];
};

export async function getOverview(workspaceId: string): Promise<OverviewData> {
  const sb = getSupabase();
  if (!sb) {
    return {
      kpi: { leadsFound: KPI.leadsFound, leadsSaved: KPI.leadsSaved, searches: KPI.searches, exported: KPI.exported, remaining: KPI.remaining, allowance: KPI.allowance },
      searches: SEARCH_HISTORY.slice(0, 5),
      lists: LISTS.slice(0, 4),
      activity: ACTIVITY.slice(0, 5),
    };
  }
  const period = new Date();
  period.setDate(1);
  const [searches, lists, usage, activity] = await Promise.all([
    sb.from("lead_searches").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5),
    sb.from("lead_lists").select("*, lead_list_members(count)").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(4),
    sb.from("usage_counters").select("*").eq("workspace_id", workspaceId).eq("period_start", period.toISOString().slice(0, 10)).maybeSingle(),
    sb.from("activity_logs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5),
  ]);
  const leadsFound = (searches.data ?? []).reduce((a: number, s: any) => a + (s.result_count ?? 0), 0);
  const listsData = (lists.data ?? []).map((l: any) => mapList({ ...l, lead_count: l.lead_list_members?.[0]?.count ?? 0 }));
  return {
    kpi: {
      leadsFound,
      leadsSaved: listsData.reduce((a: number, l: LeadList) => a + l.lead_count, 0),
      searches: usage.data?.searches ?? (searches.data ?? []).length,
      exported: usage.data?.exports ?? 0,
      remaining: Math.max(0, 50000 - (usage.data?.leads_used ?? 0)),
      allowance: 50000,
    },
    searches: (searches.data ?? []).map(mapSearch),
    lists: listsData,
    activity: (activity.data ?? []).map((a: any) => ({ id: String(a.id), kind: a.kind, text: a.text, at: a.created_at })),
  };
}

/* ------------------------------------------------------------------ */
/* Find — run search (Edge Function does everything provider-side)     */
/* ------------------------------------------------------------------ */
export type SearchRunResult = {
  searchId: string;
  leads: Lead[];
  stats: {
    requested: number;
    found: number;
    dedupeRemoved: number;
    savedCount: number;
    remaining: number;
    interpretation: Record<string, unknown> | null;
    insights: string[];
    suggestions: string[];
  };
};

export async function runSearch(workspaceId: string, query: string): Promise<{ result?: SearchRunResult; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: "demo" };
  const { data, error } = await sb.functions.invoke("search-run", {
    body: { workspaceId, query },
  });
  if (error) {
    return { error: readableFunctionError(error) };
  }
  if (data?.error) return { error: data.error };
  return {
    result: {
      ...(data as SearchRunResult),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      leads: ((data as any).leads ?? []).map(mapLead),
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
  withWebsite?: boolean;
  withEmail?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listLeads(workspaceId: string, f: LeadFilters): Promise<{ rows: Lead[]; total: number }> {
  const sb = getSupabase();
  if (!sb) {
    const rows = LEADS.filter((l) => {
      if (f.status && l.status !== f.status) return false;
      if (f.city && l.city !== f.city) return false;
      if (f.category && l.category !== f.category) return false;
      if (f.minRating && l.rating < f.minRating) return false;
      if (f.withWebsite && !l.website) return false;
      if (f.withEmail && !l.email) return false;
      if (f.search && !`${l.name} ${l.category} ${l.city}`.toLowerCase().includes(f.search.toLowerCase())) return false;
      return true;
    });
    return { rows, total: rows.length };
  }
  const from = ((f.page ?? 1) - 1) * (f.pageSize ?? 12);
  const to = from + (f.pageSize ?? 12) - 1;
  let q = sb
    .from("leads")
    .select(LEAD_SELECT, { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (f.status) q = q.eq("status", f.status);
  if (f.city) q = q.eq("city", f.city);
  if (f.category) q = q.eq("category", f.category);
  if (f.minRating) q = q.gte("rating", f.minRating);
  if (f.withWebsite) q = q.not("website", "is", null);
  if (f.withEmail) q = q.not("email", "is", null);
  if (f.search) q = q.ilike("name", `%${f.search}%`);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []).map(mapLead), total: count ?? 0 };
}

export async function getLead(id: string, workspaceId?: string): Promise<Lead | null> {
  const sb = getSupabase();
  if (!sb) return LEADS.find((l) => l.id === id) ?? LEADS[0];
  let q = sb.from("leads").select(LEAD_SELECT).eq("id", id);
  if (workspaceId) q = q.eq("workspace_id", workspaceId);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return mapLead(data);
}

export async function updateLeadStatus(id: string, status: LeadStatus) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("leads").update({ status }).eq("id", id);
}

export async function updateLeadTags(id: string, tags: string[]) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("leads").update({ tags }).eq("id", id);
}

export async function addLeadNote(leadId: string, body: string): Promise<Note | null> {
  const sb = getSupabase();
  if (!sb) return { id: `note-${Date.now()}`, author: CURRENT_USER.name, body, at: new Date().toISOString() };
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await sb.from("lead_notes").insert({ lead_id: leadId, author_id: user.id, body }).select().single();
  if (error) return null;
  return { id: data.id, author: user.name, body: data.body, at: data.created_at };
}

export async function deleteLeadNote(noteId: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("lead_notes").delete().eq("id", noteId);
}

export async function deleteLeads(ids: string[]) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("leads").delete().in("id", ids);
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */
export async function getLists(workspaceId: string): Promise<LeadList[]> {
  const sb = getSupabase();
  if (!sb) return LISTS;
  const { data, error } = await sb
    .from("lead_lists")
    .select("*, lead_list_members(count)")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((l: any) => mapList({ ...l, lead_count: l.lead_list_members?.[0]?.count ?? 0 }));
}

export async function createList(workspaceId: string, name: string, description: string) {
  const sb = getSupabase();
  if (!sb) return { error: "demo" };
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const { data, error } = await sb
    .from("lead_lists")
    .insert({ workspace_id: workspaceId, owner_id: user.id, name, description })
    .select()
    .single();
  if (error) return { error: readableError(error.message) };
  return { list: mapList(data) };
}

export async function deleteList(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("lead_lists").delete().eq("id", id);
}

export async function listMembers(listId: string, workspaceId: string): Promise<Lead[]> {
  const sb = getSupabase();
  if (!sb) {
    const list = LISTS.find((l) => l.id === listId);
    return list ? LEADS.filter((l) => l.list_ids.includes(listId)) : [];
  }
  const { data, error } = await sb
    .from("lead_list_members")
    .select(`leads(${LEAD_SELECT})`)
    .eq("list_id", listId);
  if (error) throw error;
  return (data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => m.leads)
    .filter(Boolean)
    .map(mapLead);
  void workspaceId;
}

export async function addToList(listId: string, leadIds: string[]) {
  const sb = getSupabase();
  if (!sb) return;
  const rows = leadIds.map((id) => ({ list_id: listId, lead_id: id }));
  await sb.from("lead_list_members").upsert(rows, { onConflict: "list_id,lead_id" });
}

export async function removeFromList(listId: string, leadIds: string[]) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("lead_list_members").delete().eq("list_id", listId).in("lead_id", leadIds);
}

/* ------------------------------------------------------------------ */
/* Search history                                                      */
/* ------------------------------------------------------------------ */
export async function getSearches(workspaceId: string): Promise<SearchRecord[]> {
  const sb = getSupabase();
  if (!sb) return SEARCH_HISTORY;
  const { data, error } = await sb
    .from("lead_searches")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(mapSearch);
}

export async function deleteSearch(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("lead_searches").delete().eq("id", id);
}

export async function getSearchResults(searchId: string): Promise<Lead[]> {
  const sb = getSupabase();
  if (!sb) return LEADS.slice(0, 24);
  const { data, error } = await sb
    .from("leads")
    .select(LEAD_SELECT)
    .eq("search_id", searchId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map(mapLead);
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */
export async function getExports(workspaceId: string): Promise<ExportRecord[]> {
  const sb = getSupabase();
  if (!sb) return EXPORTS;
  const { data, error } = await sb
    .from("exports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(mapExport);
}

export async function runExport(workspaceId: string, leadIds: string[], source: string, fileName?: string) {
  const sb = getSupabase();
  if (!sb) return { error: "demo" };
  const { data, error } = await sb.functions.invoke("export-run", {
    body: { workspaceId, leadIds, source, fileName },
  });
  if (error) return { error: readableFunctionError(error) };
  if (data?.error) return { error: data.error };
  return { export: data as { id: string; file_name: string; lead_count: number; status: string } };
}

export async function downloadExport(id: string): Promise<{ csv?: string; fileName?: string; error?: string }> {
  const sb = getSupabase();
  if (!sb) {
    const head = "name,category,city,state,rating,reviews,phone,email,website,status";
    const body = LEADS.slice(0, 5)
      .map((l) => [l.name, l.category, l.city, l.state, l.rating, l.reviews, l.phone, l.email ?? "", l.website_domain ?? "", l.status].join(","))
      .join("\n");
    return { csv: `${head}\n${body}`, fileName: "demo-export.csv" };
  }
  const { data, error } = await sb.from("exports").select("csv, file_name, status").eq("id", id).maybeSingle();
  if (error || !data) return { error: "Export not found" };
  if (data.status !== "completed") return { error: "This export is still processing." };
  return { csv: data.csv ?? "", fileName: data.file_name };
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */
export async function getTeam(workspaceId: string): Promise<TeamMember[]> {
  const sb = getSupabase();
  if (!sb) return TEAM;
  const { data, error } = await sb
    .from("workspace_members")
    .select("*, profiles:user_id(name, avatar_url), auth_email:user_id(email)")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((m: any) => ({
    id: m.user_id,
    name: m.profiles?.name ?? "Member",
    email: m.auth_email?.email ?? "—",
    role: m.role as Role,
    workspace: "Workspace",
    status: "active" as const,
    joined_at: m.created_at,
    initials: (m.profiles?.name ?? "M").slice(0, 2).toUpperCase(),
    tint: "bg-stone-100 text-stone-600",
  }));
}

export async function inviteMember(workspaceId: string, email: string, role: "admin" | "member") {
  const sb = getSupabase();
  if (!sb) return { error: "demo" };
  const { data, error } = await sb.functions.invoke("team-invite", {
    body: { workspaceId, email, role },
  });
  if (error) return { error: readableFunctionError(error) };
  if (data?.error) return { error: data.error };
  return { ok: true as const };
}

export async function removeMember(workspaceId: string, userId: string) {
  const sb = getSupabase();
  if (!sb) return { error: "demo" };
  const { error } = await sb.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId);
  return { error: error?.message };
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
  resetDate: string;
  weekly: number[];
  weekLabels: string[];
};

export async function getUsage(workspaceId: string): Promise<UsageData> {
  const sb = getSupabase();
  if (!sb) {
    return {
      used: KPI.used,
      allowance: KPI.allowance,
      remaining: KPI.remaining,
      searches: KPI.searches,
      exports: KPI.exported,
      aiRuns: KPI.aiRuns,
      resetDate: KPI.resetDate,
      weekly: WEEKLY_USAGE as unknown as number[],
      weekLabels: WEEK_LABELS as unknown as string[],
    };
  }
  const period = new Date();
  period.setDate(1);
  const { data } = await sb
    .from("usage_counters")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("period_start", period.toISOString().slice(0, 10))
    .maybeSingle();
  const used = data?.leads_used ?? 0;
  // allowance derives from the workspace owner's subscription via plans
  let allowance = 50;
  try {
    const { data: ws } = await sb.from("workspaces").select("plan_id").eq("id", workspaceId).single();
    const planCaps: Record<string, number> = { free: 50, growth: 5000, agency: 15000, scale: 50000 };
    allowance = planCaps[ws?.plan_id ?? "free"] ?? 50;
  } catch { /* free default */ }
  return {
    used,
    allowance,
    remaining: Math.max(0, allowance - used),
    searches: data?.searches ?? 0,
    exports: data?.exports ?? 0,
    aiRuns: data?.ai_runs ?? 0,
    resetDate: new Date(period.getFullYear(), period.getMonth() + 1, 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    weekly: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, used],
    weekLabels: WEEK_LABELS as unknown as string[],
  };
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */
export async function analyzeLead(leadId: string, workspaceId: string) {
  const sb = getSupabase();
  if (!sb) return { error: "demo" };
  const { data, error } = await sb.functions.invoke("ai-analyze", {
    body: { leadId, workspaceId },
  });
  if (error) return { error: readableFunctionError(error) };
  if (data?.error) return { error: data.error };
  return {
    result: data as { summary: string; points: string[]; model: string },
  };
}

export async function getLeadInsight(leadId: string): Promise<{ summary: string; points: string[] } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("ai_insights").select("summary, points").eq("lead_id", leadId).maybeSingle();
  return data ?? null;
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */
export type BillingState = {
  plan: string;
  status: string;
  renewalDate: string;
  invoices: Invoice[];
  seatInfo: { used: number; limit: number };
};

export async function getBilling(workspaceId: string): Promise<BillingState> {
  const sb = getSupabase();
  if (!sb) {
    return {
      plan: PLAN,
      status: "active",
      renewalDate: KPI.renewalDate,
      invoices: (await Promise.resolve()) as unknown as Invoice[],
      seatInfo: { used: 3, limit: 3 },
    };
  }
  const user = await getCurrentUser();
  const { data: sub } = await sb
    .from("subscriptions")
    .select("*")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();
  const { data: invoices } = await sb
    .from("invoices")
    .select("*")
    .eq("user_id", user?.id ?? "")
    .order("issued_at", { ascending: false })
    .limit(10);
  const { data: members } = await sb.from("workspace_members").select("user_id", { count: "exact" }).eq("workspace_id", workspaceId);
  const planCap: Record<string, number> = { free: 1, growth: 1, agency: 3, scale: 5 };
  return {
    plan: planLabel(sub?.plan_id ?? "free"),
    status: sub?.status ?? "active",
    renewalDate: sub?.current_period_end
      ? new Date(sub.current_period_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "—",
    invoices: (invoices ?? []).map((i: any) => ({
      id: i.number,
      date: i.issued_at,
      description: i.description,
      amount: `$${(i.amount_cents / 100).toFixed(2)}`,
      status: i.status,
    })),
    seatInfo: { used: members?.length ?? 1, limit: planCap[sub?.plan_id ?? "free"] ?? 1 },
  };
}

export async function startCheckout(planId: "growth" | "agency" | "scale") {
  const sb = getSupabase();
  if (!sb) return { error: "demo" };
  const { data, error } = await sb.functions.invoke("billing", {
    body: { action: "checkout", plan: planId, returnTo: window.location.href },
  });
  if (error) return { error: readableFunctionError(error) };
  if (data?.error) return { error: data.error };
  return { url: data?.url as string };
}

export async function cancelSubscription() {
  const sb = getSupabase();
  if (!sb) return { error: "demo" };
  const { data, error } = await sb.functions.invoke("billing", { body: { action: "cancel" } });
  if (error) return { error: readableFunctionError(error) };
  if (data?.error) return { error: data.error };
  return { ok: true as const };
}

export async function syncBilling() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.functions.invoke("billing", { body: { action: "sync" } });
}

/* ------------------------------------------------------------------ */
/* Error helpers                                                       */
/* ------------------------------------------------------------------ */
function readableError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("list_limit")) return "Your plan allows one list. Upgrade for unlimited lists.";
  if (m.includes("seat_limit")) return "You've reached your plan's team-seat limit.";
  if (m.includes("client_workspaces_not_available")) return "Client workspaces are available on Agency and Scale.";
  if (m.includes("duplicate")) return "That already exists.";
  return message;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readableFunctionError(error: any): string {
  const msg = String(error?.message ?? error ?? "Something went wrong");
  if (msg.includes("quota")) return "You've reached your monthly lead limit.";
  if (msg.includes("FunctionsHttpError")) return "The service could not complete that action. Please try again.";
  if (msg.includes("401")) return "Your session expired — please sign in again.";
  return msg;
}

export const demoNotice = "Running on demo data — connect Supabase to persist changes.";
