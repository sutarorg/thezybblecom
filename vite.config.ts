import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs the `api/*.ts` Vercel Functions inside the Vite dev server so local
 * development hits the very same SerpApi code path as production instead of
 * falling through to the Supabase Edge Function (or a 404).
 */
function vercelApiDev(mode: string): Plugin {
  return {
    name: "zybble-vercel-api-dev",
    apply: "serve",
    configureServer(server) {
      // Server-only secrets (SERPAPI_API_KEY, …) are never exposed to the bundle;
      // they are loaded here for the Node-side handler only.
      Object.assign(process.env, loadEnv(mode, __dirname, ""));

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/api/")) return next();

        const route = url.replace(/^\/api\//, "").replace(/\/$/, "");
        if (!route) return next();

        // Resolve the longest `api/<file>.ts` prefix and hand the remainder to
        // the handler as `?path=…`, mirroring the production rewrite
        // `/api/admin/:path*` → `/api/admin?path=:path*` (Vercel rewrites do
        // not preserve the original pathname, so nested admin routes must be
        // read from the query string in both environments).
        const parts = route.split("/");
        let file = "";
        let rest = "";
        for (let depth = parts.length; depth > 0; depth -= 1) {
          const candidate = path.resolve(__dirname, "api", `${parts.slice(0, depth).join("/")}.ts`);
          if (fs.existsSync(candidate)) {
            file = candidate;
            rest = parts.slice(depth).join("/");
            break;
          }
        }
        if (!file) return next();

        if (rest) {
          const [, search = ""] = (req.url ?? "").split("?");
          const query = new URLSearchParams(search);
          query.set("path", rest);
          req.url = `/api/${parts.slice(0, parts.length - rest.split("/").length).join("/")}?${query.toString()}`;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (req as any).body = raw ? safeJson(raw) : undefined;

          const mod = await server.ssrLoadModule(file);

          /* Web-standard handlers (Request → Response), used by routes that
             need the RAW request body for signature verification (e.g.
             /api/paddle-webhook). The raw bytes are never re-serialized. */
          if (typeof mod.default !== "function") {
            const method = (req.method ?? "POST").toUpperCase();
            const handler = mod[method] ?? mod.POST ?? mod.default;
            if (typeof handler !== "function") return next();
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (typeof value === "string") headers.set(key, value);
              else if (Array.isArray(value)) headers.set(key, value.join(", "));
            }
            const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
              method: req.method ?? "POST",
              headers,
              body: ["GET", "HEAD"].includes((req.method ?? "").toUpperCase()) ? undefined : raw,
            });
            const response = await handler(request);
            res.statusCode = response.status;
            response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
            res.end(await response.text());
            return;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const response = res as any;
          response.status = (code: number) => {
            res.statusCode = code;
            return response;
          };
          response.json = (body: unknown) => {
            if (!res.getHeader("Content-Type")) {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
            }
            res.end(JSON.stringify(body));
          };

          await mod.default(req, response);
        } catch (error) {
          server.config.logger.error(`[api] ${url} failed: ${String(error)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          res.end(JSON.stringify({ error: "The local API route crashed. See the dev server logs." }));
        }
      });
    },
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// https://vite.dev/config/
// NOTE: the former vite-plugin-singlefile inlining was removed deliberately:
// hashed, immutable /assets files are shared by every prerendered page and
// cached across routes, where a ~1 MB inlined index.html had to be
// re-downloaded per navigation and per prerendered route. This is both the
// CWV-friendly and the prerender-friendly shape.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), vercelApiDev(mode)],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    // Preview servers may run behind a proxy host (e.g. sandbox previews).
    host: true,
    allowedHosts: true,
  },
}));
