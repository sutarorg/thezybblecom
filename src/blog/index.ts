/**
 * Zybble blog — single registry.
 *
 * Every consumer (listing page, article pages, prerenderer, sitemap,
 * structured data) imports from here, so the set of published articles has
 * exactly one definition. To publish a new article: add a file to
 * src/blog/posts/ and list it in POSTS below — routes, sitemap entries,
 * metadata, and related-article links all follow automatically.
 */
import type { BlogPost, Block } from "./types";
import { post as localLeads } from "./posts/how-to-find-local-business-leads";
import { post as b2bGuide } from "./posts/b2b-lead-generation-guide";
import { post as enrichment } from "./posts/what-is-lead-enrichment";
import { post as leadList } from "./posts/how-to-build-a-b2b-lead-list";
import { post as mapsLeads } from "./posts/how-to-get-leads-from-google-maps";

export type { BlogPost, Block, Section } from "./types";

/** Listing order: featured article first. */
export const POSTS: BlogPost[] = [
  localLeads,
  b2bGuide,
  mapsLeads,
  leadList,
  enrichment,
];

export const FEATURED_POST = POSTS[0]!;

export function getPostBySlug(slug: string): BlogPost | undefined {
  return POSTS.find((post) => post.slug === slug);
}

export function getRelatedPosts(post: BlogPost): BlogPost[] {
  return post.related
    .map((slug) => getPostBySlug(slug))
    .filter((p): p is BlogPost => Boolean(p));
}

/* ------------------------------------------------------------------ */
/* Derived data                                                        */
/* ------------------------------------------------------------------ */

function blockWords(block: Block): number {
  switch (block.type) {
    case "p":
    case "callout":
      return countWords((block.type === "callout" ? (block.title ?? "") + " " : "") + block.text);
    case "list":
      return block.items.reduce((sum, item) => sum + countWords(item), 0);
    case "table":
      return block.rows.flat().reduce((sum, cell) => sum + countWords(cell), countWords(block.head.join(" ")));
    case "h3":
      return countWords(block.text);
  }
}

function countWords(text: string): number {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

export function postWordCount(post: BlogPost): number {
  const intro = post.intro.reduce((sum, p) => sum + countWords(p), 0);
  const body = post.sections.reduce(
    (sum, section) =>
      sum + countWords(section.heading) + section.blocks.reduce((s, b) => s + blockWords(b), 0),
    0,
  );
  return intro + body + countWords(post.title);
}

/** Estimated reading time in minutes (≈220 wpm, floor 1). */
export function readingTimeMinutes(post: BlogPost): number {
  return Math.max(1, Math.round(postWordCount(post) / 220));
}

/** Format an ISO date (YYYY-MM-DD) for display, e.g. "October 4, 2026". */
export function formatPostDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Table-of-contents entries (H2 sections only — stable anchors). */
export function tableOfContents(post: BlogPost): { id: string; heading: string }[] {
  return post.sections.map((section) => ({ id: section.id, heading: section.heading }));
}
