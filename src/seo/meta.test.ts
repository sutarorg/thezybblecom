import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  blogPostMeta,
  canonicalUrl,
  prerenderRoutes,
  renderHeadTags,
  renderSitemap,
} from "./meta";
import { POSTS, getPostBySlug, readingTimeMinutes } from "../blog";

const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

describe("SEO route registry", () => {
  const routes = prerenderRoutes();

  it("covers every public page exactly once", () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/blog");
    expect(paths).toContain("/contact");
    expect(paths).toContain("/privacy");
    expect(paths).toContain("/terms");
    for (const post of POSTS) expect(paths).toContain(`/blog/${post.slug}`);
    expect(new Set(paths).size).toBe(paths.length);
    // never prerender/index private app or auth routes
    for (const forbidden of ["/login", "/signup", "/overview", "/find", "/billing"]) {
      expect(paths).not.toContain(forbidden);
    }
  });

  it("gives every route a unique title and unique description", () => {
    const titles = routes.map((r) => r.title);
    const descriptions = routes.map((r) => r.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const route of routes) {
      expect(route.title.length).toBeGreaterThan(15);
      expect(route.description.length).toBeGreaterThan(50);
      expect(route.description.length).toBeLessThanOrEqual(170);
    }
  });

  it("produces clean HTTPS production canonicals (no slashes, hashes, params)", () => {
    for (const route of routes) {
      const canonical = canonicalUrl(route.path);
      expect(canonical).toMatch(/^https:\/\/zybble\.com\//);
      expect(canonical).not.toMatch(/[#?]/);
      if (route.path !== "/") expect(canonical).not.toMatch(/\/$/);
      expect(canonical).not.toMatch(/localhost|vercel\.app/);
    }
  });

  it("renders complete head tags with escaped values and JSON-LD", () => {
    const post = POSTS[0]!;
    const head = renderHeadTags(blogPostMeta(post));
    expect(head).toContain(`<title>${post.seoTitle}</title>`);
    expect(head).toContain('name="description"');
    expect(head).toContain('rel="canonical"');
    expect(head).toContain('property="og:image" content="https://zybble.com/blog/og/');
    expect(head).toContain('name="twitter:card" content="summary_large_image"');
    expect(head).toContain('"@type":"BlogPosting"');
    expect(head).toContain('"@type":"BreadcrumbList"');
    // We deliberately do not rely on FAQ rich results (removed by Google
    // for most sites as of May 2026) — no FAQPage markup anywhere.
    expect(head).not.toContain("FAQPage");
  });

  it("article structured data matches the visible article facts", () => {
    for (const post of POSTS) {
      const meta = blogPostMeta(post);
      const article = meta.jsonLd!.find((o) => o["@type"] === "BlogPosting") as Record<string, unknown>;
      expect(article.headline).toBe(post.title);
      expect(article.datePublished).toBe(post.datePublished);
      expect(article.image).toBe(`https://zybble.com${post.ogImage}`);
      expect(article.url).toBe(`https://zybble.com/blog/${post.slug}`);
    }
  });

  it("generates a sitemap that lists every indexable route", () => {
    const sitemap = renderSitemap();
    for (const route of routes) {
      expect(sitemap).toContain(`<loc>${canonicalUrl(route.path)}</loc>`);
    }
    expect(sitemap).not.toContain("/login");
    expect(sitemap).not.toContain("/overview");
    expect(sitemap.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`)).toBe(true);
  });
});

describe("Blog content model", () => {
  it("has exactly five launch articles with unique, clean slugs", () => {
    expect(POSTS.length).toBe(5);
    const slugs = POSTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(5);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("every article is substantial and fully attributed", () => {
    for (const post of POSTS) {
      expect(post.title.length).toBeGreaterThan(20);
      expect(post.sections.length).toBeGreaterThanOrEqual(5);
      expect(readingTimeMinutes(post)).toBeGreaterThanOrEqual(4);
      expect(post.author.name.length).toBeGreaterThan(0);
      expect(post.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(post.thumbnailAlt.length).toBeGreaterThan(30);
      expect(post.excerpt.length).toBeGreaterThan(50);
    }
  });

  it("thumbnail and social image assets exist with correct dimensions declared", () => {
    for (const post of POSTS) {
      expect(existsSync(`${publicDir}${post.thumbnail}`)).toBe(true);
      expect(existsSync(`${publicDir}${post.ogImage}`)).toBe(true);
      expect(post.thumbnailWidth).toBe(1280);
      expect(post.thumbnailHeight).toBe(720);
    }
  });

  it("related links and inline internal links always resolve", () => {
    const validPaths = new Set([
      "/",
      "/blog",
      "/contact",
      "/privacy",
      "/terms",
      "/#product",
      "/#how-it-works",
      "/#pricing",
      "/#faq",
      ...POSTS.map((p) => `/blog/${p.slug}`),
    ]);
    for (const post of POSTS) {
      expect(post.related.length).toBeGreaterThanOrEqual(2);
      for (const slug of post.related) {
        expect(getPostBySlug(slug), `related "${slug}" in ${post.slug}`).toBeDefined();
        expect(slug).not.toBe(post.slug);
      }
      const text = JSON.stringify(post);
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const href = match[1]!;
        if (href.startsWith("http")) continue;
        expect(validPaths.has(href), `link "${href}" in ${post.slug}`).toBe(true);
      }
    }
  });

  it("every section id is unique within its article (stable TOC anchors)", () => {
    for (const post of POSTS) {
      const ids = post.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
