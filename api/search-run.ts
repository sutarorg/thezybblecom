import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Minimal Vercel request/response shape; avoids shipping a runtime dependency. */
type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & {
  status(code: number): VercelResponse;
  json(body: unknown): void;
};

export const maxDuration = 60;

const MAX_PER_RUN = 240;
const MAX_BATCHES = 12;
const PAGE_SIZE = 20;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type SearchFilters = {
  category: string;
  location: string;
  quantity: number;
  minRating: string;
  priceLevel: string;
  radius: string;
  sort: string;
  requireWebsite: boolean;
  requirePhone: boolean;
  requireEmail: boolean;
  openNow: boolean;
};

type ProviderResult = Record<string, unknown>;
type LeadRow = Record<string, unknown> & { dedupe_key: string };

const LEAD_RESPONSE_SELECT = [
  "id",
  "name",
  "title",
  "place_id",
  "data_id",
  "data_cid",
  "kgmid",
  "category",
  "categories",
  "types",
  "description",
  "rating",
  "reviews",
  "price",
  "price_level",
  "phone",
  "phone_normalized",
  "email",
  "emails",
  "website",
  "website_domain",
  "address",
  "street",
  "city",
  "state",
  "postal_code",
  "country",
  "country_code",
  "latitude",
  "longitude",
  "plus_code",
  "hours",
  "open_state",
  "hours_display",
  "services",
  "service_options",
  "amenities",
  "attributes",
  "photos",
  "thumbnail",
  "logo",
  "maps_url",
  "google_maps_url",
  "source",
  "source_url",
  "owner_name",
  "owner_link",
  "booking_links",
  "menu_links",
  "social_links",
  "search_query",
  "search_location",
  "collected_at",
  "updated_at",
  "status",
  "tags",
].join(",");

function env(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function bearerToken(req: VercelRequest) {
  const value = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new ApiError(401, "Your session expired — sign in again.");
  return match[1];
}

function requestBody(req: VercelRequest): Record<string, unknown> {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new ApiError(400, "The search request wasn't valid JSON.");
    }
  }
  throw new ApiError(400, "A search request is required.");
}

function parseFilters(input: unknown): SearchFilters {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const category = String(raw.category ?? "").trim();
  const location = String(raw.location ?? "").trim();
  if (category.length < 2) throw new ApiError(400, "Add a business category to search for.");
  if (category.length > 120) throw new ApiError(400, "That category is too long.");
  if (location.length > 120) throw new ApiError(400, "That location is too long.");

  const quantity = Math.min(Math.max(1, Number(raw.quantity) || 50), MAX_PER_RUN);
  const minRating = String(raw.minRating ?? "");
  const priceLevel = String(raw.priceLevel ?? "");

  return {
    category,
    location,
    quantity,
    minRating: Number.isFinite(Number(minRating)) ? minRating : "",
    priceLevel: ["1", "2", "3", "4"].includes(priceLevel) ? priceLevel : "",
    radius: String(raw.radius ?? ""),
    sort: ["rating", "reviews"].includes(String(raw.sort)) ? String(raw.sort) : "relevance",
    requireWebsite: Boolean(raw.requireWebsite),
    requirePhone: Boolean(raw.requirePhone),
    requireEmail: Boolean(raw.requireEmail),
    openNow: Boolean(raw.openNow),
  };
}

