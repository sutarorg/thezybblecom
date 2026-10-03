import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler from "../search-run";

/**
 * Full-flow integration test for POST /api/search-run.
 *
 * The network boundary (Supabase PostgREST/GoTrue + SerpApi) is stubbed with
 * fixtures; everything else is the real handler: bearer-token auth, workspace
 * authorization, quota reservation/refund accounting, SerpApi pagination
 * rules, provider normalization, dedupe, persistence, history updates, and
 * the structured JSON response consumed by src/app/services/api.ts.
 *
 * These are test fixtures only — the product itself has no mock/demo data path.
 */

const SUPABASE_URL = "https://stub.supabase.co";
const SUPABASE_KEY = "sb_publishable_stub_key";
const SERPAPI_KEY = "stub-serpapi-server-key";
const CALLER_TOKEN = "caller-access-token";

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

const PROVIDER_BUSINESSES = [
  {
    title: "Fictional Coffee Roasters",
    place_id: "fixture-place-1",
    type: "Coffee shop",
    types: ["Coffee shop", "Cafe"],
    rating: 4.7,
    reviews: 312,
    phone: "+1 512 555 0101",
    address: "100 Example Ave, Austin, TX 78701",
    website: "https://fixture-one.example.com",
    gps_coordinates: { latitude: 30.2711, longitude: -97.7437 },
  },
  {
    title: "Example Cafe & Bakery",
    place_id: "fixture-place-2",
    type: "Cafe",
    types: ["Cafe", "Bakery"],
    rating: 4.4,
    reviews: 189,
    phone: "+1 512 555 0102",
    address: "200 Sample St, Austin, TX 78704",
    website: "https://fixture-two.example.com",
    gps_coordinates: { latitude: 30.25, longitude: -97.75 },
  },
  {
    title: "Stubbed Espresso Bar",
    place_id: "fixture-place-3",
    type: "Coffee shop",
    types: ["Coffee shop"],
    rating: 4.9,
    reviews: 64,
    phone: "+1 512 555 0103",
    address: "300 Demo Blvd, Austin, TX 78702",
    website: "https://fixture-three.example.com",
    gps_coordinates: { latitude: 30.26, longitude: -97.72 },
  },
];

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
  userId?: string;
  searchId?: string;
  savedLeadIds?: string[];
}) {
  const userId = options.userId ?? "11111111-2222-3333-4444-555555555555";
  const searchId = options.searchId ?? "search-fixture-123";
  const savedLeadIds = options.savedLeadIds ?? ["lead-fixture-1", "lead-fixture-2", "lead-fixture-3"];
  const calls: RecordedCall[] = [];
  const reserveDeltas: number[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = recordHeaders(init);
    const bodyText = typeof init.body === "string" ? init.body : undefined;
    calls.push({ url, method, headers, body: bodyText });

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    // ---- SerpApi (server-side provider; key never reaches the browser) ----
    if (url.startsWith("https://serpapi.com/search.json")) {
      expect(url).toContain("engine=google_maps");
      expect(url).toContain(`api_key=${SERPAPI_KEY}`);
      return json({
        local_results: PROVIDER_BUSINESSES,
        serpapi_pagination: { next: "" },
      });
    }

    // ---- Supabase GoTrue: GET /auth/v1/user ----
    if (url === `${SUPABASE_URL}/auth/v1/user` && method === "GET") {
      return json({ id: userId, aud: "authenticated", email: "fixture@example.test" });
    }

    // ---- Supabase PostgREST ----
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/`)) {
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/reserve_leads`)) {
        const parsed = bodyText ? (JSON.parse(bodyText) as { delta: number }) : { delta: 0 };
        reserveDeltas.push(parsed.delta);
        return json(41); // remaining allowance after the operation
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/workspace_members`)) {
        return json([{ role: "owner" }]); // maybeSingle unwraps the single row
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/lead_searches`)) {
        if (method === "POST") return json({ id: searchId }); // insert … .select("id").single()
        if (method === "PATCH") return new Response(null, { status: 204 }); // status update
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/leads`)) {
        if (method === "POST") {
          // upsert … .select("id") → PostgREST returns the inserted rows
          return json(savedLeadIds.map((id) => ({ id })));
        }
        if (url.includes("select=dedupe_key")) return json([]); // no existing duplicates
        // final response select: full lead rows for the browser
        return json(
          savedLeadIds.map((id, index) => ({
            id,
            name: PROVIDER_BUSINESSES[index]?.title ?? `Fixture business ${index + 1}`,
            business_size: "unknown",
          })),
        );
      }
    }

    throw new Error(`Unexpected request in fixture transport: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, reserveDeltas };
}

function createMockReqRes() {
  const req = {
    method: "POST",
    headers: { authorization: `Bearer ${CALLER_TOKEN}`, "content-type": "application/json" },
    body: {
      workspaceId: "11111111-1111-1111-1111-111111111111",
      filters: { category: "coffee shops", location: "Austin, TX", quantity: 5 },
    },
  } as unknown as IncomingMessage & { body?: unknown };

  let statusCode = 0;
  let responseBody: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as ServerResponse & { status(code: number): any; json(body: unknown): void };

  return { req, res, getStatus: () => statusCode, getBody: () => responseBody };
}

