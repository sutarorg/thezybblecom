// ============================================================================
// search-run — the Zybble lead engine (Supabase Edge Function fallback).
// Auth → workspace auth → entitlement → usage reservation → optional AI
// interpretation (DeepSeek via the server-side Puter integration) → SerpApi
// fetch → normalize → dedupe → enrich → filter → persist → accounting.
//
// Pipeline order (matches api/search-run.ts on Vercel):
//   provider search → normalize → dedupe → cheap pre-checks → website
//   enrichment → ALL selected refinements → save → return leads.
// ============================================================================
import {
  HttpError,
  INTERPRET_SYSTEM,
  PUTER_MODEL,
  callerFromRequest,
  corsHeaders,
  errorJson,
  extractJsonObject,
  getEntitlements,
  handleError,
  json,
  logActivity,
  normalizeOpenState,
  puterChatJson,
  requireWorkspaceRole,
  reserveLeads,
  serpApiMaps,
  serpApiResults,
  serpApiLl,
  serviceClient,
} from "../_shared/index.ts";

const MAX_PER_RUN = 240; // v1 cap per search
const MAX_BATCHES_PER_PLAN = 12;
const PAGE_SIZE = 20;
const MAX_PROVIDER_PAGES_TOTAL = 30;
const SEARCH_BUDGET_MS = 48_000;
const PROVIDER_TIMEOUT_MS = 8_000;
const ENRICHMENT_ROW_BUDGET_MS = 3_000;
const ENRICHMENT_PAGE_TIMEOUT_MS = 1_500;
// Rows are enriched in concurrent waves so a page of results never
// serializes 20 × 3s website visits.
const ENRICHMENT_WAVE = 8;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LocalResult = Record<string, any>;
type LeadRow = Record<string, unknown> & { dedupe_key: string };

/* ------------------------------------------------------------------ */
/* Deterministic fallback for legacy raw-query requests                 */
/* ------------------------------------------------------------------ */
function fallbackInterpret(query: string) {
  const lower = query.toLowerCase();
  const qty = lower.match(/find\s+(\d+)/)?.[1];
  const rating = lower.match(/rated?\s*(?:above|over)?\s*(\d(?:\.\d)?)/)?.[1];
  const locMatch = lower.match(/\bin\s+([a-z][a-z .]+?)(?:\s+(?:with|rated|and)|$)/i);
  const category = lower
    .replace(/^find\s+\d+\s+/, "")
    .replace(/^find\s+/, "")
    .replace(/\s+in\s+.*/, "")
    .replace(/\s+with.*/, "")
    .trim();
  return {
    q: category || query,
    category: category || null,
    location: locMatch ? locMatch[1].trim() : null,
    requested_count: qty ? Math.min(Math.max(1, Number(qty)), MAX_PER_RUN) : 50,
    filters: {
      require_website: lower.includes("website"),
      min_rating: rating ? Number(rating) : null,
    },
  };
}

/** Query plans mirror the Vercel function: broad phrasing variants. */
function searchPlans(category: string, location: string | null) {
  if (!location) return [category];
  return [...new Set([
    `${category} in ${location}`,
    `${category} near ${location}`,
    `${category} ${location}`,
  ])];
}

