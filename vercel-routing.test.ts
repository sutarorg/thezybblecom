import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as {
  rewrites: { source: string; destination: string }[];
  functions: Record<string, unknown>;
};

const redirects = readFileSync(new URL("./public/_redirects", import.meta.url), "utf8");

describe("Vercel routing", () => {
  it("declares the API function directory", () => {
    expect(config.functions).toHaveProperty("api/*.ts");
  });

  it("does not apply the SPA rewrite to /api routes", () => {
    const source = config.rewrites.find((rewrite) => rewrite.destination === "/index.html")?.source ?? "";
    const routePattern = new RegExp(`^${source}$`);
    expect(routePattern.test("/find")).toBe(true);
    expect(routePattern.test("/leads")).toBe(true);
    expect(routePattern.test("/api/search-run")).toBe(false);
    expect(routePattern.test("/api/ai-interpret")).toBe(false);
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
    expect(catchAll).toContain("/index.html");
  });
});
