import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  businessSizeFromProvider,
  canonicalDedupeKey,
  domainOf,
  normalizeAddressFromProvider,
  normalizePopularTimes,
  objectValue,
  publicEmailCandidates,
  safePriceLevel,
  stringArray,
  stringValue,
  type BusinessSize,
  type BusinessSizeResult,
} from "./_lib/search-core";
import { enrichPublicWebsite } from "./_lib/public-enrichment";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & {
  status(code: number): VercelResponse;
  json(body: unknown): void;
};

export const maxDuration = 60;

const MAX_PER_RUN = 240;
const MAX_BATCHES_PER_PLAN = 12;
const PAGE_SIZE = 20;
const MAX_PROVIDER_PAGES_TOTAL = 30;

type SearchFilters = {
  category: string;
  location: string;
  quantity: number;
  minRating: string;
  priceLevel: string;
  businessSize: "" | Exclude<BusinessSize, "unknown">;
  sort: string;
  requireWebsite: boolean;
  requirePhone: boolean;
  requireEmail: boolean;
  openNow: boolean;
};

type ProviderResult = Record<string, unknown>;
type LeadRow = Record<string, unknown> & { dedupe_key: string; email?: string | null; emails?: string[]; business_size?: BusinessSize };

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code = "api_error") {
    super(message);
  }
}

const LEAD_RESPONSE_SELECT = [
  "id", "name", "title", "place_id", "data_id", "data_cid", "kgmid", "category", "categories", "types",
  "description", "rating", "reviews", "price", "price_level", "business_size", "employee_count",
  "business_size_source", "business_size_confidence", "popular_times", "phone", "phone_normalized", "email", "emails",
  "website", "website_domain", "address", "street", "city", "state", "postal_code", "country", "country_code",
  "latitude", "longitude", "plus_code", "hours", "open_state", "hours_display", "services", "service_options",
  "amenities", "attributes", "photos", "thumbnail", "logo", "maps_url", "google_maps_url", "source", "source_url",
  "owner_name", "owner_link", "booking_links", "menu_links", "social_links", "search_query", "search_location",
  "collected_at", "updated_at", "status", "tags",
].join(",");

function env(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function bearerToken(req: VercelRequest) {
  const value = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const token = value?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError(401, "Your session expired — sign in again.", "auth_missing");
  return token;
}

function requestBody(req: VercelRequest): Record<string, unknown> {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body as Record<string, unknown>;
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "The search request wasn't valid JSON.", "invalid_json");
    }
  }
  throw new ApiError(400, "A search request is required.", "missing_body");
}

function parseFilters(input: unknown): SearchFilters {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const category = String(raw.category ?? "").trim();
  const location = String(raw.location ?? "").trim();
  if (category.length < 2) throw new ApiError(400, "Add a business category to search for.", "category_required");
  if (category.length > 120) throw new ApiError(400, "That category is too long.", "category_too_long");
  if (location.length > 140) throw new ApiError(400, "That location is too long.", "location_too_long");
  const quantity = Math.min(Math.max(1, Number(raw.quantity) || 50), MAX_PER_RUN);
  const minRating = String(raw.minRating ?? "");
  const priceLevel = String(raw.priceLevel ?? "");
  const businessSize = String(raw.businessSize ?? "");
  return {
    category,
    location,
    quantity,
    minRating: Number.isFinite(Number(minRating)) ? minRating : "",
    priceLevel: ["1", "2", "3", "4"].includes(priceLevel) ? priceLevel : "",
    businessSize: ["small", "medium", "enterprise"].includes(businessSize) ? (businessSize as SearchFilters["businessSize"]) : "",
    sort: ["rating", "reviews"].includes(String(raw.sort)) ? String(raw.sort) : "relevance",
    requireWebsite: Boolean(raw.requireWebsite),
    requirePhone: Boolean(raw.requirePhone),
    requireEmail: Boolean(raw.requireEmail),
    openNow: Boolean(raw.openNow),
  };
}