/* ------------------------------------------------------------------ */
/* Normalization + dedupe key                                          */
/* ------------------------------------------------------------------ */
function norm(text: string | null | undefined) {
  return (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function domainOf(url: string | null | undefined) {
  if (!url) return null;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return norm(url);
  }
}

function normalize(t: LocalResult, meta: { query: string; location: string | null }): LeadRow {
  const gps = t.gps_coordinates ?? {};
  const domain = domainOf(t.website);
  const phoneNorm = t.phone ? String(t.phone).replace(/\D+/g, "") : null;
  const dedupeSeed =
    t.place_id ??
    t.data_id ??
    t.data_cid ??
    (domain ? `d:${domain}` : null) ??
    (phoneNorm ? `p:${phoneNorm}` : null) ??
    `n:${norm(t.title)}:${norm(t.address)}`;

  const email = extractEmail(t);
  const size = providerBusinessSize(t);

  return {
    name: t.title ?? "Unknown business",
    title: t.title ?? "Unknown business",
    place_id: t.place_id ?? null,
    data_id: t.data_id ?? null,
    data_cid: t.data_cid != null ? String(t.data_cid) : null,
    kgmid: t.kgmid ?? null,
    category: t.type ?? "Business",
    categories: t.types ?? (t.type ? [t.type] : []),
    types: (t.types ?? (t.type ? [t.type] : [])).map((s: string) => s.toLowerCase().replace(/\s+/g, "_")),
    description: t.description ?? null,
    rating: t.rating != null ? Number(t.rating) : null,
    reviews: t.reviews != null ? Number(t.reviews) : 0,
    price: t.price ?? null,
    price_level: safePriceLevel(t),
    business_size: size.business_size,
    employee_count: size.employee_count,
    business_size_source: size.business_size_source,
    business_size_confidence: size.business_size_confidence,
    popular_times: t.popular_times ?? {},
    phone: t.phone ?? null,
    phone_normalized: phoneNorm,
    email,
    emails: email ? [email] : [],
    website: t.website ?? null,
    website_domain: domain,
    address: t.address ?? null,
    street: splitAddress(t.address)[0],
    city: splitAddress(t.address)[1] ?? (meta.location ?? "").split(",")[0] ?? null,
    state: splitAddress(t.address)[2] ?? null,
    postal_code: splitAddress(t.address)[3] ?? null,
    country: t.country ?? null,
    country_code: t.country_code ?? null,
    latitude: gps.latitude ?? null,
    longitude: gps.longitude ?? null,
    plus_code: t.plus_code ?? null,
    hours: t.hours && typeof t.hours === "object" ? t.hours : {},
    open_state: normalizeOpenState(t.open_state ?? t.open_state_text ?? t.operating_hours_state),
    hours_display: t.open_state ?? null,
    services: extractExtensions(t, "services"),
    service_options: extractExtensions(t, "service_options"),
    amenities: extractExtensions(t, "amenities"),
    attributes: extractExtensions(t, "attributes"),
    photos: t.images?.length ?? t.photos_link ? 1 : 0,
    thumbnail: t.thumbnail ?? null,
    maps_url: t.links?.place_results_search ?? t.maps_url ?? (t.place_id ? `https://www.google.com/maps/place/?q=place_id:${t.place_id}` : null),
    google_maps_url: t.data_cid ? `https://maps.google.com/?cid=${t.data_cid}` : null,
    booking_links: toArray(t.booking_link ?? t.booking_links),
    menu_links: toArray(t.menu_link ?? t.menu_links),
    social_links: toArray(t.social_links),
    source: "Google Maps",
    source_url: t.links?.place_results_search ?? null,
    owner_name: t.owner ?? null,
    owner_link: t.owner_link ?? null,
    search_query: meta.query,
    search_location: meta.location,
    provider: "serpapi",
    provider_version: "google_maps.local_results",
    raw_data: t,
    dedupe_key: dedupeSeed,
  };
}

function splitAddress(address: string | null | undefined): (string | null)[] {
  if (!address) return [null, null, null, null];
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const street = parts[0] ?? null;
  const city = parts[1] ?? null;
  const stateZip = parts[2] ?? null;
  const parts3 = stateZip ? stateZip.split(/\s+/) : [];
  return [street, city, parts3[0] ?? null, parts3.slice(1).join(" ") || null];
}

function toArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value))
    return value
      .map((v) => (typeof v === "string" ? v : (v as Record<string, string>)?.link ?? ""))
      .filter(Boolean);
  return [String(value)];
}

