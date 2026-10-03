// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RecentLeadsCard } from "./components/RecentLeads";
import { LeadAvatar } from "./components/LeadsTable";
import type { Lead } from "./data/types";
import { applyLightAppearance, getRuntimePreferences, setRuntimePreferences } from "./lib/datetime";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container.remove();
  vi.restoreAllMocks();
});

async function render(element: React.ReactElement) {
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
  });
  return container;
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    business_id: "biz-1",
    place_id: "place-1",
    name: "Fixture Roasters",
    title: "Fixture Roasters",
    category: "Coffee shop",
    categories: ["Coffee shop"],
    types: ["coffee_shop"],
    description: null,
    rating: 4.7,
    reviews: 210,
    price: "$$",
    price_level: 2,
    business_size: "small",
    employee_count: 12,
    business_size_source: "provider",
    business_size_confidence: 0.95,
    popular_times: null,
    phone: "+1 512 555 0100",
    phone_normalized: "15125550100",
    email: "hello@fixture-roasters.example.com",
    emails: ["hello@fixture-roasters.example.com"],
    website: "https://fixture-roasters.example.com",
    website_domain: "fixture-roasters.example.com",
    address: "100 Example Ave, Austin, TX 78701",
    street: "100 Example Ave",
    city: "Austin",
    state: "TX",
    postal_code: "78701",
    country: "United States",
    country_code: "US",
    latitude: 30.27,
    longitude: -97.74,
    plus_code: "",
    hours: {},
    open_state: "open",
    hours_display: "Open · Closes 9 PM",
    services: [],
    service_options: [],
    amenities: [],
    attributes: [],
    photos: 0,
    thumbnail: null,
    logo: null,
    maps_url: "",
    google_maps_url: "",
    source: "Google Maps",
    source_url: "",
    data_id: "",
    data_cid: "",
    kgmid: "",
    owner: null,
    owner_name: null,
    owner_link: null,
    booking_links: [],
    menu_links: [],
    social_links: [],
    search_query: "coffee shops in Austin",
    search_location: "Austin",
    collected_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    status: "new",
    tags: [],
    notes: [],
    list_ids: [],
    ...overrides,
  } as Lead;
}

// Vitest runs with the project root as cwd.
const projectRoot = process.cwd();
const indexCss = readFileSync(`${projectRoot}/src/index.css`, "utf8");