describe("POST /api/search-run full flow", () => {
  it("runs an authenticated search end-to-end and returns structured leads", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { calls, reserveDeltas } = installNetworkStub({});
    const { req, res, getStatus, getBody } = createMockReqRes();

    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as {
      searchId: string;
      leads: Array<{ id: string; name: string }>;
      stats: { requested: number; savedCount: number; status: string; message: string; insights: string[] };
    };
    expect(body.searchId).toBe("search-fixture-123");
    expect(body.leads).toHaveLength(3);
    for (const lead of body.leads) {
      expect(typeof lead.id).toBe("string");
      expect(typeof lead.name).toBe("string");
      expect(lead.name.length).toBeGreaterThan(0);
    }
    expect(body.stats.requested).toBe(5);
    expect(body.stats.savedCount).toBe(3);
    expect(body.stats.status).toBe("partial");
    expect(body.stats.message).toContain("3 new lead");

    // Quota accounting: reserve 5 up front, refund the 2 unsaved slots.
    expect(reserveDeltas[0]).toBe(5);
    expect(reserveDeltas).toEqual([5, -2]);

    // Every Supabase request runs as the caller so RLS stays enforced.
    const supabaseCalls = calls.filter((call) => call.url.startsWith(SUPABASE_URL));
    expect(supabaseCalls.length).toBeGreaterThan(0);
    for (const call of supabaseCalls) {
      expect(call.headers.authorization).toBe(`Bearer ${CALLER_TOKEN}`);
    }

    // The provider search used the server-side SerpApi key…
    const serpapiCalls = calls.filter((call) => call.url.startsWith("https://serpapi.com"));
    expect(serpapiCalls.length).toBeGreaterThan(0);
    // …and that key never reaches the JSON response sent to the browser.
    expect(JSON.stringify(body)).not.toContain(SERPAPI_KEY);
    expect(JSON.stringify(body)).not.toContain("sb_publishable_stub_key");
  });

  it("finalizes the search history with the partial status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { calls } = installNetworkStub({});
    const { req, res, getStatus } = createMockReqRes();
    await handler(req, res);
    expect(getStatus()).toBe(200);

    const patch = calls.find((call) => call.method === "PATCH" && call.url.includes("/rest/v1/lead_searches"));
    expect(patch).toBeDefined();
    const patchBody = JSON.parse(patch!.body ?? "{}") as { status: string; result_count: number; error: string | null };
    expect(patchBody.status).toBe("partial");
    expect(patchBody.result_count).toBe(3);
  });

  it("refuses a caller who is not a member of the workspace", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { calls } = installNetworkStub({});

    // Workspace membership lookup returns no rows → maybeSingle yields null.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        const method = (init.method ?? "GET").toUpperCase();
        const headers = recordHeaders(init);
        calls.push({ url, method, headers, body: typeof init.body === "string" ? init.body : undefined });
        const json = (payload: unknown, status = 200) =>
          new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
        if (url === `${SUPABASE_URL}/auth/v1/user`) {
          return json({ id: "11111111-2222-3333-4444-555555555555", aud: "authenticated" });
        }
        if (url.startsWith(`${SUPABASE_URL}/rest/v1/workspace_members`)) return json([]);
        if (url.startsWith(`${SUPABASE_URL}/rest/v1/lead_searches`) && method === "POST") {
          return json({ id: "search-fixture-123" });
        }
        throw new Error(`Unexpected request in fixture transport: ${method} ${url}`);
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes();
    await handler(req, res);
    expect(getStatus()).toBe(403);
    expect(getBody()).toMatchObject({ code: "workspace_forbidden" });
  });

  it("reports quota exhaustion from the reserve_leads RPC", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { calls } = installNetworkStub({});

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        const method = (init.method ?? "GET").toUpperCase();
        const headers = recordHeaders(init);
        calls.push({ url, method, headers, body: typeof init.body === "string" ? init.body : undefined });
        const json = (payload: unknown, status = 200) =>
          new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
        if (url === `${SUPABASE_URL}/auth/v1/user`) {
          return json({ id: "11111111-2222-3333-4444-555555555555", aud: "authenticated" });
        }
        if (url.startsWith(`${SUPABASE_URL}/rest/v1/workspace_members`)) return json([{ role: "owner" }]);
        if (url.startsWith(`${SUPABASE_URL}/rest/v1/lead_searches`) && method === "POST") {
          return json({ id: "search-fixture-123" });
        }
        if (url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/reserve_leads`)) return json(-2); // quota exhausted
        throw new Error(`Unexpected request in fixture transport: ${method} ${url}`);
      }),
    );

    const { req, res, getStatus, getBody } = createMockReqRes();
    await handler(req, res);
    expect(getStatus()).toBe(429);
    expect(getBody()).toMatchObject({ code: "quota_exceeded" });
  });
});
