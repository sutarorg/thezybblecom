import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SITE_URL } from "./site";

/**
 * Sets document title, meta description, robots and canonical link
 * per route.
 */
export function usePageSeo({
  title,
  description,
  path,
  noindex,
}: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}) {
  useEffect(() => {
    document.title = title;

    const setMeta = (selector: string, attr: string, value: string) => {
      const el = document.head.querySelector<HTMLMetaElement>(selector);
      if (el) el.setAttribute(attr, value);
    };

    setMeta('meta[name="description"]', "content", description);
    setMeta(
      'meta[name="robots"]',
      "content",
      noindex ? "noindex, follow" : "index, follow, max-image-preview:large"
    );
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[property="og:url"]', "content", `${SITE_URL}${path}`);
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", description);

    document
      .querySelector<HTMLLinkElement>('link[rel="canonical"]')
      ?.setAttribute("href", `${SITE_URL}${path === "/" ? "/" : path}`);
  }, [title, description, path, noindex]);
}

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
