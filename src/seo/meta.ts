/**
 * Central SEO registry for every public, indexable Zybble page.
 *
 * One source of truth consumed by:
 *  - the build-time prerenderer (scripts/prerender.mjs via src/entry-prerender.tsx),
 *    which bakes these tags + JSON-LD into the static HTML Google crawls,
 *  - the runtime hook (usePageSeo) that keeps the document head correct
 *    during client-side navigation,
 *  - the generated sitemap.xml.
 *
 * Rules enforced here:
 *  - every canonical URL is absolute https://zybble.com/... (never a preview
 *    host, never a hash, never a trailing-slash variant),
 *  - every page gets a unique title + description,
 *  - structured data only describes content that is actually visible.
 */
import { SITE_URL, CONTACT_EMAIL } from "../lib/site";
import { POSTS, getPostBySlug, postWordCount, type BlogPost } from "../blog";

export type PageMeta = {
  /** Route path, e.g. "/" or "/blog/some-slug". Canonical = SITE_URL + path. */
  path: string;
  title: string;
  description: string;
  /** Site-relative social image; falls back to the default site card. */
  ogImage?: string;
  ogType?: "website" | "article";
  noindex?: boolean;
  /** JSON-LD objects describing the visible page content. */
  jsonLd?: Record<string, unknown>[];
  /** Raw extra head tags (build-time only), e.g. route-specific preloads. */
  extraHead?: string[];
};

export const DEFAULT_OG_IMAGE = "/blog/og/how-to-find-local-business-leads.jpg";

export function canonicalUrl(path: string): string {
  if (path === "/") return `${SITE_URL}/`;
  // one canonical form: no trailing slash, no params, no hash
  return `${SITE_URL}${path.replace(/\/+$/, "")}`;
}

export function absoluteUrl(pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${SITE_URL}${pathOrUrl}`;
}

/* ------------------------------------------------------------------ */
/* Shared structured-data entities                                     */
/* ------------------------------------------------------------------ */

const ORGANIZATION = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: "Zybble",
  url: `${SITE_URL}/`,
  logo: `${SITE_URL}/favicon.svg`,
  email: CONTACT_EMAIL,
  description:
    "Zybble is an AI-powered business lead discovery tool: describe the businesses you want in plain language and get an organized, exportable lead list.",
} as const;

const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: "Zybble",
  url: `${SITE_URL}/`,
  publisher: { "@id": `${SITE_URL}/#organization` },
} as const;

function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: canonicalUrl(item.path),
    })),
  };
}

function blogPostingJsonLd(post: BlogPost) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${canonicalUrl(`/blog/${post.slug}`)}#article`,
    mainEntityOfPage: canonicalUrl(`/blog/${post.slug}`),
    url: canonicalUrl(`/blog/${post.slug}`),
    headline: post.title,
    description: post.description,
    image: absoluteUrl(post.ogImage),
    datePublished: post.datePublished,
    dateModified: post.dateModified ?? post.datePublished,
    wordCount: postWordCount(post),
    articleSection: post.category,
    inLanguage: "en",
    author: {
      "@type": "Organization",
      name: "Zybble",
      url: `${SITE_URL}/`,
    },
    publisher: { "@id": `${SITE_URL}/#organization` },
    isPartOf: { "@id": `${SITE_URL}/blog#blog` },
  };
}

/* ------------------------------------------------------------------ */
/* Per-route metadata                                                  */
/* ------------------------------------------------------------------ */

export function homeMeta(): PageMeta {
  return {
    path: "/",
    title: "Zybble — Find the businesses you need. Turn them into usable leads.",
    description:
      "Zybble turns one plain-language request into an organized business lead list. Describe the businesses you want, get structured lead data, and export it as CSV.",
    ogType: "website",
    extraHead: [
      // The hero landscape is the homepage LCP candidate — only the
      // homepage should pay for preloading it.
      `<link rel="preconnect" href="https://i.ibb.co" crossorigin />`,
      `<link rel="preload" as="image" href="https://i.ibb.co/0jFFCfm3/Chat-GPT-Image-Sep-29-2026-07-01-04-PM.png" fetchpriority="high" />`,
    ],
    jsonLd: [
      { "@context": "https://schema.org", ...ORGANIZATION },
      { "@context": "https://schema.org", ...WEBSITE },
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Zybble",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description:
          "AI-powered business lead discovery. Describe the businesses you want in plain language, organize them into lead lists, enrich the data, and export it.",
        url: `${SITE_URL}/`,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "INR",
          description: "Free plan with 50 leads per month",
        },
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };
}

