import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Supabase Edge Function runs on Deno and cannot be executed by vitest,
 * so these are source-level guards for the two defects this path had.
 *
 * 1) IDOR. export-run runs with the SERVICE key, so RLS is not the boundary:
 *    it authorized the caller against `workspaceId` and then read
 *    `lead_list_members` by `list_id` alone. A member of workspace A could
 *    pass their own workspace id together with a list id from workspace B and
 *    receive that workspace's leads as a CSV.
 *
 * 2) CSV injection. Lead fields are third-party text; a cell starting with
 *    = + - @ TAB or CR is executed as a formula by every spreadsheet.
 *
 * The same rules are enforced (and executed) for the Vercel route in
 * api/_tests/export-run.test.ts — these two implementations must not drift.
 */
const source = readFileSync(resolve(process.cwd(), "supabase/functions/export-run/index.ts"), "utf8");

describe("Edge Function export-run source guarantees", () => {
  it("proves the list belongs to the authorized workspace before reading it", () => {
    const listBranch = source.slice(source.indexOf("} else if (listId) {"), source.indexOf("if (!leads.length)"));
    expect(listBranch).toContain('.from("lead_lists")');
    expect(listBranch).toMatch(/\.eq\("workspace_id", workspaceId\)/);
    // The ownership check must come before the membership read it guards.
    expect(listBranch.indexOf('.from("lead_lists")')).toBeLessThan(
      listBranch.indexOf('.from("lead_list_members")'),
    );
  });

  it("proves the search belongs to the authorized workspace", () => {
    const searchBranch = source.slice(source.indexOf("} else if (searchId) {"), source.indexOf("} else if (listId) {"));
    expect(searchBranch).toContain('.from("lead_searches")');
    expect(searchBranch).toMatch(/\.eq\("workspace_id", workspaceId\)/);
  });

  it("validates every caller-supplied id instead of forwarding it to PostgREST", () => {
    expect(source).toMatch(/const UUID = \/\^\[0-9a-f-\]\{36\}\$\/i;/);
    expect(source).toContain("if (!UUID.test(workspaceId))");
  });

  it("neutralizes spreadsheet formulas exactly like the Vercel route", () => {
    expect(source).toContain("function neutralizeCsvFormula");
    expect(source).toMatch(/const FORMULA_LEAD = \/\^\[=\+\\-@\\t\\r\]\/;/);
    // numbers and international phone numbers stay untouched
    expect(source).toContain("PLAIN_NUMBER");
    expect(source).toContain("PHONE_LIKE");
    expect(source).toMatch(/csvEscape[\s\S]{0,200}neutralizeCsvFormula\(raw\)/);
  });

  it("still authenticates and authorizes the caller before doing any work", () => {
    expect(source).toContain("await callerFromRequest(req, sb)");
    expect(source).toContain("await requireWorkspaceRole(sb, user.id, workspaceId)");
    expect(source.indexOf("callerFromRequest")).toBeLessThan(source.indexOf('.from("exports")'));
  });
});
