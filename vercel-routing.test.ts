import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const config = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as {
  rewrites: { source: string; destination: string }[];
  functions: Record<string, unknown>;
};

const redirects = readFileSync(new URL("./public/_redirects", import.meta.url), "utf8");
const apiDir = fileURLToPath(new URL("./api/", import.meta.url));

function findDeployedApiFunctions(dir = apiDir): string[] {
  const functions: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Vercel reserves underscore- and dot-prefixed paths for helpers.
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) functions.push(...findDeployedApiFunctions(path));
    else if (/\.(?:[cm]?[jt]s)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      functions.push(relative(apiDir, path));
    }
  }
  return functions.sort();
}

const deployedApiFunctions = findDeployedApiFunctions();

describe("Vercel routing", () => {
  it("declares the API function directory", () => {
    expect(config.functions).toHaveProperty("api/*.ts");
  });

  it("keeps non-function files out of the Hobby plan function count", () => {
    // Vercel maps each deployable file below api/ to a separate Function. Tests
    // belong in api/_tests because underscore-prefixed paths are ignored.
    expect(deployedApiFunctions.some((file) => file.endsWith(".test.ts"))).toBe(false);
    expect(deployedApiFunctions.length).toBeGreaterThan(0);
    expect(deployedApiFunctions.length).toBeLessThanOrEqual(12);
  });

  it("does not apply the SPA rewrite to /api routes", () => {
    // The SPA fallback is the noindex shell (app.html); indexable marketing
    // routes are prerendered static files that Vercel serves before rewrites.
    const source = config.rewrites.find((rewrite) => rewrite.destination === "/app.html")?.source ?? "";
    const routePattern = new RegExp(`^${source}$`);
    expect(routePattern.test("/find")).toBe(true);
    expect(routePattern.test("/leads")).toBe(true);
    expect(routePattern.test("/api/search-run")).toBe(false);
    expect(routePattern.test("/api/ai-interpret")).toBe(false);
    expect(routePattern.test("/api/ai-analyze")).toBe(false);
    expect(routePattern.test("/api/ai-chat")).toBe(false);
  });

  it("routes every browser AI surface to a deployed same-origin function", () => {
    // The browser must never leave the site for AI: interpret, analyze, and
    // the Ask Zybble chat all POST to same-origin /api routes. If one of
    // these files disappears the matching UI falls back to the Edge Function
    // or breaks, so keep the routing contract explicit.
    expect(deployedApiFunctions).toContain("ai-interpret.ts");
    expect(deployedApiFunctions).toContain("ai-analyze.ts");
    expect(deployedApiFunctions).toContain("ai-chat.ts");
  });

  it("passes /api through the SPA fallback file untouched", () => {
    // public/_redirects is inert on Vercel but honored by some static hosts;
    // an /api line must precede the catch-all so the API is never served the
    // SPA's index.html.
    const lines = redirects.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    const apiRule = lines.find((line) => line.startsWith("/api/"));
    const catchAll = lines.find((line) => line.startsWith("/*"));
    expect(apiRule).toBeDefined();
    expect(catchAll).toBeDefined();
    expect(lines.indexOf(apiRule!)).toBeLessThan(lines.indexOf(catchAll!));
    expect(catchAll).toContain("/app.html");
  });

  it("noindexes authenticated and auth routes via X-Robots-Tag", () => {
    const headerConfigs = (config as unknown as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    }).headers;
    const noindexRule = headerConfigs.find((entry) =>
      entry.headers.some((h) => h.key === "X-Robots-Tag" && h.value.includes("noindex")),
    );
    expect(noindexRule).toBeDefined();
    for (const route of ["login", "signup", "overview", "find", "leads", "billing", "settings"]) {
      expect(noindexRule!.source).toContain(route);
    }
    // Public marketing routes must NOT be covered by the noindex rule.
    for (const route of ["blog", "contact", "privacy", "terms"]) {
      expect(noindexRule!.source).not.toContain(route);
    }
  });
});
