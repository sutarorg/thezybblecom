/* ------------------------------------------------------------------ */
/* Zybble app — real-path routing helpers + per-page SEO               */
/* No hash routing anywhere: BrowserRouter owns the URL.               */
/* ------------------------------------------------------------------ */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SITE_URL } from "../lib/site";

/** Current pathname, e.g. "/leads/abc". */
export function useAppRoute() {
  const { pathname } = useLocation();
  return { path: pathname };
}

/**
 * Module-level navigate so non-hook call sites (menus, table rows,
 * command palette) can push real paths. The bridge below registers the
 * router's navigate during render of the app tree.
 */
let routerNavigate: ((to: string, opts?: { replace?: boolean }) => void) | null = null;

export function registerNavigate(
  fn: (to: string, opts?: { replace?: boolean }) => void
) {
  routerNavigate = fn;
}

export function navigate(to: string, opts?: { replace?: boolean }) {
  const path = to.startsWith("#") ? to.slice(1) : to;
  if (routerNavigate) routerNavigate(path, opts);
  else window.location.assign(path);
}

/** Per-route document metadata. Canonicals use clean paths (no #). */
export function useAppSeo(title: string, description: string, path: string) {
  useEffect(() => {
    document.title = title;
    const set = (sel: string, content: string) =>
      document.head.querySelector<HTMLMetaElement>(sel)?.setAttribute("content", content);
    set('meta[name="description"]', description);
    set('meta[property="og:title"]', title);
    set('meta[property="og:description"]', description);
    set('meta[property="og:url"]', `${SITE_URL}${path}`);
    document
      .querySelector<HTMLLinkElement>('link[rel="canonical"]')
      ?.setAttribute("href", `${SITE_URL}${path}`);
    // App routes should never be indexed.
    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const isApp = !["/", "/contact", "/privacy", "/terms"].includes(path);
    robots?.setAttribute("content", isApp ? "noindex, nofollow" : "index, follow, max-image-preview:large");
  }, [title, description, path]);
}