export function blogIndexMeta(): PageMeta {
  return {
    path: "/blog",
    title: "Zybble Blog — Practical guides to business lead discovery",
    description:
      "Practical guides to finding business leads: local lead sourcing, Google Maps prospecting, lead enrichment, list building, and B2B lead generation.",
    ogType: "website",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Blog",
        "@id": `${SITE_URL}/blog#blog`,
        name: "Zybble Blog",
        url: canonicalUrl("/blog"),
        description:
          "Practical guides to business lead discovery, prospecting, and lead data — written by the team building Zybble.",
        inLanguage: "en",
        publisher: { "@id": `${SITE_URL}/#organization` },
        blogPost: POSTS.map((post) => ({
          "@type": "BlogPosting",
          "@id": `${canonicalUrl(`/blog/${post.slug}`)}#article`,
          headline: post.title,
          url: canonicalUrl(`/blog/${post.slug}`),
          datePublished: post.datePublished,
          image: absoluteUrl(post.ogImage),
        })),
      },
      breadcrumbs([
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
      ]),
    ],
  };
}

export function blogPostMeta(post: BlogPost): PageMeta {
  return {
    path: `/blog/${post.slug}`,
    title: post.seoTitle,
    description: post.description,
    ogImage: post.ogImage,
    ogType: "article",
    jsonLd: [
      blogPostingJsonLd(post),
      breadcrumbs([
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
        { name: post.title, path: `/blog/${post.slug}` },
      ]),
    ],
  };
}

export function contactMeta(): PageMeta {
  return {
    path: "/contact",
    title: "Contact Zybble — Talk to us about lead discovery",
    description:
      "Questions about Zybble, pricing, or plans? One message reaches a human. Write to us and we'll get back to you within one business day.",
    ogType: "website",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "ContactPage",
        name: "Contact Zybble",
        url: canonicalUrl("/contact"),
        description: "Contact the Zybble team about the product, pricing, or support.",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };
}

export function privacyMeta(): PageMeta {
  return {
    path: "/privacy",
    title: "Privacy Policy — Zybble",
    description:
      "How Zybble collects, uses, stores, and deletes account and usage data — and the control you keep over your searches, lead lists, and exports.",
    ogType: "website",
  };
}

export function termsMeta(): PageMeta {
  return {
    path: "/terms",
    title: "Terms of Service — Zybble",
    description:
      "The contract for Zybble: your account, what the product provides, fair use of monthly limits, acceptable use, data ownership, and cancellation.",
    ogType: "website",
  };
}

/** Every route that gets prerendered to static HTML + listed in the sitemap. */
export function prerenderRoutes(): PageMeta[] {
  return [
    homeMeta(),
    blogIndexMeta(),
    ...POSTS.map((post) => blogPostMeta(post)),
    contactMeta(),
    privacyMeta(),
    termsMeta(),
  ];
}

/* ------------------------------------------------------------------ */
/* Head rendering (used by the build-time prerenderer)                 */
/* ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Serialize JSON-LD safely for inline <script> embedding. */
function jsonLdHtml(data: Record<string, unknown>): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/** Render the full per-route head block injected by the prerenderer. */
export function renderHeadTags(meta: PageMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const canonical = canonicalUrl(meta.path);
  const ogImage = absoluteUrl(meta.ogImage ?? DEFAULT_OG_IMAGE);
  const robots = meta.noindex ? "noindex, follow" : "index, follow, max-image-preview:large";

  const lines = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:type" content="${meta.ogType ?? "website"}" />`,
    `<meta property="og:site_name" content="Zybble" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${ogImage}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${ogImage}" />`,
    ...(meta.extraHead ?? []),
    ...(meta.jsonLd ?? []).map(jsonLdHtml),
  ];
  return lines.join("\n    ");
}

/* ------------------------------------------------------------------ */
/* Sitemap (generated at build time)                                   */
/* ------------------------------------------------------------------ */

export function renderSitemap(): string {
  const urls = prerenderRoutes()
    .filter((meta) => !meta.noindex)
    .map((meta) => {
      const slug = meta.path.startsWith("/blog/") ? meta.path.slice("/blog/".length) : null;
      const post = slug ? getPostBySlug(slug) : undefined;
      const lastmod = post ? `\n    <lastmod>${post.dateModified ?? post.datePublished}</lastmod>` : "";
      return `  <url>\n    <loc>${canonicalUrl(meta.path)}</loc>${lastmod}\n  </url>`;
    });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
    ``,
  ].join("\n");
}
