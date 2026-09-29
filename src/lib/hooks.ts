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
      ?.setAttribute("href", `${SITE_URL}${path}`);
  }, [title, description, path, noindex]);
}

/**
 * Scroll to top on route change; honor /#section deep links by
 * smoothly anchoring to the element when present.
 */
export function useScrollToHash() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      // wait for the new page to paint before anchoring
      requestAnimationFrame(() => {
        let el: Element | null = null;
        try {
          el = document.querySelector(hash);
        } catch {
          el = null;
        }
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          window.setTimeout(() => {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 120);
        } else {
          window.scrollTo({ top: 0, behavior: "auto" });
        }
      });
      return;
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname, hash]);
}