function safePriceLevel(t: LocalResult): number | null {
  if (typeof t.price_level === "number" && Number.isFinite(t.price_level) && t.price_level >= 1 && t.price_level <= 4) {
    return t.price_level;
  }
  const price = typeof t.price === "string" ? t.price.trim() : "";
  if (/^\$+$/.test(price) && price.length <= 4) return price.length;
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractExtensions(t: any, _key: string): string[] {
  const ext = t.extensions;
  if (!Array.isArray(ext)) return [];
  const lines: string[] = [];
  for (const group of ext) {
    const values = Array.isArray(group?.values) ? group.values : [];
    for (const v of values) {
      if (typeof v === "string") lines.push(v);
      else if (v && typeof v === "object" && typeof (v as Record<string, string>).text === "string")
        lines.push((v as Record<string, string>).text);
    }
    if (typeof group?.title === "string") lines.push(group.title);
  }
  return [...new Set(lines)].slice(0, 12);
}

function extractEmail(t: any): string | null {
  // SerpApi rarely returns an email; never fabricate one.
  const candidates = [
    ...(Array.isArray(t.emails) ? t.emails : []),
    t.email,
    t.contact?.email,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      return candidate.trim().toLowerCase();
    }
  }
  return null;
}

function parseEmployeeCountValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const range = text.match(/(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)\s+(?:employees|staff|team members|people)/i);
  if (range) return Number(range[2].replace(/,/g, ""));
  const plus = text.match(/(\d[\d,]*)\s*\+\s+(?:employees|staff|team members|people)/i);
  if (plus) return Number(plus[1].replace(/,/g, ""));
  const plain = text.match(/(?:employees|staff|team members|people|team of)\D{0,16}(\d[\d,]*)|(?:^|\b)(\d[\d,]*)\s+(?:employees|staff|team members|people)\b/i);
  const raw = plain?.[1] ?? plain?.[2];
  return raw ? Number(raw.replace(/,/g, "")) : null;
}

function sizeFromEmployeeCount(count: number | null, source: "provider" | "website") {
  if (!count || count < 1) return { business_size: "unknown", employee_count: null, business_size_source: "unknown", business_size_confidence: 0 };
  return {
    business_size: count >= 250 ? "enterprise" : count >= 50 ? "medium" : "small",
    employee_count: count,
    business_size_source: source,
    business_size_confidence: source === "provider" ? 0.95 : 0.75,
  };
}

