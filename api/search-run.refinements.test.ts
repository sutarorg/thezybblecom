import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Regression tests for the /find refinements pipeline.
 *
 * Covers: all 8 refinements applied simultaneously (AND semantics), the
 * open-state normalization ("Open · Closes 9 PM" is OPEN), price-level and
 * business-size filtering, website/phone/email/open-now requirements,
 * enrichment-before-filtering for public emails, multi-page searching when
 * early pages don't satisfy the filters, provider + workspace dedupe, and
 * partial-result quota accounting.
 *
 * Fixture transports only — the product itself has no mock/demo data path.
 */

// The enrichment step resolves DNS before fetching (private-network guard).
// Point every lookup at a public address for these tests.
vi.mock("node:dns/promises", () => ({
  default: {
    lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
  },
}));

import handler from "./search-run";

const SUPABASE_URL = "https://stub.supabase.co";
const SUPABASE_KEY = "sb_publishable_stub_key";
const SERPAPI_KEY = "stub-serpapi-server-key";
const CALLER_TOKEN = "caller-access-token";
const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "11111111-2222-3333-4444-555555555555";

const SUPABASE_VARS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of SUPABASE_VARS) saved.set(name, process.env[name]);
  for (const name of SUPABASE_VARS) delete process.env[name];
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_PUBLISHABLE_KEY = SUPABASE_KEY;
  process.env.SERPAPI_API_KEY = SERPAPI_KEY;
});

