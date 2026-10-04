/* ============================================================================
 * Build-time prerenderer — makes every public marketing route crawlable.
 *
 * Runs as the last step of `npm run build`:
 *   1. vite build                 → dist/ (SPA assets + index.html template)
 *   2. vite build --ssr …         → dist-server/entry-prerender.js
 *   3. node scripts/prerender.mjs → this file
 *
 * For each route in the central SEO registry (src/seo/meta.ts) it:
 *   - renders the real React app to HTML with a StaticRouter,
 *   - replaces the template's <!--seo:start-->…<!--seo:end--> block with the
 *     route's unique title/description/canonical/OG/Twitter/JSON-LD tags,
 *   - injects the rendered markup into <div id="root">,
 *   - writes dist/<route>/index.html.
 *
 * It also writes:
 *   - dist/app.html   → the empty SPA shell (noindex) used as the rewrite
 *                       fallback for authenticated app routes and client-side
 *                       404s (see vercel.json),
 *   - dist/sitemap.xml → generated from the same registry, so the sitemap
 *                       can never drift from the published routes.
 *
 * Crawlers therefore receive complete static HTML for every indexable URL —
 * no dependence on client-side JavaScript for titles, content, links, or
 * structured data — while the browser still boots the unchanged SPA.
 * ========================================================================== */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const dist = path.join(root, "dist");
const serverEntry = path.join(root, "dist-server", "entry-prerender.js");

const SEO_BLOCK = /<!--seo:start-->[\s\S]*?<!--seo:end-->/;
const APP_HTML = "<!--app-html-->";

if (!existsSync(serverEntry)) {
  console.error("[prerender] dist-server/entry-prerender.js not found — run the SSR build first.");
  process.exit(1);
}

const template = readFileSync(path.join(dist, "index.html"), "utf8");
if (!SEO_BLOCK.test(template) || !template.includes(APP_HTML)) {
  console.error("[prerender] index.html is missing the seo markers or the app-html placeholder.");
  process.exit(1);
}

const { render, prerenderRoutes, renderHeadTags, renderSitemap } = await import(
  pathToFileURL(serverEntry).href
);

/* ---------------------------------------------------------------- */
/* 1) The SPA fallback shell (app.html)                              */
/*                                                                   */
/* Served (via rewrite) for every route that has no static file:     */
/* the authenticated app, auth screens, and unknown URLs. All of     */
/* those must not be indexed — every indexable URL has its own       */
/* prerendered file — so the shell carries noindex. The app sets     */
/* its own titles at runtime.                                        */
/* ---------------------------------------------------------------- */
const shellHead = [
  `<title>Zybble</title>`,
  `<meta name="robots" content="noindex" />`,
].join("\n    ");
writeFileSync(path.join(dist, "app.html"), template.replace(SEO_BLOCK, shellHead));

/* ---------------------------------------------------------------- */
/* 2) Prerender every public route                                   */
/* ---------------------------------------------------------------- */
const routes = prerenderRoutes();
for (const meta of routes) {
  const head = renderHeadTags(meta);
  let body = "";
  try {
    body = render(meta.path);
  } catch (error) {
    console.error(`[prerender] rendering ${meta.path} failed:`, error);
    process.exit(1);
  }
  if (!body || body.length < 500) {
    console.error(`[prerender] ${meta.path} rendered suspiciously little HTML (${body.length} chars).`);
    process.exit(1);
  }

  const html = template.replace(SEO_BLOCK, head).replace(APP_HTML, body);
  const outDir = meta.path === "/" ? dist : path.join(dist, meta.path.replace(/^\//, ""));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "index.html"), html);
  console.log(`[prerender] ${meta.path} → ${path.relative(root, path.join(outDir, "index.html"))} (${(html.length / 1024).toFixed(0)} kB)`);
}

/* ---------------------------------------------------------------- */
/* 3) Sitemap — generated from the same registry                     */
/* ---------------------------------------------------------------- */
writeFileSync(path.join(dist, "sitemap.xml"), renderSitemap());
console.log(`[prerender] sitemap.xml → ${routes.length} routes`);

/* ---------------------------------------------------------------- */
/* 4) Clean up the SSR bundle so it never deploys                    */
/* ---------------------------------------------------------------- */
rmSync(path.join(root, "dist-server"), { recursive: true, force: true });
console.log("[prerender] done.");
