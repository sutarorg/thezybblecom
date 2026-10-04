/**
 * Zybble blog — central content model.
 *
 * Articles are typed, structured data (not scattered JSX) so that:
 *  - the listing page, article page, sitemap, structured data, and
 *    prerendered HTML all read from one source of truth,
 *  - adding a future article is "add one file to src/blog/posts/",
 *  - reading time, tables of contents, and related-article links are
 *    derived automatically and can never drift out of sync.
 *
 * Inline text supports a deliberately tiny, safe markup subset rendered by
 * the blog's own renderer (never innerHTML): **bold** and [label](href).
 */

/** Tiny inline markup: `**bold**` and `[label](/internal-or-https-link)`. */
export type InlineText = string;

export type Block =
  /** Paragraph. */
  | { type: "p"; text: InlineText }
  /** Bulleted or numbered list. */
  | { type: "list"; ordered?: boolean; items: InlineText[] }
  /** Simple data table with a header row. */
  | { type: "table"; caption?: string; head: string[]; rows: InlineText[][] }
  /** Highlighted aside/tip box. */
  | { type: "callout"; title?: string; text: InlineText }
  /** Sub-heading (H3) inside a section. */
  | { type: "h3"; text: string };

/** One H2-level section; `id` feeds the table of contents and anchors. */
export type Section = {
  id: string;
  heading: string;
  blocks: Block[];
};

export type BlogAuthor = {
  /** Shown on the article; must reflect who actually maintains the content. */
  name: string;
  role: string;
};

export type BlogPost = {
  /** URL path segment: /blog/<slug>. Lowercase, hyphenated, stable. */
  slug: string;
  /** Visible H1. */
  title: string;
  /** <title> tag — may differ slightly from the H1 for clarity in SERPs. */
  seoTitle: string;
  /** Meta description (~150 chars, unique per article). */
  description: string;
  /** Short excerpt shown on the /blog listing cards. */
  excerpt: string;
  category: string;
  /** The one primary topic/intent this article targets. */
  primaryTopic: string;
  /** ISO dates (YYYY-MM-DD). dateModified only when genuinely updated. */
  datePublished: string;
  dateModified?: string;
  author: BlogAuthor;
  /** Display thumbnail (WebP, 1280×720) under /public. */
  thumbnail: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  thumbnailAlt: string;
  /** Social-card image (JPG, 1200×630) under /public — absolute-safe path. */
  ogImage: string;
  /** Deck: short summary paragraphs rendered between H1 and the hero. */
  intro: InlineText[];
  sections: Section[];
  /** Slugs of related articles (rendered + used for internal linking). */
  related: string[];
};