function serverClient(token: string): SupabaseClient {
  const url = env("SUPABASE_URL", "VITE_SUPABASE_URL");
  const key = env("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!url || !key) throw new ApiError(500, "The search server isn't connected to Supabase.", "supabase_config");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function assertWorkspaceAccess(sb: SupabaseClient, workspaceId: string, userId: string) {
  const { data, error } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new ApiError(403, "You don't have access to that workspace.", "workspace_forbidden");
}

async function reserveLeads(sb: SupabaseClient, workspaceId: string, delta: number) {
  const { data, error } = await sb.rpc("reserve_leads", { ws: workspaceId, delta });
  if (error) throw new ApiError(500, "Usage accounting failed — try again.", "usage_failed");
  if (data === -1) throw new ApiError(403, "You don't have access to that workspace.", "workspace_forbidden");
  if (data === -2) throw new ApiError(429, "You've reached your monthly lead limit.", "quota_exceeded");
}

async function refundLeads(sb: SupabaseClient, workspaceId: string, count: number) {
  if (count < 1) return;
  try { await sb.rpc("reserve_leads", { ws: workspaceId, delta: -count }); } catch { /* best effort */ }
}

const EMPTY_RESULT_HINTS = ["hasn't returned any results", "has not returned any results", "no results found", "google maps hasn't returned"];

export async function serpApiMaps(apiKey: string, params: { q: string; start: number; ll?: string | null }): Promise<Record<string, unknown>> {
  const search = new URLSearchParams({
    engine: "google_maps",
    type: "search",
    q: params.q,
    google_domain: "google.com",
    hl: "en",
    api_key: apiKey,
  });
  if (params.ll) search.set("ll", params.ll);
  if (params.start > 0) search.set("start", String(params.start));

  let response: Response;
  try {
    response = await fetch(`https://serpapi.com/search.json?${search.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError(502, "The business-data provider couldn't be reached. Try again shortly.", "provider_unreachable");
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const providerMessage = typeof payload.error === "string" ? payload.error : "";
  if (!response.ok || providerMessage) {
    const lower = providerMessage.toLowerCase();
    if (response.ok && EMPTY_RESULT_HINTS.some((hint) => lower.includes(hint))) return { local_results: [] };
    console.error("serpapi error", { status: response.status, message: providerMessage.slice(0, 220) });
    if (response.status === 401 || response.status === 403 || lower.includes("api key")) {
      throw new ApiError(502, "The business-data provider key was rejected. Check SERPAPI_API_KEY.", "provider_auth");
    }
    if (response.status === 429 || lower.includes("limit") || lower.includes("credit")) {
      throw new ApiError(502, "The business-data provider quota has been reached.", "provider_quota");
    }
    throw new ApiError(502, "The business-data provider failed. Try again shortly.", "provider_failed");
  }
  return payload;
}

export function pageResults(page: Record<string, unknown>): ProviderResult[] {
  if (Array.isArray(page.local_results)) return page.local_results as ProviderResult[];
  if (page.local_results && typeof page.local_results === "object") return [page.local_results as ProviderResult];
  if (Array.isArray(page.place_results)) return page.place_results as ProviderResult[];
  if (page.place_results && typeof page.place_results === "object") return [page.place_results as ProviderResult];
  return [];
}

export function llFromPage(page: Record<string, unknown>, results: ProviderResult[]): string | null {
  const fromParams = stringValue((page.search_parameters as Record<string, unknown> | undefined)?.ll);
  if (fromParams) return fromParams;
  const points: { lat: number; lng: number }[] = [];
  for (const result of results) {
    const gps = objectValue(result.gps_coordinates);
    const lat = Number(gps.latitude);
    const lng = Number(gps.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push({ lat, lng });
  }
  if (!points.length) return null;
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  return `@${lat.toFixed(7)},${lng.toFixed(7)},12z`;
}

function toLinks(value: unknown): string[] {
  if (!value) return [];
  if (!Array.isArray(value)) return [String(value)];
  return value.map((item) => (typeof item === "string" ? item : stringValue(objectValue(item).link))).filter(Boolean);
}

function extractExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const lines: string[] = [];
  for (const entry of value) {
    const group = objectValue(entry);
    const values = Array.isArray(group.values) ? group.values : [];
    for (const item of values) lines.push(typeof item === "string" ? item : stringValue(objectValue(item).text));
    const title = stringValue(group.title);
    if (title) lines.push(title);
  }
  return [...new Set(lines.filter(Boolean))].slice(0, 12);
}

function searchPlans(filters: SearchFilters) {
  if (!filters.location) return [filters.category];
  return [...new Set([
    `${filters.category} in ${filters.location}`,
    `${filters.category} near ${filters.location}`,
    `${filters.category} ${filters.location}`,
  ])];
}

function baseNormalize(result: ProviderResult, meta: { query: string; location: string | null }): LeadRow {
  const gps = objectValue(result.gps_coordinates);
  const links = objectValue(result.links);
  const website = stringValue(result.website) || null;
  const domain = domainOf(website);
  const phone = stringValue(result.phone) || null;
  const phoneNormalized = phone ? phone.replace(/\D+/g, "") : null;
  const title = stringValue(result.title) || stringValue(result.name) || "Unknown business";
  const addressInfo = normalizeAddressFromProvider(result, meta.location);
  const placeId = stringValue(result.place_id) || null;
  const dataId = stringValue(result.data_id) || null;
  const dataCid = result.data_cid != null ? String(result.data_cid) : null;
  const type = stringValue(result.type);
  const categories = stringArray(result.types).length ? stringArray(result.types) : type ? [type] : [];
  const openText = stringValue(result.open_state).toLowerCase();
  const openState = openText ? (openText.includes("open") && !openText.includes("close") ? "open" : "closed") : "unknown";
  const providerEmails = publicEmailCandidates(result);
  const providerSize = businessSizeFromProvider(result);
  const mapsLink = stringValue(links.place_results_search);
  const priceLevel = safePriceLevel(result);
  const popularTimes = normalizePopularTimes(result.popular_times ?? result.popular_times_graph ?? result.busy_times);

  const partial = { website_domain: domain, phone_normalized: phoneNormalized, name: title, address: addressInfo.address };
  return {
    name: title,
    title,
    place_id: placeId,
    data_id: dataId,
    data_cid: dataCid,
    kgmid: stringValue(result.kgmid) || null,
    category: type || categories[0] || "Business",
    categories,
    types: categories.map((item) => item.toLowerCase().replace(/\s+/g, "_")),
    description: stringValue(result.description) || null,
    rating: result.rating != null ? Number(result.rating) : null,
    reviews: result.reviews != null ? Number(result.reviews) : 0,
    price: stringValue(result.price) || null,
    price_level: priceLevel,
    business_size: providerSize.business_size,
    employee_count: providerSize.employee_count,
    business_size_source: providerSize.business_size_source,
    business_size_confidence: providerSize.business_size_confidence,
    popular_times: popularTimes ?? {},
    phone,
    phone_normalized: phoneNormalized,
    email: providerEmails[0] ?? null,
    emails: providerEmails,
    website,
    website_domain: domain,
    address: addressInfo.address,
    street: addressInfo.street,
    city: addressInfo.city,
    state: addressInfo.state,
    postal_code: addressInfo.postal_code,
    country: addressInfo.country,
    country_code: addressInfo.country_code,
    latitude: gps.latitude ?? null,
    longitude: gps.longitude ?? null,
    plus_code: stringValue(result.plus_code) || null,
    hours: objectValue(result.hours),
    open_state: openState,
    hours_display: stringValue(result.open_state) || null,
    services: extractExtensions(result.extensions),
    service_options: [],
    amenities: [],
    attributes: [],
    photos: Array.isArray(result.images) ? result.images.length : result.photos_link ? 1 : 0,
    thumbnail: stringValue(result.thumbnail) || null,
    maps_url: mapsLink || stringValue(result.maps_url) || (placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : null),
    google_maps_url: dataCid ? `https://maps.google.com/?cid=${dataCid}` : null,
    booking_links: toLinks(result.booking_link ?? result.booking_links),
    menu_links: toLinks(result.menu_link ?? result.menu_links),
    social_links: toLinks(result.social_links),
    source: "Google Maps",
    source_url: mapsLink || null,
    owner_name: stringValue(result.owner) || null,
    owner_link: stringValue(result.owner_link) || null,
    search_query: meta.query,
    search_location: meta.location,
    provider: "serpapi",
    provider_version: "google_maps.local_results",
    raw_data: result,
    dedupe_key: canonicalDedupeKey(result, partial),
  };
}

async function enrichRow(row: LeadRow, filters: SearchFilters): Promise<LeadRow> {
  const needsWebsiteFetch = Boolean(row.website && ((filters.requireEmail && !(row.emails as string[])?.length) || filters.businessSize));
  if (!needsWebsiteFetch) return row;
  const enrichment = await enrichPublicWebsite(row.website as string | null).catch(() => null);
  if (!enrichment) return row;
  const emails = [...new Set([...(row.emails ?? []), ...enrichment.emails])];
  const size: BusinessSizeResult = row.business_size === "unknown" ? enrichment.employeeSize : {
    business_size: row.business_size as BusinessSize,
    employee_count: (row.employee_count as number | null) ?? null,
    business_size_source: (row.business_size_source as "provider" | "website" | "unknown") ?? "provider",
    business_size_confidence: Number(row.business_size_confidence ?? 0),
  };
  return {
    ...row,
    email: emails[0] ?? row.email ?? null,
    emails,
    business_size: size.business_size,
    employee_count: size.employee_count,
    business_size_source: size.business_size_source,
    business_size_confidence: size.business_size_confidence,
  };
}

function matchesFilters(row: LeadRow, filters: SearchFilters) {
  if (filters.requireWebsite && !row.website) return false;
  if (filters.requirePhone && !row.phone) return false;
  if (filters.requireEmail && !(Array.isArray(row.emails) && row.emails.length)) return false;
  if (filters.openNow && row.open_state !== "open") return false;
  if (filters.minRating && Number(row.rating ?? 0) < Number(filters.minRating)) return false;
  if (filters.priceLevel && row.price_level != null && Number(row.price_level) !== Number(filters.priceLevel)) return false;
  if (filters.businessSize && row.business_size !== filters.businessSize) return false;
  return true;
}

function sortRows(rows: LeadRow[], sort: string) {
  if (sort === "rating") rows.sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0));
  if (sort === "reviews") rows.sort((a, b) => Number(b.reviews ?? 0) - Number(a.reviews ?? 0));
}

