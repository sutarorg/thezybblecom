// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Usage must report the number the SERVER actually meters.
 *
 * reserve_leads() reserves from (and refunds to) `usage_counters.leads_used`,
 * and returns 429 once it reaches the plan allowance. The Usage page and the
 * sidebar used to count `leads` rows collected this month instead, so:
 *   • deleting leads lowered the displayed usage without returning quota —
 *     the UI promised remaining leads that the next search refused;
 *   • Overview (which already read the counter) and Usage showed two
 *     different "leads used this month" for the same workspace.
 *
 * The twelve-month chart also ordered ascending with a limit, which returns
 * the twelve OLDEST periods — the chart froze once a workspace was a year old.
 */

const h = vi.hoisted(() => {
  const from = vi.fn();
  const rpc = vi.fn();
  const client = { auth: { getSession: vi.fn() }, from, rpc, functions: { invoke: vi.fn() } };
  return { client, from };
});

vi.mock("./supabase", () => ({ getSupabase: () => h.client, BACKEND_ENABLED: true }));

import { getUsage } from "./api";

const WORKSPACE = "ws-1";

function periodStartIso() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Minimal PostgREST builder: resolves whatever the table stub was given. */
function builder(result: unknown) {
  const self: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lt", "in", "order", "limit"]) {
    self[method] = vi.fn(() => self);
  }
  // Awaiting the builder resolves the query.
  self.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return self;
}

type Tables = {
  leads?: unknown;
  lead_searches?: unknown;
  exports?: unknown;
  ai_requests?: unknown;
  lead_lists?: unknown;
  lead_list_members?: unknown;
  usage_counters?: unknown;
};

function stubTables(tables: Tables) {
  h.from.mockReset();
  h.from.mockImplementation((table: keyof Tables) =>
    builder(tables[table] ?? { data: [], count: 0, error: null }),
  );
}

beforeEach(() => {
  h.from.mockReset();
});

describe("getUsage", () => {
  it("reports the authoritative counter, not a live count of lead rows", async () => {
    stubTables({
      // 3 leads survive in the table, but 120 were metered this period.
      leads: { data: null, count: 3, error: null },
      lead_searches: { data: null, count: 7, error: null },
      exports: { data: null, count: 2, error: null },
      ai_requests: { data: null, count: 5, error: null },
      lead_lists: { data: [], error: null },
      usage_counters: { data: [{ period_start: periodStartIso(), leads_used: 120 }], error: null },
    });

    const usage = await getUsage(WORKSPACE, "growth");

    expect(usage.used).toBe(120);
    expect(usage.allowance).toBe(5000);
    expect(usage.remaining).toBe(4880);
    expect(usage.searches).toBe(7);
    expect(usage.exports).toBe(2);
    expect(usage.aiRuns).toBe(5);
  });

  it("falls back to the lead count only before the period counter exists", async () => {
    stubTables({
      leads: { data: null, count: 12, error: null },
      lead_lists: { data: [], error: null },
      usage_counters: { data: [], error: null },
    });

    const usage = await getUsage(WORKSPACE, "free");
    expect(usage.used).toBe(12);
    expect(usage.remaining).toBe(38);
  });

  it("never reports negative remaining quota", async () => {
    stubTables({
      leads: { data: null, count: 0, error: null },
      lead_lists: { data: [], error: null },
      usage_counters: { data: [{ period_start: periodStartIso(), leads_used: 60 }], error: null },
    });

    const usage = await getUsage(WORKSPACE, "free");
    expect(usage.used).toBe(60);
    expect(usage.remaining).toBe(0);
  });

  it("charts the most recent periods oldest-first", async () => {
    const current = periodStartIso();
    stubTables({
      leads: { data: null, count: 0, error: null },
      lead_lists: { data: [], error: null },
      // PostgREST returns descending; the chart must read left-to-right.
      usage_counters: {
        data: [
          { period_start: current, leads_used: 30 },
          { period_start: "2026-01-01", leads_used: 20 },
          { period_start: "2025-12-01", leads_used: 10 },
        ],
        error: null,
      },
    });

    const usage = await getUsage(WORKSPACE, "free");
    expect(usage.monthly.map((m) => m.value)).toEqual([10, 20, 30]);
  });
});
