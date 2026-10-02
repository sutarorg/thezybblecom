// ============================================================================
// search-run — the Zybble lead engine.
// Auth → workspace auth → entitlement → usage reservation → Gemini interpret
// → SerpApi paginated fetch → normalize → dedupe → persist → account usage.
// ============================================================================
import {
  HttpError,
  INTERPRET_SYSTEM,
  callerFromRequest,
  corsHeaders,
  errorJson,
  geminiJson,
  getEntitlements,
  handleError,
  json,
  logActivity,
  requireWorkspaceRole,
  reserveLeads,
  serpApiMaps,
  serpApiResults,
  serpApiLl,
  serviceClient,
  GEMINI_MODEL,
} from "../_shared/index.ts";

const MAX_PER_RUN = 240; // v1 cap per search (12 pages × 20)
const MAX_BATCHES = 12;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LocalResult = Record<string, any>;

/* ------------------------------------------------------------------ */
/* Fallback interpretation when Gemini is unavailable                   */
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

function normalize(t: LocalResult, meta: { query: string; location: string | null }): Record<string, unknown> {
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
    price_level: typeof t.price_level === "number" ? t.price_level : null,
    business_size: typeof t.employee_count === "number" ? (t.employee_count >= 250 ? "enterprise" : t.employee_count >= 50 ? "medium" : "small") : "unknown",
    employee_count: typeof t.employee_count === "number" ? t.employee_count : null,
    business_size_source: typeof t.employee_count === "number" ? "provider" : "unknown",
    business_size_confidence: typeof t.employee_count === "number" ? 0.95 : 0,
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
    open_state: t.open_state ? (String(t.open_state).toLowerCase().includes("open") && !String(t.open_state).toLowerCase().includes("close") ? "open" : "closed") : "unknown",
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractEmail(t: any): string | null {
  // SerpApi rarely returns an email; never fabricate one.
  const candidate = t.email ?? t.emails?.[0] ?? t.contact?.email ?? null;
  if (typeof candidate === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return candidate;
  return null;
}

/* ------------------------------------------------------------------ */
/* Main handler                                                        */
/* ------------------------------------------------------------------ */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  try {
    const sb = serviceClient();
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
    } else {
      query = String(body.query ?? "").trim();
      if (!query || query.length < 2) throw new HttpError(400, "Describe the businesses you need.");
      if (query.length > 400) throw new HttpError(400, "Keep the request under 400 characters.");
      try {
        const planned = await geminiJson({
          system: INTERPRET_SYSTEM,
          prompt: `User request: ${query}`,
          schema: {
            type: "object",
            properties: {
              q: { type: "string" },
              category: { type: "string" },
              location: { type: "string" },
              requested_count: { type: "integer" },
              filters: {
                type: "object",
                properties: {
                  require_website: { type: "boolean" },
                  min_rating: { type: "number" },
                },
              },
            },
            required: ["q", "requested_count"],
          },
        });
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
        console.warn("Gemini interpret failed — using fallback:", e);
        interpretation = fallbackInterpret(query);
      }
      await sb.from("ai_requests").insert({
        workspace_id: workspaceId,
        user_id: user.id,
        kind: "interpret",
        input: { query, plan: interpretation },
        status: "completed",
        model: GEMINI_MODEL,
      });
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
    if (searchErr) throw new HttpError(500, "Couldn't start the search.");

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
    let reserved = requestedCount;
    try {
      await reserveLeads(sb, workspaceId, reserved);
    } catch (e) {
      await sb.from("lead_searches").update({ status: "failed", error: "quota" }).eq("id", searchRow.id);
      throw e;
    }

    /* 4 — SerpApi pagination: controlled batches */
    const collected: LocalResult[] = [];
    const seenKeys = new Set<string>();
    let dedupeRemoved = 0;
    let batches = 0;
    let providerError: string | null = null;
    const target = requestedCount;
    let ll: string | null = null;

    try {
      while (collected.length < target && batches < MAX_BATCHES && !providerError) {
        const start = batches * 20;
        let page;
        try {
          page = await serpApiMaps({ q: interpretation!.q, ll, start });
        } catch (e) {
          providerError = e instanceof HttpError ? e.message : "Provider unavailable";
          break;
        }
        const results: LocalResult[] = serpApiResults(page);
        if (!results.length) break;
        // SerpApi needs `ll` for page 2 onwards; anchor it on page 1's results.
        if (!ll) ll = serpApiLl(page, results);

        for (const raw of results) {
          const normalized = normalize(raw, { query: interpretation!.q, location: interpretation!.location });

          /* apply the user's explicit requirements */
          const req = interpretation as unknown as Record<string, unknown>;
          if (interpretation.filters?.require_website && !normalized.website) continue;
          if (req.require_phone && !normalized.phone) continue;
          if (req.require_email && !normalized.email) continue;
          if (req.open_now && normalized.open_state !== "open") continue;
          const minR = interpretation.filters?.min_rating;
          if (minR != null && Number(normalized.rating ?? 0) < minR) continue;
          if (req.price_level != null && normalized.price_level != null && normalized.price_level !== req.price_level) {
            continue;
          }
          if (req.business_size && normalized.business_size !== req.business_size) continue;

          const key = String(normalized.dedupe_key);
          if (seenKeys.has(key)) {
            dedupeRemoved++;
            continue;
          }
          seenKeys.add(key);
          collected.push(raw);
          if (collected.length >= target) break;
        }
        batches++;
        const hasNext = Boolean(page?.serpapi_pagination?.next);
        if (results.length < 20 || !ll) break;
        if (batches > 1 && !hasNext) break;
      }
    } catch (e) {
      providerError = e instanceof Error ? e.message : "Provider error";
    }

    /* 5 — normalize again into row shape + DB-level dedupe via upsert */
    await sb.from("lead_search_jobs").update({ status: "normalizing" }).eq("id", jobRow!.id);
    const rows = collected.map((raw) => ({
      ...normalize(raw, { query: interpretation!.q, location: interpretation!.location }),
      workspace_id: workspaceId,
      search_id: searchRow.id,
      collector_id: user.id,
    }));

    /* 6 — insert with per-row conflict skip (case-insensitive dedupe via unique key) */
    await sb.from("lead_search_jobs").update({ status: "saving", processed_count: rows.length }).eq("id", jobRow!.id);
    let saved = 0;
    const savedIds: string[] = [];
    if (rows.length) {
      const chunkSize = 50;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { data: inserted, error } = await sb
          .from("leads")
          .upsert(chunk, { onConflict: "workspace_id,dedupe_key", ignoreDuplicates: true })
          .select("id");
        if (!error && inserted) {
          saved += inserted.length;
          savedIds.push(...inserted.map((r: { id: string }) => r.id));
        }
      }
    }

    /* 7 — refund unused reserved leads */
    const unused = Math.max(0, reserved - saved);
    if (unused > 0) {
      try {
        await reserveLeads(sb, workspaceId, -unused);
      } catch { /* refund best-effort */ }
    }

    /* 8 — finalize rows */
    const status = providerError && saved === 0 ? "failed" : providerError ? "partial" : saved < requestedCount ? "partial" : "completed";
    await sb
      .from("lead_searches")
      .update({ status, result_count: saved, completed_at: new Date().toISOString(), error: providerError })
      .eq("id", searchRow.id);
    await sb
      .from("lead_search_jobs")
      .update({ status: status === "failed" ? "failed" : "completed", processed_count: saved, completed_at: new Date().toISOString(), error: providerError })
      .eq("id", jobRow!.id);

    await logActivity(sb, {
      workspaceId,
      actorId: user.id,
      kind: "search",
      text: `Ran search “${query}” — ${saved} leads`,
      meta: { searchId: searchRow.id, saved, plan: entitlements.plan },
    });

    if (providerError && saved === 0) {
      return errorJson("The business-data provider failed before any leads could be collected. Please try again.", 502);
    }

    /* 9 — return the fresh page of leads */
    const { data: fresh } = await sb
      .from("leads")
      .select("*, lead_notes(id, body, created_at), lead_list_members(list_id)")
      .eq("search_id", searchRow.id)
      .order("created_at", { ascending: false })
      .limit(60);

    return json({
      searchId: searchRow.id,
      leads: fresh ?? [],
      stats: {
        requested: requestedCount,
        found: saved,
        savedCount: saved,
        remaining: Math.max(0, requestedCount - saved),
        interpretation,
        insights: [
          `Searched “${interpretation!.q}”.`,
          saved >= requestedCount
            ? `${saved} new lead${saved === 1 ? "" : "s"} collected.`
            : `Search partially completed — ${saved} new lead${saved === 1 ? "" : "s"} collected.`,
        ],
      },
    });
  } catch (e) {
    return handleError(e);
  }
});
