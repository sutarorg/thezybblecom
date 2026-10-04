import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SITE_URL } from "./site";
import {
  absoluteUrl,
  canonicalUrl,
  DEFAULT_OG_IMAGE,
  type PageMeta,
} from "../seo/meta";

/**
 * Keeps the document head correct during client-side navigation: title,
 * description, robots, canonical, Open Graph / Twitter tags and JSON-LD.
 *
 * Crawlers never depend on this hook — every indexable public route is also
 * prerendered to static HTML at build time with the same metadata (see
 * scripts/prerender.mjs), so the initial HTML response already carries the
 * correct tags. This hook only keeps the SPA honest after in-app route
 * changes.
 */
export function usePageSeo(meta: PageMeta) {
  const { title, description, path, noindex } = meta;

  useEffect(() => {
    document.title = title;

    const head = document.head;

    const setTag = (selector: string, create: () => HTMLElement, value: string, attr = "content") => {
      let el = head.querySelector<HTMLElement>(selector);
      if (!el) {
        el = create();
        head.appendChild(el);
      }
      el.setAttribute(attr, value);
    };

    const meta_ = (name: string, value: string, property = false) => {
      const key = property ? "property" : "name";
      setTag(`meta[${key}="${name}"]`, () => {
        const el = document.createElement("meta");
        el.setAttribute(key, name);
        return el;
      }, value);
    };

    const ogImage = absoluteUrl(meta.ogImage ?? DEFAULT_OG_IMAGE);

    meta_("description", description);
    meta_("robots", noindex ? "noindex, follow" : "index, follow, max-image-preview:large");
    meta_("og:type", meta.ogType ?? "website", true);
    meta_("og:title", title, true);
    meta_("og:description", description, true);
    meta_("og:url", canonicalUrl(path), true);
    meta_("og:image", ogImage, true);
    meta_("twitter:card", "summary_large_image");
    meta_("twitter:title", title);
    meta_("twitter:description", description);
    meta_("twitter:image", ogImage);

    setTag(
      'link[rel="canonical"]',
      () => {
        const el = document.createElement("link");
        el.setAttribute("rel", "canonical");
        return el;
      },
      canonicalUrl(path),
      "href",
    );

    // Route-specific JSON-LD lives in one managed script tag; prerendered
    // static scripts in the initial HTML are left untouched for crawlers.
    const JSONLD_ID = "route-jsonld";
    const existing = document.getElementById(JSONLD_ID);
    if (meta.jsonLd && meta.jsonLd.length > 0) {
      const script = existing ?? document.createElement("script");
      script.id = JSONLD_ID;
      script.setAttribute("type", "application/ld+json");
      script.textContent = JSON.stringify(
        meta.jsonLd.length === 1 ? meta.jsonLd[0] : meta.jsonLd,
      ).replace(/</g, "\\u003c");
      if (!existing) document.head.appendChild(script);
    } else if (existing) {
      existing.remove();
    }
    // Meta objects are rebuilt per render; everything they contain is
    // derived from the route, so the route path keys the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, path, noindex, meta.ogImage, meta.ogType]);
}

export { SITE_URL };

/**
 * Scroll behaviour on navigation. Cross-page section links pass
 * `state.scrollTo`, so we can anchor without putting "#" in the URL.
 */
export function useScrollToHash() {
  const { pathname, state } = useLocation();

  useEffect(() => {
    const target = (state as { scrollTo?: string } | null)?.scrollTo;
    if (target) {
      requestAnimationFrame(() => {
        const el = document.getElementById(target);
        if (el) {
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
          window.history.replaceState({}, "");
          return;
        }
        window.scrollTo({ top: 0, behavior: "auto" });
      });
      return;
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname, state]);
}