function providerBusinessSize(t: LocalResult) {
  const directKeys = ["employee_count", "employees", "number_of_employees", "staff_count", "company_size"];
  for (const key of directKeys) {
    const count = parseEmployeeCountValue(t[key]);
    if (count) return sizeFromEmployeeCount(count, "provider");
  }
  const ext = t.extensions;
  if (Array.isArray(ext)) {
    for (const group of ext) {
      const values = Array.isArray(group?.values) ? group.values : [];
      for (const value of values) {
        const text = typeof value === "string" ? value : value?.text;
        const count = parseEmployeeCountValue(text);
        if (count) return sizeFromEmployeeCount(count, "provider");
      }
    }
  }
  return { business_size: "unknown", employee_count: null, business_size_source: "unknown", business_size_confidence: 0 };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* Refinements — same AND semantics as api/search-run.ts               */
/* ------------------------------------------------------------------ */
type AppliedFilters = {
  requireWebsite: boolean;
  requirePhone: boolean;
  requireEmail: boolean;
  openNow: boolean;
  minRating: number | null;
  priceLevel: number | null;
  businessSize: string | null;
};

function appliedFilters(interpretation: Record<string, unknown>): AppliedFilters {
  const nested = (interpretation.filters ?? {}) as Record<string, unknown>;
  const minRating = nested.min_rating;
  const priceLevel = interpretation.price_level;
  return {
    requireWebsite: Boolean(nested.require_website),
    requirePhone: Boolean(interpretation.require_phone),
    requireEmail: Boolean(interpretation.require_email),
    openNow: Boolean(interpretation.open_now),
    minRating: typeof minRating === "number" && Number.isFinite(minRating) ? minRating : null,
    priceLevel: typeof priceLevel === "number" && Number.isFinite(priceLevel) ? priceLevel : null,
    businessSize: ["small", "medium", "enterprise"].includes(String(interpretation.business_size)) ? String(interpretation.business_size) : null,
  };
}

/**
 * Cheap refinements that never change during enrichment run BEFORE website
 * enrichment; refinements enrichment can discover (public email, business
 * size) run after it. All selected refinements remain AND conditions.
 */
function matchesPreEnrichmentFilters(row: LeadRow, f: AppliedFilters) {
  if (f.requireWebsite && !row.website) return false;
  if (f.requirePhone && !row.phone) return false;
  if (f.openNow && row.open_state !== "open") return false;
  if (f.minRating != null && Number(row.rating ?? 0) < f.minRating) return false;
  if (f.priceLevel != null && row.price_level != null && Number(row.price_level) !== f.priceLevel) return false;
  if (f.requireEmail && !row.website && !row.emails?.length) return false;
  if (f.businessSize && row.business_size === "unknown" && !row.website) return false;
  return true;
}

function needsEnrichment(row: LeadRow, f: AppliedFilters) {
  if (!row.website) return false;
  if (f.requireEmail && !row.emails?.length) return true;
  if (f.businessSize && row.business_size === "unknown") return true;
  return false;
}

function matchesFilters(row: LeadRow, f: AppliedFilters) {
  if (f.requireWebsite && !row.website) return false;
  if (f.requirePhone && !row.phone) return false;
  if (f.requireEmail && !(Array.isArray(row.emails) && row.emails.length)) return false;
  if (f.openNow && row.open_state !== "open") return false;
  if (f.minRating != null && Number(row.rating ?? 0) < f.minRating) return false;
  if (f.priceLevel != null && row.price_level != null && Number(row.price_level) !== f.priceLevel) return false;
  if (f.businessSize && row.business_size !== f.businessSize) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Public-website enrichment (homepage + contact/about pages)           */
/* ------------------------------------------------------------------ */
function privateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1") return true;
  const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  const a = Number(match[1]);
  const b = Number(match[2]);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const EMAIL_RE = /(?<![\w.%+-])([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?![\w.%+-])/gi;

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/&commat;|&#64;/gi, "@")
    .replace(/\s+\[at\]\s+|\s+\(at\)\s+/gi, "@")
    .replace(/\s+\[dot\]\s+|\s+\(dot\)\s+/gi, ".")
    .replace(/<[^>]+>/g, " ");
}

function extractEmails(text: string, websiteDomain: string | null): string[] {
  const normalized = stripHtml(text).toLowerCase();
  const out = new Set<string>();
  for (const match of normalized.matchAll(EMAIL_RE)) {
    const email = match[1].replace(/^mailto:/, "").replace(/[.,;:]+$/, "");
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) continue;
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(email)) continue;
    const local = email.split("@")[0];
    if (["example", "test", "invalid", "noreply", "no-reply"].includes(local)) continue;
    if (websiteDomain) {
      const emailDomain = email.split("@")[1].replace(/^www\./, "");
      const siteRoot = websiteDomain.replace(/^www\./, "");
      // Prefer same-domain public addresses. Permit subdomains both ways.
      if (emailDomain !== siteRoot && !emailDomain.endsWith(`.${siteRoot}`) && !siteRoot.endsWith(`.${emailDomain}`)) {
        continue;
      }
    }
    out.add(email);
  }
  return [...out].slice(0, 8);
}

const CONTACT_PATHS = ["/", "/contact", "/contact-us", "/about", "/about-us"];

