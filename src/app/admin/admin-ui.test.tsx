// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Render-level coverage for the admin console.
 *
 * Three properties matter enough to pin down in a test:
 *
 *  • the console shows NOTHING until the server has answered /api/admin/me,
 *    and shows a plain refusal when the answer is 403 — the gate is not a
 *    client-side boolean;
 *  • an empty production database renders honest empty states, never seeded
 *    numbers or placeholder charts;
 *  • the pages mount without React warnings or errors in the console.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("../services/supabase", () => ({
  getSupabase: () => ({ auth: { getSession: h.getSession } }),
  BACKEND_ENABLED: true,
}));

import { AdminRoutes } from "./index";
import { ToastProvider } from "../components/ui";

const EMPTY_OVERVIEW = {
  range: { from: "2026-09-04T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z", days: 30 },
  metrics: {
    users: { total: 0, new: 0, admins: 1, active: 0, by_plan: {} },
    billing: {
      active_paid_subscriptions: 0,
      committed_mrr_minor: 0,
      currency: "INR",
      by_status: {},
      collected_minor: 0,
      payments: 0,
      failed_payments: 0,
      refunded: 0,
      refunded_minor: 0,
      cancellations: 0,
      pending_cancellations: 0,
      upcoming_renewals: 0,
      paying_customers: 0,
    },
    product: {},
    operations: {},
  },
  series: [],
  plans: [],
};

let fetchMock: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;

function respond(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

async function render(path: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/admin/*" element={<AdminRoutes />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
  });
  // let the gate's fetch resolve, then the page's own fetch
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

beforeEach(() => {
  h.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "jwt" } } });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin access gate", () => {
  it("sends the Supabase access token to the same-origin admin API", async () => {
    fetchMock.mockImplementation(() => respond({ error: "forbidden", code: "forbidden" }, 403));
    await render("/admin");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/me");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
  });

  it("refuses the console when the server says the account isn't an admin", async () => {
    fetchMock.mockImplementation(() => respond({ error: "forbidden", code: "forbidden" }, 403));
    const view = await render("/admin");
    expect(view.textContent).toContain("Admin access required");
    expect(view.textContent).not.toContain("Committed MRR");
  });

  it("does not render the console shell while the check is in flight", async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    const view = await render("/admin");
    expect(view.textContent).toContain("Checking your admin access");
    expect(view.querySelector("nav")).toBeNull();
  });
});

describe("admin dashboard on an empty database", () => {
  beforeEach(() => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/me")) {
        return respond({ id: "a1", email: "ops@zybble.com", name: "Ops", role: "admin", serverTime: "2026-10-04T00:00:00Z" });
      }
      if (url.startsWith("/api/admin/overview")) return respond(EMPTY_OVERVIEW);
      return respond({ page: 1, pageSize: 25, total: 0, rows: [] });
    });
  });

  it("renders the console with every navigation group", async () => {
    const view = await render("/admin");
    for (const group of ["Overview", "Customers", "Revenue", "Product", "Operations", "Administration"]) {
      expect(view.textContent).toContain(group);
    }
  });

  it("shows real zeros and labelled revenue measures, not seeded data", async () => {
    const view = await render("/admin");
    expect(view.textContent).toContain("Committed MRR");
    expect(view.textContent).toContain("Collected in range");
    expect(view.textContent).toContain("Plan price × active and trialing subscriptions");
    expect(view.textContent).toContain("No revenue recorded in this range.");
    expect(view.textContent).not.toMatch(/Acme|Lorem|Example Corp|demo/i);
  });

  it("mounts without React errors", async () => {
    await render("/admin");
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("admin users page on an empty database", () => {
  it("shows a genuine empty state rather than placeholder rows", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/me")) {
        return respond({ id: "a1", email: "ops@zybble.com", name: "Ops", role: "admin", serverTime: "2026-10-04T00:00:00Z" });
      }
      return respond({ page: 1, pageSize: 25, total: 0, rows: [] });
    });
    const view = await render("/admin/users");
    expect(view.textContent).toContain("No customers yet");
    expect(view.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