async function existingKeys(sb: SupabaseClient, workspaceId: string, keys: string[]) {
  if (!keys.length) return new Set<string>();
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await sb
      .from("leads")
      .select("dedupe_key")
      .eq("workspace_id", workspaceId)
      .in("dedupe_key", keys.slice(i, i + 100));
    if (error) throw new ApiError(500, "Couldn't check existing workspace leads.", "dedupe_check_failed");
    for (const row of data ?? []) out.add(row.dedupe_key);
  }
  return out;
}

async function updateSearch(sb: SupabaseClient, searchId: string, values: Record<string, unknown>) {
  await sb.from("lead_searches").update(values).eq("id", searchId);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let sb: SupabaseClient | null = null;
  let workspaceId = "";
  let searchId = "";
  let reserved = 0;
  let saved = 0;

  try {
    const apiKey = env("SERPAPI_API_KEY", "SERPAPI_KEY", "SERP_API_KEY");
    if (!apiKey) throw new ApiError(500, "SerpApi isn't configured in Vercel. Add SERPAPI_API_KEY and redeploy.", "serpapi_config");

    const body = requestBody(req);
    workspaceId = String(body.workspaceId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new ApiError(400, "A valid workspace is required.", "workspace_invalid");
    const filters = parseFilters(body.filters);
    const token = bearerToken(req);
    sb = serverClient(token);

    const { data: authData, error: userError } = await sb.auth.getUser(token);
    if (userError || !authData.user) throw new ApiError(401, "Your session expired — sign in again.", "auth_invalid");
    await assertWorkspaceAccess(sb, workspaceId, authData.user.id);

    const plans = searchPlans(filters);
    const query = plans[0];
    const interpretation = {
      q: query,
      category: filters.category,
      location: filters.location || null,
      requested_count: filters.quantity,
      filters: {
        require_website: filters.requireWebsite,
        require_phone: filters.requirePhone,
        require_email: filters.requireEmail,
        open_now: filters.openNow,
        min_rating: filters.minRating ? Number(filters.minRating) : null,
        price_level: filters.priceLevel ? Number(filters.priceLevel) : null,
        business_size: filters.businessSize || null,
        sort: filters.sort,
      },
      coverage: { strategy: "broad-location-query-pagination", plans },
    };

    const { data: search, error: searchError } = await sb
      .from("lead_searches")
      .insert({
        workspace_id: workspaceId,
        user_id: authData.user.id,
        query,
        interpretation,
        filters: interpretation.filters,
        location: interpretation.location,
        requested_count: filters.quantity,
        status: "fetching",
      })
      .select("id")
      .single();
    if (searchError || !search) throw new ApiError(500, "Couldn't start the search.", "search_start_failed");
    searchId = search.id;

    await reserveLeads(sb, workspaceId, filters.quantity);
    reserved = filters.quantity;

    const candidates: LeadRow[] = [];
    const seenProvider = new Set<string>();
    let providerError: ApiError | null = null;
    let pagesTried = 0;
    let exhausted = true;

    for (const planQuery of plans) {
      if (candidates.length >= filters.quantity || pagesTried >= MAX_PROVIDER_PAGES_TOTAL) break;
      let ll: string | null = null;
      for (let batch = 0; batch < MAX_BATCHES_PER_PLAN && candidates.length < filters.quantity && pagesTried < MAX_PROVIDER_PAGES_TOTAL; batch++) {
        pagesTried++;
        let page: Record<string, unknown>;
        try {
          page = await serpApiMaps(apiKey, { q: planQuery, start: batch * PAGE_SIZE, ll });
        } catch (error) {
          providerError = error instanceof ApiError ? error : new ApiError(502, "The business-data provider failed.", "provider_failed");
          break;
        }
        const results = pageResults(page);
        if (!results.length) break;
        exhausted = false;
        if (!ll) ll = llFromPage(page, results);

        const normalizedBatch: LeadRow[] = [];
        for (const raw of results) {
          const base = baseNormalize(raw, { query: planQuery, location: filters.location || null });
          if (seenProvider.has(base.dedupe_key)) continue;
          seenProvider.add(base.dedupe_key);
          normalizedBatch.push(base);
        }
        const existing = await existingKeys(sb, workspaceId, normalizedBatch.map((r) => r.dedupe_key));
        const unseenBases = normalizedBatch.filter((base) => !existing.has(base.dedupe_key));
        for (let i = 0; i < unseenBases.length && candidates.length < filters.quantity; i += 5) {
          const enrichedRows = await Promise.all(unseenBases.slice(i, i + 5).map((base) => enrichRow(base, filters)));
          for (const enriched of enrichedRows) {
            if (!matchesFilters(enriched, filters)) continue;
            candidates.push(enriched);
            if (candidates.length >= filters.quantity) break;
          }
        }

        const pagination = objectValue(page.serpapi_pagination);
        const noMorePages = batch > 0 && !pagination.next;
        if (results.length < PAGE_SIZE || noMorePages) break;
        // If SerpApi did not provide enough geography to paginate, continue
        // with another broad query plan instead of treating page 1 as the area.
        if (!ll) break;
      }
    }

    if (providerError && candidates.length === 0) throw providerError;
    sortRows(candidates, filters.sort);

    const savedIds: string[] = [];
    for (let index = 0; index < candidates.length; index += 50) {
      const chunk = candidates.slice(index, index + 50).map((row) => ({
        ...row,
        workspace_id: workspaceId,
        search_id: searchId,
        collector_id: authData.user!.id,
      }));
      const { data: inserted, error } = await sb
        .from("leads")
        .upsert(chunk, { onConflict: "workspace_id,dedupe_key", ignoreDuplicates: true })
        .select("id");
      if (error) {
        console.error("lead insert failed", { message: error.message, code: error.code });
        throw new ApiError(500, "The leads were found but couldn't be saved. Try again.", "lead_save_failed");
      }
      for (const item of inserted ?? []) savedIds.push(item.id);
    }
    saved = savedIds.length;

    await refundLeads(sb, workspaceId, Math.max(0, reserved - saved));
    reserved = saved;

    const status = providerError || saved < filters.quantity ? "partial" : "completed";
    const reason = providerError
      ? "provider"
      : saved < filters.quantity
        ? exhausted
          ? "provider_exhausted"
          : "not_enough_new_matches"
        : null;
    await updateSearch(sb, searchId, {
      status,
      result_count: saved,
      completed_at: new Date().toISOString(),
      error: providerError?.message ?? reason,
    });

    let leads: Record<string, unknown>[] = [];
    if (savedIds.length) {
      const { data, error } = await sb
        .from("leads")
        .select(LEAD_RESPONSE_SELECT)
        .in("id", savedIds)
        .order("created_at", { ascending: false });
      if (error) throw new ApiError(500, "The leads were saved but couldn't be loaded.", "lead_load_failed");
      leads = (data ?? []) as unknown as Record<string, unknown>[];
    }

    const message = saved >= filters.quantity
      ? `${saved} new lead${saved === 1 ? "" : "s"} collected`
      : saved > 0
        ? `Search partially completed — ${saved} new lead${saved === 1 ? "" : "s"} collected`
        : "Search completed — no new matching leads were available";

    return res.status(200).json({
      searchId,
      leads,
      stats: {
        requested: filters.quantity,
        found: saved,
        savedCount: saved,
        remaining: Math.max(0, filters.quantity - saved),
        status,
        reason,
        message,
        interpretation,
        insights: [
          `Searched “${filters.category}”${filters.location ? ` around ${filters.location}` : ""}.`,
          message,
        ],
      },
    });
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(500, "The service couldn't complete that action. Please try again.", "unknown");
    if (sb && workspaceId && reserved > saved) await refundLeads(sb, workspaceId, reserved - saved);
    if (sb && searchId) {
      await updateSearch(sb, searchId, {
        status: "failed",
        result_count: saved,
        completed_at: new Date().toISOString(),
        error: apiError.message,
      });
    }
    if (!(error instanceof ApiError)) console.error("search-run error", error);
    else console.warn("search-run failed", { status: apiError.status, code: apiError.code, message: apiError.message });
    return res.status(apiError.status).json({ error: apiError.message, code: apiError.code });
  }
}
