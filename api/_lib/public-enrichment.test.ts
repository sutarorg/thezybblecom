import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The enrichment module resolves DNS before fetching so private networks are
// never contacted. Point every lookup at a public address for these tests.
vi.mock("node:dns/promises", () => ({
  default: {
    lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
  },
}));

import { enrichPublicWebsite } from "./public-enrichment";

const html = (body: string) =>
  new Response(`<!doctype html><html><body>${body}</body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public website enrichment — email discovery", () => {
  it("finds a public email published on the business homepage", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://fixture-cafe.example.com/" || url === "https://fixture-cafe.example.com") {
        return html(`<a href="mailto:hello@fixture-cafe.example.com">hello@fixture-cafe.example.com</a>`);
      }
      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichPublicWebsite("https://fixture-cafe.example.com", { deadlineAt: Date.now() + 5_000 });
    expect(result.emails).toEqual(["hello@fixture-cafe.example.com"]);
    expect(result.pagesChecked).toBeGreaterThan(0);
  });

  it("discovers emails across homepage and contact/about pages and dedupes them", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).replace(/\/$/, "");
      if (url === "https://fixture-roasters.example.com" || url === "https://fixture-roasters.example.com/") {
        return html(`<p>Reach us at front-desk@fixture-roasters.example.com any time.</p>`);
      }
      if (url === "https://fixture-roasters.example.com/contact") {
        return html(`<p>Sales: sales@fixture-roasters.example.com · General: front-desk@fixture-roasters.example.com</p>`);
      }
      if (url === "https://fixture-roasters.example.com/about") {
        return html(`<p>Our team of 120 employees roasts daily.</p>`);
      }
      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichPublicWebsite("https://fixture-roasters.example.com", { deadlineAt: Date.now() + 10_000 });
    expect(result.emails).toContain("front-desk@fixture-roasters.example.com");
    expect(result.emails).toContain("sales@fixture-roasters.example.com");
    // The repeated address appears exactly once.
    expect(result.emails.filter((e) => e === "front-desk@fixture-roasters.example.com")).toHaveLength(1);
    // Employee evidence from the about page is picked up too.
    expect(result.employeeSize.business_size).toBe("medium");
    expect(result.employeeSize.employee_count).toBe(120);
  });

  it("ignores invalid, junk, and off-domain email candidates", async () => {
    const fetchMock = vi.fn(async () =>
      html(`
        <img src="team@fixture-cafe.example.com.png">
        <script>var x = "script@fixture-cafe.example.com";</script>
        <p>noreply@fixture-cafe.example.com</p>
        <p>something@phishing-other-domain.example.net</p>
        <p>real one: orders@fixture-cafe.example.com</p>
      `)
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichPublicWebsite("https://fixture-cafe.example.com", { deadlineAt: Date.now() + 5_000 });
    expect(result.emails).toEqual(["orders@fixture-cafe.example.com"]);
  });

  it("returns no emails when the website publishes none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html("<p>No contact details here.</p>")));
    const result = await enrichPublicWebsite("https://fixture-cafe.example.com", { deadlineAt: Date.now() + 5_000 });
    expect(result.emails).toEqual([]);
    expect(result.employeeSize.business_size).toBe("unknown");
  });

  it("returns no emails when the website is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Service Unavailable", { status: 503 })));
    const result = await enrichPublicWebsite("https://down.example.com", { deadlineAt: Date.now() + 5_000 });
    expect(result.emails).toEqual([]);
    expect(result.employeeSize.business_size).toBe("unknown");
  });

  it("returns no emails when the site cannot be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const result = await enrichPublicWebsite("https://unreachable.example.com", { deadlineAt: Date.now() + 5_000 });
    expect(result.emails).toEqual([]);
  });

  it("stops immediately when the enrichment deadline has already passed", async () => {
    const fetchMock = vi.fn(async () => html("<p>hello@fixture-cafe.example.com</p>"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichPublicWebsite("https://fixture-cafe.example.com", { deadlineAt: Date.now() - 1 });
    expect(result.emails).toEqual([]);
    expect(result.pagesChecked).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects private/localhost targets without any fetch", async () => {
    const fetchMock = vi.fn(async () => html("<p>hello@internal.example.com</p>"));
    vi.stubGlobal("fetch", fetchMock);
    // A private network target must be blocked even when DNS resolves.
    const { default: dns } = await import("node:dns/promises");
    vi.mocked(dns.lookup).mockImplementation(
      (async (hostname: string) =>
        hostname === "10.0.0.5" ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]) as never
    );

    for (const site of ["http://localhost:3000", "http://10.0.0.5/", "not a url", ""]) {
      const result = await enrichPublicWebsite(site, { deadlineAt: Date.now() + 5_000 });
      expect(result.emails).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
