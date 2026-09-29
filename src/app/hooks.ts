/* ------------------------------------------------------------------ */
/* Zybble app — hash routing + per-page SEO                            */
/* ------------------------------------------------------------------ */
import { useEffect, useState } from "react";
import { SITE_URL } from "../lib/site";

export function parseAppHash(): string {
  let h = window.location.hash.replace(/^#/, "");
  if (!h.startsWith("/")) h = "/" + h;
  h = h.split(/[?#]/)[0];
  return h === "" ? "/overview" : h;
}

export function useAppRoute() {
  const [path, setPath] = useState(parseAppHash);
  useEffect(() => {
    const on = () => {
      setPath(parseAppHash());
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return { path };
}

export function navigate(to: string) {
  window.location.hash = to.startsWith("#") ? to : `#${to}`;
}

/**
 * Marks a title/description as belonging to the `<app>/...` SPA.
 * Adds `#` to canonical URLs so marketing metadata stays intact.
 */
export function useAppSeo(title: string, description: string, path: string) {
  useEffect(() => {
    document.title = title;
    const set = (sel: string, content: string) =>
      document.head.querySelector<HTMLMetaElement>(sel)?.setAttribute("content", content);
    set('meta[name="description"]', description);
    set('meta[property="og:title"]', title);
    set('meta[property="og:description"]', description);
    set('meta[property="og:url"]', `${SITE_URL}/#${path}`);
    return () => {
      document.title = "Zybble — Find the businesses you need. Turn them into usable leads.";
    };
  }, [title, description, path]);
}