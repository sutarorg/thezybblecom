import type { AnswerBlock, Intent } from "./knowledge";

/**
 * Compact authoring format for the assistant knowledge base.
 *
 * Answer line syntax:
 *   "# Heading"   → small uppercase heading
 *   "- list item" → bullet (consecutive bullets group into one list)
 *   anything else → paragraph
 * Inline **bold** is supported everywhere.
 */
export type Compact = {
  id: string;
  /** Suggestion button label */
  q: string;
  /** Semantic topic */
  c: string;
  /** Space-separated association keywords */
  k: string;
  /** Answer lines */
  a: string[];
  /** [label, href] */
  cta?: [string, string];
  /** Follow-up intent ids (unknown ids are ignored by the engine) */
  f?: string[];
};

export function expand(entry: Compact): Intent {
  const answer: AnswerBlock[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length) {
      answer.push({ type: "list", items: bullets });
      bullets = [];
    }
  };

  for (const line of entry.a) {
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    flush();
    if (line.startsWith("# ")) {
      answer.push({ type: "heading", text: line.slice(2) });
    } else {
      answer.push({ type: "p", text: line });
    }
  }
  flush();

  return {
    id: entry.id,
    question: entry.q,
    category: entry.c,
    keywords: entry.k.split(/\s+/).filter(Boolean),
    answer,
    cta: entry.cta ? { label: entry.cta[0], href: entry.cta[1] } : undefined,
    follow: entry.f ?? [],
  };
}