/* ------------------------------------------------------------------ */
/* Dark mode can never be activated                                    */
/* ------------------------------------------------------------------ */
describe("light mode is permanent", () => {
  it("pins the document to light and ignores an OS dark preference", () => {
    // Simulate an OS that prefers dark.
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    applyLightAppearance();

    const root = document.documentElement;
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("keeps light mode after preference updates — no switching path exists", () => {
    applyLightAppearance();
    setRuntimePreferences({ timezone: "America/Chicago", language: "en", date_format: "YYYY-MM-DD" });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("drops a legacy dark appearance value stored by an older build", () => {
    localStorage.setItem("zybble.preferences", JSON.stringify({ appearance: "dark", timezone: "UTC", language: "en", date_format: "MMM D, YYYY" }));
    setRuntimePreferences({});
    const stored = JSON.parse(localStorage.getItem("zybble.preferences") ?? "{}") as Record<string, unknown>;
    expect("appearance" in stored).toBe(false);
    expect("appearance" in (getRuntimePreferences() as Record<string, unknown>)).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("contains no dark theme CSS or system color-scheme override", () => {
    expect(indexCss).not.toContain('html[data-theme="dark"]');
    expect(indexCss.toLowerCase()).not.toContain("prefers-color-scheme");
    expect(indexCss).toContain("color-scheme: light");
  });

  it("has no dark: Tailwind variants or theme toggles in the source tree", async () => {
    const { execFileSync } = await import("node:child_process");
    let matches = "";
    try {
      matches = execFileSync(
        "grep",
        ["-rn", "--include=*.tsx", "--include=*.ts", "--exclude=*.test.ts", "--exclude=*.test.tsx", "-E", "dark:|data-theme=\"dark\"|applyAppearance", `${projectRoot}/src`],
        { encoding: "utf8" },
      );
    } catch {
      matches = ""; // grep exits 1 when nothing matches — that is the pass condition
    }
    expect(matches).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* /find Recent Leads card layout                                      */
/* ------------------------------------------------------------------ */
describe("/find Recent Leads card", () => {
  const longName =
    "Superduper Extraordinarily Longitudinal Artisanal Roastery, Bakehouse & Provisions Emporium Of The Greater Austin Metropolitan Area";
  const longEmail = "an.extremely.long.informational.email.address@fixture-roasters.example.com";

  const longLeads: Lead[] = [
    makeLead({ id: "lead-1", name: longName, email: longEmail }),
    makeLead({ id: "lead-2", name: "Short Cafe", email: null, phone: "+1 512 555 0188" }),
    makeLead({ id: "lead-3", name: "No Contact At All Diner", email: null, phone: "", rating: 0 }),
  ];

  it("keeps every lead completely inside the card with constrained widths", async () => {
    await render(<RecentLeadsCard leads={longLeads} loading={false} total={42} />);

    const card = container.firstElementChild as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.classList.contains("overflow-hidden")).toBe(true);

    const rows = card.querySelectorAll("ul > li");
    expect(rows.length).toBe(longLeads.length);

    for (const row of Array.from(rows)) {
      // Rows shrink instead of overflowing: min-width 0 on the row container.
      expect(row.classList.contains("min-w-0")).toBe(true);

      const anchor = row.querySelector("a");
      expect(anchor).not.toBeNull();
      expect(anchor!.classList.contains("flex")).toBe(true);
      // The anchor stays inside the card bounds structurally.
      expect(card.contains(anchor)).toBe(true);

      // The text block is allowed to shrink (min-w-0 flex-1)…
      const textBlock = anchor!.querySelector(".min-w-0.flex-1");
      expect(textBlock).not.toBeNull();
      // …and the business name truncates within it.
      const name = textBlock!.querySelector(".truncate");
      expect(name).not.toBeNull();
      expect(name!.textContent!.length).toBeGreaterThan(0);

      // Contact details truncate inside a bounded block instead of pushing out.
      const bounded = anchor!.querySelectorAll(".truncate");
      expect(bounded.length).toBeGreaterThan(1);
    }

    // The longest name is cut at 26 characters with an appended ellipsis.
    const firstRow = rows[0]!;
    const firstTextBlock = firstRow.querySelector(".min-w-0.flex-1")!;
    const nameLabel = firstTextBlock.querySelector(".truncate")!;
    expect(nameLabel.textContent).toMatch(/\.\.\.$/);
    expect(nameLabel.textContent!.length).toBeLessThanOrEqual(29); // 26 + "..."
    // The complete name stays accessible: hover/focus tooltip and the
    // row's accessible name both expose every character.
    const firstAnchor = firstRow.querySelector("a")!;
    expect(firstAnchor.getAttribute("title")).toBe(longName);
    expect(firstAnchor.getAttribute("aria-label")).toBe(`View ${longName}`);

    // No negative margins, negative positioning, or fixed minimum widths —
    // the classes that cause left-side overlap and horizontal page scroll.
    for (const element of Array.from(card.querySelectorAll("*"))) {
      const cls = element.getAttribute("class") ?? "";
      expect(cls, `unexpected layout class: ${cls}`).not.toMatch(/(^|\s)-(m[trblxy]|p[trblxy]|left|right|top|bottom)-/);
      expect(cls).not.toMatch(/(^|\s)translate-x-/);
      expect(cls).not.toMatch(/min-w-\[\d{3,}px\]/);
      expect(cls).not.toMatch(/w-\[\d{4,}px\]/);
    }
  });

  it("truncates only long names — short names render in full", async () => {
    await render(<RecentLeadsCard leads={longLeads} loading={false} total={42} />);
    const card = container.firstElementChild as HTMLElement;
    // "Short Cafe" (10 chars) renders whole — no ellipsis is ever added.
    expect(card.textContent).toContain("Short Cafe");
    expect(card.textContent).not.toContain("Short Cafe...");
    // A 26-character name is the edge case that still renders in full.
    const exactName = "A".repeat(26);
    await render(
      <RecentLeadsCard leads={[makeLead({ id: "lead-26", name: exactName })]} loading={false} total={1} />,
    );
    expect(container.firstElementChild!.textContent).toContain(exactName);
    expect(container.firstElementChild!.textContent).not.toContain(`${exactName}...`);
    // One character longer and the ellipsis appears in the visible label.
    const overName = `${"A".repeat(26)}Z`;
    await render(
      <RecentLeadsCard leads={[makeLead({ id: "lead-27", name: overName })]} loading={false} total={1} />,
    );
    expect(container.firstElementChild!.textContent).toContain(`${exactName}...`);
  });

  it("keeps long emails in the DOM with CSS truncation only", async () => {
    await render(<RecentLeadsCard leads={longLeads} loading={false} total={42} />);
    const card = container.firstElementChild as HTMLElement;
    // Emails are not cut in the source order; they truncate purely via CSS.
    expect(card.textContent).toContain(longEmail);
    // But the business name is — its full value lives on the row tooltip.
    expect(card.textContent).not.toContain(longName);
    expect(card.querySelector(`[title="${longName}"]`)).not.toBeNull();
  });

  it("shows email or phone without letting them push content outside the card", async () => {
    await render(<RecentLeadsCard leads={longLeads} loading={false} total={42} />);
    const card = container.firstElementChild as HTMLElement;
    const emailRow = card.querySelectorAll("ul > li")[0]!;
    const contact = emailRow.querySelector("a > span > span:last-child, a span[class*=max-w]");
    expect(contact).not.toBeNull();
    expect((contact!.getAttribute("class") ?? "")).toMatch(/truncate|max-w/);
  });

  it("renders the loading skeleton and empty state without lead content", async () => {
    await render(<RecentLeadsCard leads={[]} loading={true} total={0} />);
    expect(container.textContent).not.toContain(longName);
    expect(container.querySelector("ul")).not.toBeNull();

    await render(<RecentLeadsCard leads={[]} loading={false} total={0} />);
    expect(container.textContent).toContain("No leads yet");
  });

  it("renders the lead avatar with a fixed, non-overflowing footprint", () => {
    const span = document.createElement("div");
    const root2 = createRoot(span);
    act(() => {
      root2.render(<LeadAvatar lead={makeLead()} />);
    });
    const avatar = span.firstElementChild as HTMLElement;
    expect(avatar.getAttribute("class")).toMatch(/shrink-0/);
    act(() => root2.unmount());
    span.remove();
  });
});

/* ------------------------------------------------------------------ */
/* Vercel Analytics — installed once, rendered once at the app root    */
/* ------------------------------------------------------------------ */
describe("Vercel Analytics", () => {
  const appSource = readFileSync(`${projectRoot}/src/App.tsx`, "utf8");

  it("ships the dependency and uses the React entry point for this Vite SPA", () => {
    const pkg = JSON.parse(readFileSync(`${projectRoot}/package.json`, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@vercel/analytics"]).toBeTruthy();
    expect(appSource).toContain('from "@vercel/analytics/react"');
    // /next imports next/navigation, which cannot build outside Next.js.
    expect(appSource).not.toContain("@vercel/analytics/next");
  });

  it("renders <Analytics /> exactly once, at the application root", () => {
    expect(appSource.match(/<Analytics\s*\/>/g)?.length).toBe(1);
  });
});