function serverClient(token: string): SupabaseClient {
  const url = env("SUPABASE_URL", "VITE_SUPABASE_URL");
  const key = env(
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY"
  );
  if (!url || !key) {
    throw new ApiError(
      500,
      "The search server isn't connected to Supabase. Add the Supabase URL and publishable key in Vercel."
    );
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function assertWorkspaceAccess(
  sb: SupabaseClient,
  workspaceId: string,
  userId: string
) {
  const { data, error } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new ApiError(403, "You don't have access to that workspace.");
}

async function reserveLeads(sb: SupabaseClient, workspaceId: string, delta: number) {
  const { data, error } = await sb.rpc("reserve_leads", { ws: workspaceId, delta });
  if (error) throw new ApiError(500, "Usage accounting failed — try again.");
  if (data === -1) throw new ApiError(403, "You don't have access to that workspace.");
  if (data === -2) throw new ApiError(429, "You've reached your monthly lead limit.");
}

async function refundLeads(sb: SupabaseClient, workspaceId: string, count: number) {
  if (count < 1) return;
  try {
    await sb.rpc("reserve_leads", { ws: workspaceId, delta: -count });
  } catch {
    // Reservation refunds are best-effort, matching the Edge Function path.
  }
}

/**
 * SerpApi returns HTTP 200 with an `error` string when a query simply has no
 * results left. That is the end of pagination, not a provider outage.
 */
const EMPTY_RESULT_HINTS = [
  "hasn't returned any results",
  "has not returned any results",
  "no results found",
  "google maps hasn't returned",
];

export async function serpApiMaps(
  apiKey: string,
  params: { q: string; start: number; ll?: string | null }
): Promise<Record<string, unknown>> {
  const search = new URLSearchParams({
    engine: "google_maps",
    type: "search",
    q: params.q,
    google_domain: "google.com",
    hl: "en",
    api_key: apiKey,
  });
  // `ll` is required by SerpApi for pages 2+ (and strongly improves relevance).
  if (params.ll) search.set("ll", params.ll);
  if (params.start > 0) search.set("start", String(params.start));

  let response: Response;
  try {
    response = await fetch(`https://serpapi.com/search.json?${search.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError(502, "The business-data provider couldn't be reached. Try again shortly.");
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const providerMessage = typeof payload.error === "string" ? payload.error : "";
  if (!response.ok || providerMessage) {
    const lower = providerMessage.toLowerCase();
    if (response.ok && EMPTY_RESULT_HINTS.some((hint) => lower.includes(hint))) {
      return { local_results: [] };
    }
    if (response.status === 401 || response.status === 403 || lower.includes("api key")) {
      throw new ApiError(
        502,
        "The SerpApi key configured in Vercel was rejected. Check SERPAPI_API_KEY and redeploy."
      );
    }
    if (response.status === 429 || lower.includes("limit") || lower.includes("credit")) {
      throw new ApiError(502, "The SerpApi search-credit limit has been reached.");
    }
    throw new ApiError(502, "The business-data provider failed. Try again shortly.");
  }
  return payload;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** SerpApi returns `local_results` for searches and `place_results` when the
 *  query resolves to a single business. Accept both shapes. */
export function pageResults(page: Record<string, unknown>): ProviderResult[] {
  if (Array.isArray(page.local_results)) return page.local_results as ProviderResult[];
  if (page.local_results && typeof page.local_results === "object") {
    return [page.local_results as ProviderResult];
  }
  if (Array.isArray(page.place_results)) return page.place_results as ProviderResult[];
  if (page.place_results && typeof page.place_results === "object") {
    return [page.place_results as ProviderResult];
  }
  return [];
}

/** Build the `@lat,lng,zoom` value SerpApi needs for pagination. */
export function llFromPage(
  page: Record<string, unknown>,
  results: ProviderResult[]
): string | null {
  const fromParams = stringValue(
    (page.search_parameters as Record<string, unknown> | undefined)?.ll
  );
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
  return `@${lat.toFixed(7)},${lng.toFixed(7)},13z`;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function norm(value: unknown) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function domainOf(value: unknown) {
  const url = stringValue(value);
  if (!url) return null;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      ""
    );
    return host || null;
  } catch {
    return norm(url) || null;
  }
}

function splitAddress(value: unknown): (string | null)[] {
  const address = stringValue(value);
  if (!address) return [null, null, null, null];
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const stateZip = parts[2] ?? "";
  const stateParts = stateZip.split(/\s+/).filter(Boolean);
  return [
    parts[0] ?? null,
    parts[1] ?? null,
    stateParts[0] ?? null,
    stateParts.slice(1).join(" ") || null,
  ];
}

function toLinks(value: unknown): string[] {
  if (!value) return [];
  if (!Array.isArray(value)) return [String(value)];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      return stringValue(objectValue(item).link);
    })
    .filter(Boolean);
}

function extractExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const lines: string[] = [];
  for (const entry of value) {
    const group = objectValue(entry);
    const values = Array.isArray(group.values) ? group.values : [];
    for (const item of values) {
      if (typeof item === "string") lines.push(item);
      else {
        const text = stringValue(objectValue(item).text);
        if (text) lines.push(text);
      }
    }
    const title = stringValue(group.title);
    if (title) lines.push(title);
  }
  return [...new Set(lines)].slice(0, 12);
}

function extractEmail(result: ProviderResult) {
  const emails = stringArray(result.emails);
  const contact = objectValue(result.contact);
  const candidate = stringValue(result.email) || emails[0] || stringValue(contact.email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function normalize(
  result: ProviderResult,
  meta: { query: string; location: string | null }
): LeadRow {
  const gps = objectValue(result.gps_coordinates);
  const links = objectValue(result.links);
  const website = stringValue(result.website) || null;
  const domain = domainOf(website);
  const phone = stringValue(result.phone) || null;
  const phoneNormalized = phone ? phone.replace(/\D+/g, "") : null;
  const title = stringValue(result.title) || "Unknown business";
  const address = stringValue(result.address) || null;
  const placeId = stringValue(result.place_id) || null;
  const dataId = stringValue(result.data_id) || null;
  const dataCid = result.data_cid != null ? String(result.data_cid) : null;
  const email = extractEmail(result);
  const type = stringValue(result.type);
  const categories = stringArray(result.types).length
    ? stringArray(result.types)
    : type
      ? [type]
      : [];
  const [street, city, state, postalCode] = splitAddress(address);
  const openText = stringValue(result.open_state).toLowerCase();
  const openState = openText
    ? openText.includes("open") && !openText.includes("close")
      ? "open"
      : "closed"
    : "unknown";
  const price = stringValue(result.price) || null;
  const numericPrice = Number(result.price_level);
  const priceLevel = Number.isFinite(numericPrice)
    ? numericPrice
    : price && /^\$+$/.test(price)
      ? price.length
      : null;
  const dedupeKey =
    placeId ??
    dataId ??
    dataCid ??
    (domain ? `d:${domain}` : null) ??
    (phoneNormalized ? `p:${phoneNormalized}` : null) ??
    `n:${norm(title)}:${norm(address)}`;
  const mapsLink = stringValue(links.place_results_search);

  return {
    name: title,
    title,
    place_id: placeId,
    data_id: dataId,
    data_cid: dataCid,
    kgmid: stringValue(result.kgmid) || null,
    category: type || "Business",
    categories,
    types: categories.map((item) => item.toLowerCase().replace(/\s+/g, "_")),
    description: stringValue(result.description) || null,
    rating: result.rating != null ? Number(result.rating) : null,
    reviews: result.reviews != null ? Number(result.reviews) : 0,
    price,
    price_level: priceLevel,
    phone,
    phone_normalized: phoneNormalized,
    email,
    emails: email ? [email] : [],
    website,
    website_domain: domain,
    address,
    street,
    city: city ?? meta.location?.split(",")[0]?.trim() ?? null,
    state,
    postal_code: postalCode,
    country: stringValue(result.country) || null,
    country_code: stringValue(result.country_code) || null,
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
    maps_url:
      mapsLink ||
      stringValue(result.maps_url) ||
      (placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : null),
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
    dedupe_key: dedupeKey,
  };
}

function matchesFilters(row: LeadRow, filters: SearchFilters) {
  if (filters.requireWebsite && !row.website) return false;
  if (filters.requirePhone && !row.phone) return false;
  if (filters.requireEmail && !row.email) return false;
  if (filters.openNow && row.open_state !== "open") return false;
  if (filters.minRating && Number(row.rating ?? 0) < Number(filters.minRating)) return false;
  if (
    filters.priceLevel &&
    row.price_level != null &&
    Number(row.price_level) !== Number(filters.priceLevel)
  ) {
    return false;
  }
  return true;
}

function sortRows(rows: LeadRow[], sort: string) {
  if (sort === "rating") {
    rows.sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0));
  } else if (sort === "reviews") {
    rows.sort((a, b) => Number(b.reviews ?? 0) - Number(a.reviews ?? 0));
  }
}

async function updateSearch(
  sb: SupabaseClient,
  searchId: string,
  values: Record<string, unknown>
) {
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
    if (!apiKey) {
      throw new ApiError(
        500,
        "SerpApi isn't configured in Vercel. Add SERPAPI_API_KEY to Production and redeploy."
      );
    }

    const body = requestBody(req);
    workspaceId = String(body.workspaceId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) {
      throw new ApiError(400, "A valid workspace is required.");
    }
    const filters = parseFilters(body.filters);
    const token = bearerToken(req);
    sb = serverClient(token);

    const {
      data: { user },
      error: userError,
    } = await sb.auth.getUser(token);
    if (userError || !user) throw new ApiError(401, "Your session expired — sign in again.");
    await assertWorkspaceAccess(sb, workspaceId, user.id);

    const query = filters.location
      ? `${filters.category} in ${filters.location}`
      : filters.category;
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
        radius: filters.radius || null,
        sort: filters.sort,
      },
    };

    const { data: search, error: searchError } = await sb
      .from("lead_searches")
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        query,
        interpretation,
        filters: interpretation.filters,
        location: interpretation.location,
        requested_count: filters.quantity,
        status: "fetching",
      })
      .select("id")
      .single();
    if (searchError || !search) throw new ApiError(500, "Couldn't start the search.");
    searchId = search.id;

    await reserveLeads(sb, workspaceId, filters.quantity);
    reserved = filters.quantity;

    const rows: LeadRow[] = [];
    const seen = new Set<string>();
    let dedupeRemoved = 0;
    let providerError: ApiError | null = null;

    let ll: string | null = null;

    for (let batch = 0; batch < MAX_BATCHES && rows.length < filters.quantity; batch++) {
      let page: Record<string, unknown>;
      try {
        page = await serpApiMaps(apiKey, { q: query, start: batch * PAGE_SIZE, ll });
      } catch (error) {
        providerError = error instanceof ApiError
          ? error
          : new ApiError(502, "The business-data provider failed. Try again shortly.");
        break;
      }
      const localResults = pageResults(page);
      if (!localResults.length) break;

      // SerpApi requires `ll` for pages 2+. Google never echoes one back when the
      // caller omitted it, so anchor the rest of the run on the first page's
      // coordinates — otherwise every search was capped at a single page.
      if (!ll) ll = llFromPage(page, localResults);

      for (const result of localResults) {
        const row = normalize(result, {
          query,
          location: filters.location || null,
        });
        if (!matchesFilters(row, filters)) continue;
        if (seen.has(row.dedupe_key)) {
          dedupeRemoved++;
          continue;
        }
        seen.add(row.dedupe_key);
        rows.push(row);
        if (rows.length >= filters.quantity) break;
      }

      const pagination = objectValue(page.serpapi_pagination);
      const exhausted = localResults.length < PAGE_SIZE;
      // Page 1 legitimately has no `next` until `ll` is known, so only trust
      // the absence of `next` once we're already paginating with coordinates.
      const noMorePages = batch > 0 && !pagination.next;
      if (exhausted || noMorePages || !ll) break;
    }

    if (providerError && rows.length === 0) throw providerError;
    sortRows(rows, filters.sort);

    const savedIds: string[] = [];
    for (let index = 0; index < rows.length; index += 50) {
      const chunk = rows.slice(index, index + 50).map((row) => ({
        ...row,
        workspace_id: workspaceId,
        search_id: searchId,
        collector_id: user.id,
      }));
      const { data: inserted, error } = await sb
        .from("leads")
        .upsert(chunk, {
          onConflict: "workspace_id,dedupe_key",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) throw new ApiError(500, "The leads were found but couldn't be saved. Try again.");
      for (const item of inserted ?? []) savedIds.push(item.id);
    }
    saved = savedIds.length;
    dedupeRemoved += Math.max(0, rows.length - saved);

    await refundLeads(sb, workspaceId, Math.max(0, reserved - saved));
    reserved = saved;

    const status = providerError
      ? "partial"
      : saved < filters.quantity
        ? "partial"
        : "completed";
    await updateSearch(sb, searchId, {
      status,
      result_count: saved,
      completed_at: new Date().toISOString(),
      error: providerError?.message ?? null,
    });

    let leads: Record<string, unknown>[] = [];
    if (savedIds.length) {
      const { data, error } = await sb
        .from("leads")
        .select(LEAD_RESPONSE_SELECT)
        .in("id", savedIds)
        .order("created_at", { ascending: false });
      if (error) throw new ApiError(500, "The leads were saved but couldn't be loaded.");
      leads = (data ?? []) as unknown as Record<string, unknown>[];
    }

    return res.status(200).json({
      searchId,
      leads,
      stats: {
        requested: filters.quantity,
        found: saved,
        savedCount: saved,
        dedupeRemoved,
        remaining: Math.max(0, filters.quantity - saved),
        interpretation,
        insights: [
          `Searched “${query}”.`,
          `${saved} new lead${saved === 1 ? "" : "s"} saved${
            dedupeRemoved
              ? `; ${dedupeRemoved} duplicate${dedupeRemoved === 1 ? "" : "s"} skipped`
              : ""
          }.`,
        ],
      },
    });
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(500, "The service couldn't complete that action. Please try again.");

    if (sb && workspaceId && reserved > saved) {
      await refundLeads(sb, workspaceId, reserved - saved);
    }
    if (sb && searchId) {
      await updateSearch(sb, searchId, {
        status: "failed",
        result_count: saved,
        completed_at: new Date().toISOString(),
        error: apiError.message,
      });
    }
    if (!(error instanceof ApiError)) console.error("search-run error", error);
    return res.status(apiError.status).json({ error: apiError.message });
  }
}
