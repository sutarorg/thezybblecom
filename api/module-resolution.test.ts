import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vercel's Node runtime compiles every traced `.ts` file in `api/` to `.js`
 * (`api/_lib/search-core.ts` → `api/_lib/search-core.js`) but it does NOT
 * rewrite import specifiers. The repo is ESM (`"type": "module"`), so Node
 * resolves the deployed specifier literally:
 *
 *   - `"./_lib/search-core.ts"`  → ERR_MODULE_NOT_FOUND (the file is `.js`)
 *   - `"./_lib/search-core"`     → ERR_MODULE_NOT_FOUND (ESM needs extensions)
 *   - `"./_lib/search-core.js"`  → resolves ✅
 *
 * A bad specifier throws while the function module is being imported, before
 * any handler code runs, which Vercel reports as an opaque
 * `500 FUNCTION_INVOCATION_FAILED` with no JSON body. Keep every relative
 * import inside `api/` written with the emitted `.js` extension.
 */

const apiDir = dirname(fileURLToPath(import.meta.url));

function apiSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...apiSourceFiles(full));
      continue;
    }
    if (extname(entry) === ".ts" && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const RELATIVE_IMPORT = /(?:import|export)[\s\S]*?from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g;

describe("Vercel function module resolution", () => {
  const files = apiSourceFiles(apiDir);

  it("finds the deployed function sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [file.slice(apiDir.length + 1), file] as const))(
    "%s imports relative modules with the emitted .js extension",
    (_name, file) => {
      const source = readFileSync(file, "utf8");
      const specifiers: string[] = [];
      for (const match of source.matchAll(RELATIVE_IMPORT)) {
        const specifier = match[1] ?? match[2];
        if (specifier) specifiers.push(specifier);
      }
      for (const specifier of specifiers) {
        expect(
          specifier.endsWith(".js"),
          `${specifier} must end with ".js" — Vercel emits .js and ESM resolves specifiers literally`,
        ).toBe(true);
        // The `.js` specifier has to point at a real `.ts` source next to it.
        const target = resolve(dirname(file), specifier).replace(/\.js$/, ".ts");
        expect(() => statSync(target), `${specifier} does not resolve to ${target}`).not.toThrow();
      }
    },
  );

  it("does not re-enable allowImportingTsExtensions", () => {
    const tsconfig = readFileSync(resolve(apiDir, "..", "tsconfig.json"), "utf8");
    expect(/"allowImportingTsExtensions"\s*:\s*true/.test(tsconfig)).toBe(false);
  });
});
