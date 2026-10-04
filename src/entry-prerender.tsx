/**
 * Build-time prerender entry (never shipped to the browser).
 *
 * `scripts/prerender.mjs` loads the SSR build of this module after
 * `vite build` and, for every public marketing route, renders the real
 * application to static HTML. The result is written to dist/<route>/index.html
 * with the route's full metadata + JSON-LD already in the <head>, so
 * crawlers (and users with JS still loading) get complete, correct HTML
 * from the very first response — no reliance on client-side rendering for
 * indexing. The browser then boots the normal SPA over it.
 */
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { RoutedApp } from "./App";
import { ErrorBoundary } from "./app/components/ErrorBoundary";
import { prerenderRoutes, renderHeadTags, renderSitemap } from "./seo/meta";

export { prerenderRoutes, renderHeadTags, renderSitemap };

/** Render one route to an HTML string for injection into #root. */
export function render(path: string): string {
  return renderToString(
    <StrictMode>
      <ErrorBoundary>
        <StaticRouter location={path}>
          <RoutedApp />
        </StaticRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
}
