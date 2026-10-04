import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Source guard: Settings must not claim a save it never performed.
 *
 * Two controls shipped as pure theatre:
 *   • Settings → Workspace — "Save changes" toasted "Workspace saved" and
 *     wrote nothing, so renaming a workspace silently reverted.
 *   • Settings → Notifications — four switches and a "Save preferences"
 *     button for emails that do not exist anywhere in the product (Resend is
 *     only wired to team invitations; there is no digest job, no
 *     search-complete mail, no product-update mail).
 *
 * The rename is a real write now and the notifications section is gone. This
 * file fails if either regression comes back.
 */

const SETTINGS = readFileSync(new URL("./src/app/pages/Settings.tsx", import.meta.url), "utf8");
const API = readFileSync(new URL("./src/app/services/api.ts", import.meta.url), "utf8");

describe("Settings → Workspace rename", () => {
  it("calls the real rename service", () => {
    expect(SETTINGS).toMatch(/import \{[^}]*renameWorkspace/s);
    expect(SETTINGS).toMatch(/await renameWorkspace\(workspace\.id, wsName\)/);
  });

  it("refreshes the workspace switcher so the new name is visible everywhere", () => {
    const branch = SETTINGS.slice(SETTINGS.indexOf('if (section === "Workspace")'));
    expect(branch).toMatch(/dispatchEvent\(new CustomEvent\("zybble:workspace"\)\)/);
  });

  it("only toasts success after the write resolves", () => {
    const branch = SETTINGS.slice(
      SETTINGS.indexOf('if (section === "Workspace")'),
      SETTINGS.indexOf('toast(`${section} saved`)'),
    );
    expect(branch.indexOf("await renameWorkspace")).toBeLessThan(branch.indexOf('toast("Workspace saved")'));
    expect(branch).toMatch(/catch \(e\)[\s\S]*toast\(\(e as Error\)\.message, "error"\)/);
  });

  it("exposes a rename that is authorized by the database, not by the client", () => {
    const fn = API.slice(API.indexOf("export async function renameWorkspace"));
    expect(fn).toMatch(/\.from\("workspaces"\)\s*\.update\(\{ name: trimmed \}\)/);
    // No client-side role check standing in for RLS.
    expect(fn.slice(0, fn.indexOf("\n}\n"))).not.toMatch(/role\s*===\s*["'](owner|admin)["']/);
  });
});

describe("Settings → Notifications", () => {
  it("no longer offers switches for emails the product never sends", () => {
    expect(SETTINGS).not.toMatch(/tab === "notifications"/);
    expect(SETTINGS).not.toMatch(/Weekly usage digest|Exports ready|Search completion/);
    expect(SETTINGS).not.toMatch(/setNDigest|setNProduct|setNSearch|setNExport/);
  });

  it("drops the now-unreferenced helpers along with it", () => {
    expect(SETTINGS).not.toMatch(/function PrefRow/);
    expect(SETTINGS).not.toMatch(/\bSwitch\b/);
  });
});