async function fetchPublicPage(url: URL, timeoutMs: number): Promise<string> {
  const addresses = await Promise.race([
    Promise.all([
      Deno.resolveDns(url.hostname, "A").catch(() => [] as string[]),
      Deno.resolveDns(url.hostname, "AAAA").catch(() => [] as string[]),
    ]).then((sets) => sets.flat()),
    new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error("DNS timeout")), timeoutMs)),
  ]);
  if (!addresses.length || addresses.some(privateHost)) throw new Error("Private or unresolvable host");
  const response = await fetch(url, {
    redirect: "error",
    headers: { Accept: "text/html,text/plain;q=0.8", "User-Agent": "ZybbleBot/1.0 (+https://zybble.com)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok || !/text\/html|text\/plain|application\/xhtml\+xml/i.test(response.headers.get("content-type") ?? "")) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.text()).slice(0, 300_000);
}

/**
 * Visit the business's public website (homepage, contact, about) to discover
 * a real public email and employee-count evidence. Never fabricates either.
 */
async function enrichWebsiteRow(row: LeadRow, deadlineAt: number): Promise<LeadRow> {
  const website = typeof row.website === "string" ? row.website : "";
  if (!website || Date.now() >= deadlineAt) return row;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  } catch {
    return row;
  }
  if (!["http:", "https:"].includes(url.protocol) || privateHost(url.hostname)) return row;

  const siteDomain = domainOf(website)?.toLowerCase() ?? null;
  const emails = new Set<string>(Array.isArray(row.emails) ? row.emails.map(String) : []);
  let combinedText = "";

  for (const path of CONTACT_PATHS) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 50) break;
    try {
      const text = await fetchPublicPage(new URL(path, url), Math.min(ENRICHMENT_PAGE_TIMEOUT_MS, remaining));
      combinedText += `\n${text}`;
      for (const email of extractEmails(text, siteDomain)) emails.add(email);
      // Enough public evidence — stop visiting more pages.
      if (emails.size >= 4) break;
    } catch {
      // Public enrichment is opportunistic per page; no fabricated fallback.
    }
  }

  const employeeMatch = stripHtml(combinedText).match(
    /(?:team of|employees|staff|team members|people)\D{0,18}(\d[\d,]*)|(\d[\d,]*)\s+(?:employees|staff|team members|people)\b/i
  );
  const employeeCount = employeeMatch ? Number((employeeMatch[1] ?? employeeMatch[2]).replace(/,/g, "")) : null;
  const size = employeeCount ? sizeFromEmployeeCount(employeeCount, "website") : null;
  const emailList = [...emails];

  return {
    ...row,
    email: emailList[0] ?? row.email ?? null,
    emails: emailList,
    business_size: row.business_size === "unknown" && size ? size.business_size : row.business_size,
    employee_count: row.business_size === "unknown" && size ? size.employee_count : row.employee_count,
    business_size_source: row.business_size === "unknown" && size ? size.business_size_source : row.business_size_source,
    business_size_confidence: row.business_size === "unknown" && size ? size.business_size_confidence : row.business_size_confidence,
  };
}

