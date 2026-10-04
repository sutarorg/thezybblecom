import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Routing guards for the admin console.
 *
 * /admin and every nested route must survive a hard refresh on Vercel, the
 * admin API rewrite must be matched before the SPA catch-all, and the console
 * must not disturb the customer routes or the prerendered marketing pages.
 */

const root = process.cwd();
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const app = readFileSync(join(root, "src", "App.tsx"), "utf8");
const adminIndex = readFileSync(join(root, "src", "app", "admin", "index.tsx"), "utf8");
const layout = readFileSync(join(root, "src", "app", "admin", "AdminLayout.tsx"), "utf8");
const viteConfig = readFileSync(join(root, "vite.config.ts"), "utf8");
const prerender = readFileSync(join(root, "scripts", "prerender.mjs"), "utf8");

describe("vercel routing", () => {
  it("rewrites nested admin API paths to the single function, before the SPA fallback", () => {
    const adminIndexPosition = vercel.rewrites.findIndex((rule) => rule.source.startsWith("/api/admin"));
    const spaIndex = vercel.rewrites.findIndex((rule) => rule.destination.endsWith(".html"));
    expect(adminIndexPosition).toBeGreaterThanOrEqual(0);
    expect(spaIndex).toBeGreaterThan(adminIndexPosition);
    expect(vercel.rewrites[adminIndexPosition]).toEqual({
      source: "/api/admin/:path*",
      destination: "/api/admin?path=:path*",
    });
  });

  it("still serves the SPA for a deep admin URL so a refresh works", () => {
    const spa = vercel.rewrites.find((rule) => rule.destination.endsWith(".html"));
    expect(spa).toBeDefined();
    // The catch-all excludes /api, assets and prerendered paths — but not /admin.
    expect(spa!.source).not.toMatch(/admin/);
  });

  it("keeps the admin tree out of search engines", () => {
    const noindex = vercel.headers.find((entry) =>
      entry.headers.some((header) => header.key === "X-Robots-Tag" && header.value.includes("noindex")),
    );
    expect(noindex).toBeDefined();
    expect(noindex!.source).toContain("admin");
  });

  it("does not prerender anything under /admin", () => {
    expect(prerender).not.toContain("/admin");
  });
});

describe("local dev routing", () => {
  it("resolves /api/admin/<nested> to api/admin.ts with the remainder as ?path=", () => {
    expect(viteConfig).toMatch(/\?path=/);
    expect(viteConfig).toMatch(/segments\.length|longest/i);
  });
});

describe("react routes", () => {
  it("mounts the console at /admin/* as its own lazy chunk", () => {
    expect(app).toMatch(/const AdminRoutes = lazy\(\(\) => import\("\.\/app\/admin"\)/);
    expect(app).toMatch(/<Route path="\/admin\/\*" element=\{<AdminArea \/>\} \/>/);
  });

  it("does not wrap the console in the customer AppLayout", () => {
    expect(adminIndex).not.toMatch(/AppLayout/);
    expect(layout).not.toMatch(/from "\.\.\/components\/AppLayout"/);
  });

  it("declares every required admin route, with clean paths and no hash", () => {
    for (const path of [
      'index element',
      'path="users"',
      'path="users/:id"',
      'path="workspaces"',
      'path="workspaces/:id"',
      'path="billing"',
      'path="plans"',
      'path="searches"',
      'path="leads"',
      'path="usage"',
      'path="ai"',
      'path="webhooks"',
      'path="audit-logs"',
      'path="system"',
      'path="settings"',
    ]) {
      expect(adminIndex).toContain(path);
    }
    expect(adminIndex).not.toMatch(/#\/admin/);
  });

  it("renders nothing before the server has answered the access question", () => {
    expect(adminIndex).toMatch(/<AdminGate>/);
    expect(layout).toMatch(/access\.state === "forbidden"/);
    expect(layout).toMatch(/access\.state === "unauthenticated"/);
  });

  it("groups navigation the way the console is organised", () => {
    for (const group of ["Overview", "Customers", "Revenue", "Product", "Operations", "Administration"]) {
      expect(layout).toContain(`label: "${group}"`);
    }
  });
});
