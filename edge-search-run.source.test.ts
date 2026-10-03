import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Supabase Edge Function runs on Deno and cannot be executed by vitest,
 * so these are source-level guards for the behaviors that broke production:
 * the open-state normalization must come from the shared module (never the
 * old substring heuristic), website enrichment must run before the email and
 * business-size refinements, and cheap refinements must not discard rows that
 * enrichment could still qualify.
 */
const source = readFileSync(resolve(process.cwd(), "supabase/functions/search-run/index.ts"), "utf8");

describe("Edge Function search-run source guarantees", () => {
  it("normalizes open state through the shared implementation", () => {
    expect(source).toContain("normalizeOpenState");
    // The old broken heuristic ("contains open but not close") must be gone.
    expect(source).not.toMatch(/includes\("open"\)[\s\S]{0,40}includes\("close"\)/);
    expect(source).not.toContain('String(t.open_state).toLowerCase().includes("open")');
  });

  it("checks cheap refinements before enrichment and email/size after it", () => {
    const preIndex = source.indexOf("function matchesPreEnrichmentFilters");
    const enrichIndex = source.indexOf("await Promise.all(");
    const postIndex = source.indexOf("function matchesFilters");
    expect(preIndex).toBeGreaterThan(-1);
    expect(postIndex).toBeGreaterThan(-1);
    expect(enrichIndex).toBeGreaterThan(-1);
    // Enrichment runs between the two refinement passes in the collection loop.
    const loopPre = source.indexOf("matchesPreEnrichmentFilters(row, req)");
    const loopEnrich = source.indexOf("enrichWebsiteRow(row, Math.min(deadlineAt");
    const loopPost = source.indexOf("matchesFilters(row, req)");
    expect(loopPre).toBeGreaterThan(-1);
    expect(loopEnrich).toBeGreaterThan(loopPre);
    expect(loopPost).toBeGreaterThan(loopEnrich);
  });

  it("enriches the homepage plus contact/about pages, never fabricating emails", () => {
    expect(source).toContain('"/contact"');
    expect(source).toContain('"/about"');
    // Same-domain public addresses only; junk locals filtered.
    expect(source).toContain('"noreply"');
    expect(source).toMatch(/emailDomain.*siteRoot|siteRoot.*emailDomain/s);
  });

  it("keeps paginating across query plans while the target is unmet", () => {
    expect(source).toContain("MAX_PROVIDER_PAGES_TOTAL");
    expect(source).toContain("searchPlans(");
    expect(source).toContain("serpapi_pagination");
  });

  it("interprets through the server-side Puter integration — never OpenAI", () => {
    expect(source).toContain("puterChatJson");
    expect(source).toContain("PUTER_MODEL");
    expect(source).not.toContain("openAIJson");
    expect(source).not.toContain("OPENAI_MODEL");
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toMatch(/_shared\/openai/);
  });
});
