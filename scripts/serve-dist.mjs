/**
 * Local static server that mimics Vercel's production routing for dist/:
 *   1. exact static file (e.g. /assets/x.js, /blog/slug.webp),
 *   2. <path>/index.html for prerendered routes (/blog, /blog/<slug>, …),
 *   3. fallback to the noindex SPA shell app.html (matches vercel.json's
 *      rewrite) for app routes and unknown URLs.
 *
 * `vite preview` can't be used for this check: its SPA mode rewrites every
 * HTML navigation to /index.html and ignores nested prerendered files.
 *
 * Usage: node scripts/serve-dist.mjs [port]
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const dist = path.join(root, "dist");
const port = Number(process.argv[2] ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

function send(res, filePath, status = 200) {
  res.writeHead(status, { "Content-Type": TYPES[path.extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/\/+$/, "") || "/";
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");

  const direct = path.join(dist, safe);
  if (existsSync(direct) && statSync(direct).isFile()) return send(res, direct);

  const asIndex = path.join(dist, safe, "index.html");
  if (existsSync(asIndex)) return send(res, asIndex);

  return send(res, path.join(dist, "app.html")); // SPA fallback (noindex shell)
}).listen(port, "0.0.0.0", () => {
  console.log(`[serve-dist] production-like preview on http://0.0.0.0:${port}`);
});
