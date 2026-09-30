import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

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
        const file = path.resolve(__dirname, "api", `${route}.ts`);
        if (!route || !fs.existsSync(file)) return next();

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (req as any).body = raw ? safeJson(raw) : undefined;

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

          const mod = await server.ssrLoadModule(file);
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
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), viteSingleFile(), vercelApiDev(mode)],
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
