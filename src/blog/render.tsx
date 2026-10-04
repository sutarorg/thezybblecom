import type { ReactNode } from "react";
import { SmartLink } from "../components/primitives";
import type { Block, InlineText, Section } from "./types";

/* ------------------------------------------------------------------ */
/* Inline markup — **bold** and [label](href), rendered as React nodes */
/* (never innerHTML). Internal links go through SmartLink so homepage  */
/* section anchors (/#pricing) and routes both work from any page.     */
/* ------------------------------------------------------------------ */
const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;

export function Inline({ text }: { text: InlineText }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    if (match[1] && match[2]) {
      nodes.push(
        <SmartLink
          key={key++}
          href={match[2]}
          className="font-medium text-brand-700 underline decoration-brand-600/30 underline-offset-[3px] transition-colors hover:text-brand-600 hover:decoration-brand-600/60"
        >
          {match[1]}
        </SmartLink>,
      );
    } else if (match[3]) {
      nodes.push(
        <strong key={key++} className="font-semibold text-ink">
          {match[3]}
        </strong>,
      );
    }
    cursor = index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "p":
      return (
        <p className="mt-5 text-[15px] leading-7.5 text-ink-soft sm:text-[15.5px] sm:leading-8">
          <Inline text={block.text} />
        </p>
      );
    case "h3":
      return (
        <h3 className="font-display mt-8 text-[17px] font-semibold tracking-[-0.015em] text-ink sm:text-[18px]">
          {block.text}
        </h3>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={block.ordered ? "mt-5 list-none space-y-3 [counter-reset:blog-li]" : "mt-5 space-y-3"}>
          {block.items.map((item, i) => (
            <li
              key={i}
              className="flex gap-3 text-[15px] leading-7.5 text-ink-soft sm:text-[15.5px] sm:leading-8"
            >
              {block.ordered ? (
                <span
                  className="mt-[5px] grid size-5.5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
              ) : (
                <span className="mt-[14px] size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
              )}
              <span>
                <Inline text={item} />
              </span>
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <table className="w-full min-w-[560px] border-collapse text-left">
            {block.caption ? <caption className="sr-only">{block.caption}</caption> : null}
            <thead>
              <tr className="border-b border-black/[0.06]">
                {block.head.map((cell, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="px-4 py-3 text-[11.5px] font-semibold tracking-[0.06em] text-ink-mute uppercase"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className={r < block.rows.length - 1 ? "border-b border-black/[0.04]" : ""}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={
                        c === 0
                          ? "px-4 py-3 text-[13px] leading-5.5 font-medium text-ink"
                          : "px-4 py-3 text-[13px] leading-5.5 text-ink-mute"
                      }
                    >
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return (
        <aside className="mt-6 rounded-2xl border border-brand-600/15 bg-brand-50/60 px-5 py-4.5 sm:px-6 sm:py-5">
          {block.title ? (
            <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.1em] text-brand-700 uppercase">
              <span className="size-1 rounded-full bg-brand-600" aria-hidden="true" />
              {block.title}
            </p>
          ) : null}
          <p className="mt-2 text-[14.5px] leading-7 text-ink-soft">
            <Inline text={block.text} />
          </p>
        </aside>
      );
  }
}

export function SectionView({ section }: { section: Section }) {
  return (
    <section aria-labelledby={`${section.id}-h`}>
      <h2
        id={section.id}
        className="font-display mt-12 scroll-mt-24 text-[22px] leading-[1.25] font-semibold tracking-[-0.025em] text-ink sm:text-[25px] first:mt-0"
      >
        <span id={`${section.id}-h`}>{section.heading}</span>
      </h2>
      {section.blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </section>
  );
}
