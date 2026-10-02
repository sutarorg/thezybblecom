import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as {
  rewrites: { source: string; destination: string }[];
  functions: Record<string, unknown>;
};

describe("Vercel routing", () => {
  it("declares the API function directory", () => {
    expect(config.functions).toHaveProperty("api/*.ts");
  });

  it("does not apply the SPA rewrite to /api routes", () => {
    const source = config.rewrites.find((rewrite) => rewrite.destination === "/index.html")?.source ?? "";
    const routePattern = new RegExp(`^${source}$`);
    expect(routePattern.test("/find")).toBe(true);
    expect(routePattern.test("/api/search-run")).toBe(false);
    expect(routePattern.test("/api/ai-interpret")).toBe(false);
  });
});