/* ------------------------------------------------------------------ */
/* Main handler                                                        */
/* ------------------------------------------------------------------ */
Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method !== "POST") return errorJson("Method not allowed", 405, "method_not_allowed");

  const deadlineAt = Date.now() + SEARCH_BUDGET_MS;
  let accounting: { sb: ReturnType<typeof serviceClient>; workspaceId: string; searchId: string } | null = null;
  let reserved = 0;
  let saved = 0;
  let refundAttempted = false;

  try {
    const sb = serviceClient(8_000);
    const body = await req.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId ?? "");
    if (!workspaceId) throw new HttpError(400, "workspaceId is required");

    const user = await callerFromRequest(req, sb);
    await requireWorkspaceRole(sb, user.id, workspaceId);
    const entitlements = await getEntitlements(sb, user.id);

    /* ------------------------------------------------------------ */
    /* Input: structured filters the user reviewed in the UI.        */
    /* A raw `query` string is still accepted for compatibility.     */
    /* ------------------------------------------------------------ */
    const f = (body.filters ?? null) as Record<string, unknown> | null;
    let interpretation: ReturnType<typeof fallbackInterpret>;
    let query: string;
    let plans: string[];

    if (f) {
      const category = String(f.category ?? "").trim();
      if (category.length < 2) throw new HttpError(400, "Add a business category to search for.");
      if (category.length > 120) throw new HttpError(400, "That category is too long.");
      const location = String(f.location ?? "").trim().slice(0, 120);
      const quantity = Math.min(Math.max(1, Number(f.quantity) || 50), MAX_PER_RUN);
      const minRating = f.minRating ? Number(f.minRating) : null;

      interpretation = {
        q: location ? `${category} in ${location}` : category,
        category,
        location: location || null,
        requested_count: quantity,
        filters: {
          require_website: Boolean(f.requireWebsite),
          min_rating: Number.isFinite(minRating) ? minRating : null,
        },
      };
      // extra requirements applied during normalization/filtering
      (interpretation as Record<string, unknown>).require_phone = Boolean(f.requirePhone);
      (interpretation as Record<string, unknown>).require_email = Boolean(f.requireEmail);
      (interpretation as Record<string, unknown>).open_now = Boolean(f.openNow);
      (interpretation as Record<string, unknown>).price_level = f.priceLevel ? Number(f.priceLevel) : null;
      (interpretation as Record<string, unknown>).business_size = ["small", "medium", "enterprise"].includes(String(f.businessSize)) ? String(f.businessSize) : null;
      query = interpretation.q;
      plans = searchPlans(category, location || null);
    } else {
      query = String(body.query ?? "").trim();
      if (!query || query.length < 2) throw new HttpError(400, "Describe the businesses you need.");
      if (query.length > 400) throw new HttpError(400, "Keep the request under 400 characters.");
      try {
        // DeepSeek V3.2 through the server-side Puter integration (formerly
        // OpenAI's Responses API) — same plan shape, validated field-by-field.
        const plannedText = await puterChatJson({
          messages: [
            {
              role: "system",
              content: `${INTERPRET_SYSTEM}\nOnly structure the request. Do not run a search or invent requirements.`,
            },
            { role: "user", content: `User request: ${query}` },
          ],
          maxOutputTokens: 1_600,
          timeoutMs: 20_000,
        });
        const planned = extractJsonObject(plannedText) ?? {};
        interpretation = {
          q: String(planned.q || query),
          category: planned.category ? String(planned.category) : null,
          location: planned.location ? String(planned.location) : null,
          requested_count: Math.min(Math.max(1, Number(planned.requested_count) || 50), MAX_PER_RUN),
          filters: {
            require_website: Boolean((planned.filters as Record<string, unknown> | undefined)?.require_website),
            min_rating:
              (planned.filters as Record<string, unknown> | undefined)?.min_rating != null
                ? Number((planned.filters as Record<string, unknown> | undefined)!.min_rating)
                : null,
          },
        };
      } catch (e) {
        console.warn("AI interpretation failed; using deterministic fallback", {
          name: e instanceof Error ? e.name : "Unknown",
          message: e instanceof Error ? e.message : "Unknown error",
        });
        interpretation = fallbackInterpret(query);
      }
      await sb.from("ai_requests").insert({
        workspace_id: workspaceId,
        user_id: user.id,
        kind: "interpret",
        input: { query, plan: interpretation },
        status: "completed",
        model: PUTER_MODEL,
      });
      plans = [interpretation.q];
    }

    /* 2 — create search + job rows (status staging) */
    const requestedCount = interpretation!.requested_count;
    const { data: searchRow, error: searchErr } = await sb
      .from("lead_searches")
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        query,
        interpretation,
        filters: interpretation!.filters ?? {},
        location: interpretation!.location,
        requested_count: requestedCount,
        status: "fetching",
      })
      .select()
      .single();
    if (searchErr) throw new HttpError(500, "Couldn't start the search.", "search_start_failed");
    accounting = { sb, workspaceId, searchId: searchRow.id };

    const { data: jobRow } = await sb
      .from("lead_search_jobs")
      .insert({
        search_id: searchRow.id,
        workspace_id: workspaceId,
        requested_count: requestedCount,
        status: "fetching",
      })
      .select()
      .single();

    /* 3 — atomic usage reservation upfront; refund the unused remainder after */
    reserved = requestedCount;
    try {
      await reserveLeads(sb, workspaceId, reserved);
    } catch (e) {
      reserved = 0;
      await sb.from("lead_searches").update({ status: "failed", error: "quota" }).eq("id", searchRow.id);
      throw e;
    }

    /* 4 — SerpApi pagination: controlled batches across query plans */
    const req = appliedFilters(interpretation as unknown as Record<string, unknown>);
    const collected: LeadRow[] = [];
    const seenKeys = new Set<string>();
    let dedupeRemoved = 0;
    let pagesTried = 0;
    let providerError: HttpError | null = null;
    let deadlineReached = false;
    const target = requestedCount;
    let ll: string | null = null;

    try {
      searchLoop: for (const planQuery of plans) {
        if (collected.length >= target || pagesTried >= MAX_PROVIDER_PAGES_TOTAL) break;
        if (Date.now() >= deadlineAt) {
          deadlineReached = true;
          break;
        }
        ll = null;
        for (let batch = 0; batch < MAX_BATCHES_PER_PLAN && collected.length < target && pagesTried < MAX_PROVIDER_PAGES_TOTAL; batch++) {
          const remaining = deadlineAt - Date.now();
          if (remaining <= 250) {
            deadlineReached = true;
            break searchLoop;
          }
          pagesTried++;
          let page: Record<string, unknown>;
          try {
            page = await serpApiMaps({
              q: planQuery,
              ll,
              start: batch * PAGE_SIZE,
              timeoutMs: Math.min(PROVIDER_TIMEOUT_MS, remaining),
            });
          } catch (e) {
            providerError = e instanceof HttpError
              ? e
              : new HttpError(502, "The business-data provider failed. Try again shortly.", "provider_failed");
            if (Date.now() >= deadlineAt) deadlineReached = true;
            break searchLoop;
          }
          const results: LocalResult[] = serpApiResults(page);
          if (!results.length) break;
          if (!ll) ll = serpApiLl(page, results);

          const normalizedBatch: LeadRow[] = [];
          for (const raw of results) {
            const normalized = normalize(raw, { query: planQuery, location: interpretation!.location });
            const key = String(normalized.dedupe_key);
            if (seenKeys.has(key)) {
              dedupeRemoved++;
              continue;
            }
            seenKeys.add(key);
            normalizedBatch.push(normalized);
          }

          // normalize → dedupe → cheap pre-checks → enrich → ALL refinements
          const pending = normalizedBatch.filter((row) => matchesPreEnrichmentFilters(row, req));
          for (let i = 0; i < pending.length && collected.length < target; i += ENRICHMENT_WAVE) {
            if (Date.now() >= deadlineAt) {
              deadlineReached = true;
              break;
            }
            const wave = pending.slice(i, i + ENRICHMENT_WAVE);
            const processed = await Promise.all(
              wave.map((row) => enrichWebsiteRow(row, Math.min(deadlineAt, Date.now() + ENRICHMENT_ROW_BUDGET_MS)))
            );
            for (const row of processed) {
              if (collected.length >= target) break;
              if (!matchesFilters(row, req)) continue;
              collected.push(row);
            }
          }
          if (deadlineReached) break searchLoop;

          const pagination = page.serpapi_pagination && typeof page.serpapi_pagination === "object"
            ? page.serpapi_pagination as Record<string, unknown>
            : {};
          const noMorePages = batch > 0 && !pagination.next;
          if (results.length < PAGE_SIZE || noMorePages) break;
          if (!ll) break;
        }
      }
    } catch (e) {
      providerError = e instanceof HttpError
        ? e
        : new HttpError(502, "The business-data provider failed. Try again shortly.", "provider_failed");
    }

    if (providerError && collected.length === 0) throw providerError;
    if (deadlineReached && collected.length === 0) {
      throw new HttpError(
        504,
        "The search ran out of time before any business matched every selected refinement. Try removing a refinement, broadening the location, or requesting fewer leads — then run it again.",
        "search_timeout",
      );
    }

    /* 5 — rows are normalized, enriched, and filtered; prepare for persistence. */
    if (jobRow) await sb.from("lead_search_jobs").update({ status: "normalizing" }).eq("id", jobRow.id);
    const rows = collected.map((normalized) => ({
      ...normalized,
      workspace_id: workspaceId,
      search_id: searchRow.id,
      collector_id: user.id,
    }));

    /* 6 — insert with per-row conflict skip (case-insensitive dedupe via unique key) */
    if (jobRow) await sb.from("lead_search_jobs").update({ status: "saving", processed_count: rows.length }).eq("id", jobRow.id);
    const savedIds: string[] = [];
    if (rows.length) {
      const chunkSize = 50;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { data: inserted, error } = await sb
          .from("leads")
          .upsert(chunk, { onConflict: "workspace_id,dedupe_key", ignoreDuplicates: true })
          .select("id");
        if (error) throw new HttpError(500, "The leads were found but couldn't be saved. Try again.", "lead_save_failed");
        savedIds.push(...(inserted ?? []).map((r: { id: string }) => r.id));
        saved = savedIds.length;
      }
    }

    /* 7 — refund unused reserved leads */
    const unused = Math.max(0, reserved - saved);
    refundAttempted = unused > 0;
    if (unused > 0) await reserveLeads(sb, workspaceId, -unused);
    reserved = saved;

    /* 8 — finalize rows */
    const status = providerError || deadlineReached || saved < requestedCount ? "partial" : "completed";
    const reason = deadlineReached ? "deadline_reached" : providerError?.code ?? (saved < requestedCount ? "not_enough_new_matches" : null);
    const { error: finalizeError } = await sb
      .from("lead_searches")
      .update({ status, result_count: saved, completed_at: new Date().toISOString(), error: status === "completed" ? null : providerError?.message ?? reason })
      .eq("id", searchRow.id);
    if (finalizeError) throw new HttpError(500, "The search completed but its history couldn't be updated.", "search_finalize_failed");
    if (jobRow) {
      await sb
        .from("lead_search_jobs")
        .update({ status: "completed", processed_count: saved, completed_at: new Date().toISOString(), error: status === "completed" ? null : providerError?.message ?? reason })
        .eq("id", jobRow.id);
    }

    await logActivity(sb, {
      workspaceId,
      actorId: user.id,
      kind: "search",
      text: `Ran search “${query}” — ${saved} leads`,
      meta: { searchId: searchRow.id, saved, plan: entitlements.plan },
    });

    /* 9 — return exactly the fresh, validated leads saved by this run. */
    let fresh: Record<string, unknown>[] = [];
    if (savedIds.length) {
      const { data, error } = await sb
        .from("leads")
        .select("*, lead_notes(id, body, created_at), lead_list_members(list_id)")
        .in("id", savedIds)
        .order("created_at", { ascending: false });
      if (error) throw new HttpError(500, "The leads were saved but couldn't be loaded.", "lead_load_failed");
      fresh = (data ?? []) as Record<string, unknown>[];
      if (fresh.length !== savedIds.length || fresh.some((lead) => typeof lead.id !== "string" || typeof lead.name !== "string")) {
        throw new HttpError(500, "The leads were saved but couldn't be returned safely. Refresh your leads and try again.", "lead_response_invalid");
      }
    }

    const message = saved >= requestedCount
      ? `${saved} new lead${saved === 1 ? "" : "s"} collected`
      : saved > 0
        ? `Search partially completed — ${saved} new lead${saved === 1 ? "" : "s"} collected`
        : "Search completed — no new matching leads were available";
    const insights = [`Searched “${interpretation!.q}”.`, message];
    if (req.requireEmail && saved < requestedCount) {
      insights.push("Only businesses with a publicly listed email — from the provider or their own website — were included. Emails are never guessed.");
    }
    return json({
      searchId: searchRow.id,
      leads: fresh,
      stats: {
        requested: requestedCount,
        found: saved,
        savedCount: saved,
        remaining: Math.max(0, requestedCount - saved),
        status,
        reason,
        message,
        pagesSearched: pagesTried,
        interpretation,
        dedupeRemoved,
        insights,
      },
    });
  } catch (e) {
    if (accounting && reserved > saved && !refundAttempted) {
      try {
        await reserveLeads(accounting.sb, accounting.workspaceId, -(reserved - saved));
        reserved = saved;
      } catch (refundError) {
        console.error("edge request", {
          functionName: "search-run",
          status: 500,
          code: "usage_refund_failed",
          providerCategory: undefined,
          durationMs: Date.now() - startedAt,
        });
      }
    }
    if (accounting) {
      await accounting.sb
        .from("lead_searches")
        .update({ status: "failed", result_count: saved, completed_at: new Date().toISOString(), error: e instanceof Error ? e.message : "Search failed" })
        .eq("id", accounting.searchId);
    }
    return handleError(e, { functionName: "search-run", startedAt });
  }
});