afterEach(() => {
  for (const name of SUPABASE_VARS) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Fixture factories                                                   */
/* ------------------------------------------------------------------ */
let seq = 0;
function biz(overrides: Record<string, unknown>): Record<string, unknown> {
  seq++;
  const title = String(overrides.title ?? `Fixture Business ${seq}`);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    title,
    place_id: `fixture-place-${seq}`,
    type: "Coffee shop",
    types: ["Coffee shop"],
    rating: 4.6,
    reviews: 120,
    phone: `+1 512 555 0${String(1000 + seq).slice(1)}`,
    address: `${seq}00 Example Ave, Austin, TX 78701`,
    website: `https://${slug}.example.com`,
    gps_coordinates: { latitude: 30.27, longitude: -97.74 },
    open_state: "Open · Closes 9 PM",
    price: "$$",
    ...overrides,
  };
}

type SiteFixture = { email?: string; employees?: number };

function closedFillers(count: number, prefix = "Closed Filler") {
  return Array.from({ length: count }, (_, i) => biz({ title: `${prefix} ${i + 1}`, open_state: "Closed" }));
}

type RecordedCall = { url: string; method: string; headers: Record<string, string>; body?: string };

function recordHeaders(init: RequestInit): Record<string, string> {
  const raw = init.headers;
  if (raw instanceof Headers) {
    return Object.fromEntries([...raw.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  }
  return Object.fromEntries(
    Object.entries((raw as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
}

function installNetworkStub(options: {
  pages: Array<Array<Record<string, unknown>>>;
  websites?: Record<string, SiteFixture>;
  existingKeys?: string[];
}) {
  const websites = options.websites ?? {};
  const existingKeys = options.existingKeys ?? [];
  const calls: RecordedCall[] = [];
  const reserveDeltas: number[] = [];
  const serpapiStarts: number[] = [];
  const websiteHostsFetched: string[] = [];
  const upserts: Array<Array<Record<string, unknown>>> = [];
  let savedCounter = 0;
  const savedRows: Array<{ id: string; name: string; business_size: string }> = [];
  let searchCounter = 0;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = recordHeaders(init);
    const bodyText = typeof init.body === "string" ? init.body : undefined;
    calls.push({ url, method, headers, body: bodyText });

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    // ---- SerpApi: pages are addressed by the `start` offset ----
    if (url.startsWith("https://serpapi.com/search.json")) {
      const params = new URL(url).searchParams;
      const start = Number(params.get("start") ?? 0);
      serpapiStarts.push(start);
      const page = options.pages[start / 20] ?? [];
      const pageIndex = start / 20;
      return json({
        local_results: page,
        serpapi_pagination: { next: pageIndex + 1 < options.pages.length ? "https://serpapi.com/next" : "" },
      });
    }

    // ---- Business websites (public enrichment) ----
    if (url.startsWith("https://") && url.endsWith(".example.com/") === false && url.includes(".example.com")) {
      try {
        const parsed = new URL(url);
        const site = websites[parsed.hostname];
        websiteHostsFetched.push(parsed.hostname);
        if (!site) return new Response("Not found", { status: 404 });
        const bits: string[] = ["<html><body>"];
        if (["/contact", "/contact-us"].includes(parsed.pathname) && site.email) {
          bits.push(`<a href="mailto:${site.email}">${site.email}</a>`);
        }
        if (["/about", "/about-us"].includes(parsed.pathname) && site.employees) {
          bits.push(`<p>A team of ${site.employees} employees.</p>`);
        }
        bits.push("</body></html>");
        return new Response(bits.join(""), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }

    // ---- Supabase GoTrue ----
    if (url === `${SUPABASE_URL}/auth/v1/user` && method === "GET") {
      return json({ id: USER_ID, aud: "authenticated", email: "fixture@example.test" });
    }

    // ---- Supabase PostgREST ----
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/`)) {
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/reserve_leads`)) {
        const parsed = bodyText ? (JSON.parse(bodyText) as { delta: number }) : { delta: 0 };
        reserveDeltas.push(parsed.delta);
        return json(41);
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/workspace_members`)) return json([{ role: "owner" }]);
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/lead_searches`)) {
        if (method === "POST") return json({ id: `search-fixture-${++searchCounter}` });
        if (method === "PATCH") return new Response(null, { status: 204 });
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/leads`)) {
        if (method === "POST") {
          const rows = bodyText ? (JSON.parse(bodyText) as Array<Record<string, unknown>>) : [];
          upserts.push(rows);
          const inserted = rows.map(() => {
            savedCounter += 1;
            return { id: `lead-fixture-${savedCounter}` };
          });
          for (const row of rows) {
            savedRows.push({
              id: `lead-fixture-${savedCounter - (rows.length - rows.indexOf(row) - 1)}`,
              name: String(row.name ?? "Fixture business"),
              business_size: String(row.business_size ?? "unknown"),
            });
          }
          return json(inserted);
        }
        if (url.includes("select=dedupe_key")) return json(existingKeys.map((k) => ({ dedupe_key: k })));
        return json(savedRows);
      }
    }

    throw new Error(`Unexpected request in fixture transport: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, reserveDeltas, serpapiStarts, websiteHostsFetched, upserts };
}

function createMockReqRes(filters: Record<string, unknown>) {
  const req = {
    method: "POST",
    headers: { authorization: `Bearer ${CALLER_TOKEN}`, "content-type": "application/json" },
    body: { workspaceId: WORKSPACE_ID, filters },
  } as unknown as IncomingMessage & { body?: unknown };

  let statusCode = 0;
  let responseBody: unknown = null;
  const res = {
    setHeader() {
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      responseBody = body;
    },
  } as unknown as ServerResponse & { status(code: number): any; json(body: unknown): void };

  return { req, res, getStatus: () => statusCode, getBody: () => responseBody };
}

const ALL_EIGHT_FILTERS = {
  category: "coffee shops",
  location: "Austin, TX",
  quantity: 3,
  minRating: "4",
  priceLevel: "2",
  businessSize: "small",
  sort: "relevance",
  requireWebsite: true,
  requirePhone: true,
  requireEmail: true,
  openNow: true,
};

describe("/api/search-run with every refinement selected", () => {
  it("applies all 8 refinements as AND conditions and keeps searching provider pages", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const matchA = biz({ title: "All Eight Match A" });
    const matchB = biz({ title: "All Eight Match B" });
    const matchC = biz({ title: "All Eight Match C", email: "owner@all-eight-match-c.example.com" });
    const duplicateOfA = { ...matchA, rating: 4.9 }; // same place_id — must dedupe

    const pageOne = [
      matchA,
      // Each of these fails exactly one refinement:
      biz({ title: "Closed Corner Cafe", open_state: "Closed · Opens 8 AM" }),
      biz({ title: "Low Rating Roasters", rating: 3.2 }),
      biz({ title: "No Website Diner", website: null }),
      biz({ title: "No Phone Bakery", phone: null }),
      biz({ title: "Pricey Espresso Bar", price: "$$$$" }),
      biz({ title: "Enterprise Coffee Group", employee_count: 500 }),
      biz({ title: "Website Without Email" }),
      ...closedFillers(12, "Page One Filler"),
    ];
    expect(pageOne).toHaveLength(20);

    const pageTwo = [
      matchB,
      matchC,
      duplicateOfA,
      ...closedFillers(17, "Page Two Filler"),
    ];
    expect(pageTwo).toHaveLength(20);

    const { reserveDeltas, serpapiStarts, upserts } = installNetworkStub({
      pages: [pageOne, pageTwo],
      websites: {
        "all-eight-match-a.example.com": { email: "team@all-eight-match-a.example.com", employees: 15 },
        "all-eight-match-b.example.com": { email: "hello@all-eight-match-b.example.com", employees: 12 },
        "all-eight-match-c.example.com": { employees: 8 },
        "website-without-email.example.com": {},
        "enterprise-coffee-group.example.com": { email: "jobs@enterprise-coffee-group.example.com" },
        "closed-corner-cafe.example.com": { email: "hi@closed-corner-cafe.example.com" },
        "low-rating-roasters.example.com": { email: "hi@low-rating-roasters.example.com" },
        "no-phone-bakery.example.com": { email: "hi@no-phone-bakery.example.com" },
        "pricey-espresso-bar.example.com": { email: "hi@pricey-espresso-bar.example.com" },
      },
    });

    const { req, res, getStatus, getBody } = createMockReqRes(ALL_EIGHT_FILTERS);
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as {
      leads: Array<{ id: string; name: string }>;
      stats: { savedCount: number; status: string; pagesSearched: number };
    };

    // Exactly the three fully-matching businesses were saved…
    expect(body.stats.savedCount).toBe(3);
    expect(body.leads).toHaveLength(3);
    const savedNames = upserts.flat().map((row) => String(row.name));
    expect(savedNames).toEqual(["All Eight Match A", "All Eight Match B", "All Eight Match C"]);

    // …and the duplicated place_id was not saved twice.
    expect(savedNames.filter((name) => name === "All Eight Match A")).toHaveLength(1);

    // Every saved row satisfies every refinement.
    for (const row of upserts.flat()) {
      expect(row.website, "website required").toBeTruthy();
      expect(row.phone, "phone required").toBeTruthy();
      expect(Array.isArray(row.emails) && row.emails.length > 0, "public email required").toBe(true);
      expect(row.open_state, "open now required").toBe("open");
      expect(Number(row.rating), "min rating 4").toBeGreaterThanOrEqual(4);
      expect(Number(row.price_level), "price level 2").toBe(2);
      expect(row.business_size, "small business required").toBe("small");
    }

    // The first page didn't satisfy the filters, so the search continued to
    // the next provider page (start=20) instead of returning zero results.
    expect(serpapiStarts).toEqual([0, 20]);
    expect(body.stats.pagesSearched).toBe(2);
    expect(body.stats.status).toBe("completed");

    // Quota: 3 reserved, nothing to refund.
    expect(reserveDeltas).toEqual([3]);
  });

  it("returns a valid partial result with a refund when the provider runs dry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const alreadySaved = biz({ title: "Already Saved Cafe" });
    const pageOne = [
      biz({ title: "Partial Match A" }),
      biz({ title: "Partial Match B" }),
      alreadySaved, // fully matching but already in the workspace → skipped
      ...closedFillers(17, "Partial Filler"),
    ];
    expect(pageOne).toHaveLength(20);

    const { reserveDeltas, upserts } = installNetworkStub({
      pages: [pageOne, []],
      websites: {
        "partial-match-a.example.com": { email: "hi@partial-match-a.example.com", employees: 10 },
        "partial-match-b.example.com": { email: "hi@partial-match-b.example.com", employees: 10 },
        "already-saved-cafe.example.com": { email: "hi@already-saved-cafe.example.com", employees: 10 },
      },
      existingKeys: [`place:${alreadySaved.place_id}`],
    });

    const { req, res, getStatus, getBody } = createMockReqRes({ ...ALL_EIGHT_FILTERS, quantity: 5 });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as {
      leads: Array<{ id: string }>;
      stats: { savedCount: number; status: string; remaining: number; message: string; reason: string | null };
    };
    expect(body.stats.savedCount).toBe(2);
    expect(body.leads).toHaveLength(2);
    expect(body.stats.status).toBe("partial");
    expect(body.stats.remaining).toBe(3);
    expect(body.stats.message).toContain("partially completed");

    const savedNames = upserts.flat().map((row) => String(row.name));
    expect(savedNames).toEqual(["Partial Match A", "Partial Match B"]);

    // 5 reserved up front; the 3 unsaved slots are refunded.
    expect(reserveDeltas[0]).toBe(5);
    expect(reserveDeltas).toContain(-3);
  });
});

describe("/api/search-run individual refinements", () => {
  it("treats “Open · Closes 9 PM” as open and “Closed · Opens 8 AM” as closed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page = [
      biz({ title: "Open Late Cafe", open_state: "Open · Closes 9 PM" }),
      biz({ title: "Open All Day", open_state: "Currently open" }),
      biz({ title: "Closed Early Cafe", open_state: "Closed · Opens 8 AM" }),
      biz({ title: "Temporarily Shut", open_state: "Temporarily closed" }),
      ...closedFillers(16, "Open Filler"),
    ];
    expect(page).toHaveLength(20);

    const { upserts } = installNetworkStub({ pages: [page] });
    const { req, res, getStatus, getBody } = createMockReqRes({ category: "coffee shops", quantity: 10, openNow: true });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const names = upserts.flat().map((row) => String(row.name));
    expect(names).toEqual(["Open Late Cafe", "Open All Day"]);
    const body = getBody() as { stats: { savedCount: number } };
    expect(body.stats.savedCount).toBe(2);
  });

  it("filters by price level while keeping unknown prices eligible", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page = [
      biz({ title: "Moderate Cafe", price: "$$" }),
      biz({ title: "Unknown Price Cafe", price: null }),
      biz({ title: "Pricey Cafe", price: "$$$$" }),
      ...Array.from({ length: 17 }, (_, i) => biz({ title: `Cheap Filler ${i + 1}`, price: "$" })),
    ];
    expect(page).toHaveLength(20);

    const { upserts } = installNetworkStub({ pages: [page] });
    const { req, res, getStatus } = createMockReqRes({ category: "coffee shops", quantity: 10, priceLevel: "2" });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(upserts.flat().map((row) => String(row.name))).toEqual(["Moderate Cafe", "Unknown Price Cafe"]);
  });

  it("filters by business size from the provider or the business website", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page = [
      biz({ title: "Provider Small", employee_count: 12 }),
      biz({ title: "Website Small" }), // size only discoverable on the website
      biz({ title: "Provider Enterprise", employee_count: 300 }),
      biz({ title: "No Size Website" }), // website publishes no count
      biz({ title: "No Website No Size", website: null }),
      ...closedFillers(15, "Size Filler"),
    ];
    expect(page).toHaveLength(20);

    const { upserts } = installNetworkStub({
      pages: [page],
      websites: {
        "provider-small.example.com": {},
        "website-small.example.com": { employees: 15 },
        "provider-enterprise.example.com": {},
        "no-size-website.example.com": {},
      },
    });
    const { req, res, getStatus } = createMockReqRes({ category: "coffee shops", quantity: 10, businessSize: "small" });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const rows = upserts.flat();
    expect(rows.map((row) => String(row.name))).toEqual(["Provider Small", "Website Small"]);
    expect(rows.map((row) => row.business_size)).toEqual(["small", "small"]);
  });

  it("requires a website and a phone number when selected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page = [
      biz({ title: "Complete Cafe", phone: "+1 512 555 0199", website: "https://complete-cafe.example.com" }),
      biz({ title: "Phoneless Cafe", phone: null }),
      biz({ title: "Siteless Cafe", website: null }),
      ...Array.from({ length: 17 }, (_, i) =>
        i % 2 === 0 ? biz({ title: `Contact Filler ${i + 1}`, phone: null }) : biz({ title: `Contact Filler ${i + 1}`, website: null })
      ),
    ];
    expect(page).toHaveLength(20);

    const { upserts } = installNetworkStub({ pages: [page] });
    const { req, res, getStatus } = createMockReqRes({
      category: "coffee shops",
      quantity: 10,
      requireWebsite: true,
      requirePhone: true,
    });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(upserts.flat().map((row) => String(row.name))).toEqual(["Complete Cafe"]);
  });

  it("discovers public emails via enrichment instead of rejecting early, and never invents one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page = [
      // Provider email is used directly.
      biz({ title: "Provider Email Cafe", email: "owner@provider-email-cafe.example.com" }),
      // No provider email — the website's contact page publishes one.
      biz({ title: "Website Email Cafe" }),
      // Website exists but publishes no email → excluded.
      biz({ title: "Website No Email" }),
      // No website and no provider email → can never match.
      biz({ title: "No Website No Email", website: null }),
      ...Array.from({ length: 16 }, (_, i) => biz({ title: `Emailless Filler ${i + 1}`, website: null })),
    ];
    expect(page).toHaveLength(20);

    const { upserts, websiteHostsFetched } = installNetworkStub({
      pages: [page],
      websites: {
        "provider-email-cafe.example.com": {},
        "website-email-cafe.example.com": { email: "contact@website-email-cafe.example.com" },
        "website-no-email.example.com": {},
      },
    });
    const { req, res, getStatus } = createMockReqRes({ category: "coffee shops", quantity: 10, requireEmail: true });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const rows = upserts.flat();
    expect(rows.map((row) => String(row.name))).toEqual(["Provider Email Cafe", "Website Email Cafe"]);

    // The email-less website was still visited (enrichment ran before the
    // email refinement rejected the row)…
    expect(websiteHostsFetched).toContain("website-email-cafe.example.com");
    expect(websiteHostsFetched).toContain("website-no-email.example.com");
    // …and every persisted email is a real discovered address.
    const emails = rows.flatMap((row) => (Array.isArray(row.emails) ? row.emails.map(String) : []));
    expect(emails).toEqual(["owner@provider-email-cafe.example.com", "contact@website-email-cafe.example.com"]);
    expect(rows.every((row) => typeof row.email === "string" && row.email.includes("@"))).toBe(true);
  });

  it("does not visit websites when no email/size refinement needs it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page = [
      biz({ title: "Plain Cafe" }),
      biz({ title: "Other Plain Cafe" }),
      ...closedFillers(18, "Plain Filler"),
    ];
    const { websiteHostsFetched } = installNetworkStub({ pages: [page] });
    const { req, res, getStatus } = createMockReqRes({ category: "coffee shops", quantity: 5 });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(websiteHostsFetched).toEqual([]);
  });
});
