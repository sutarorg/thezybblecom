import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { cn } from "../utils/cn";
import { FAQS } from "../lib/site";
import { Eyebrow, Reveal, SmartLink } from "../components/primitives";

function FaqItem({
  q,
  a,
  index,
  open,
  onToggle,
}: {
  q: string;
  a: string;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const buttonId = `faq-button-${index}`;
  const panelId = `faq-panel-${index}`;
  return (
    <li
      className={cn(
        "rounded-2xl border bg-white transition-colors duration-300",
        open ? "border-black/[0.09]" : "border-black/[0.05]"
      )}
    >
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
        >
          <span className="text-[14px] leading-5.5 font-medium text-ink">
            {q}
          </span>
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-full border transition-all duration-300",
              open
                ? "rotate-45 border-brand-600/20 bg-brand-50 text-brand-700"
                : "border-black/[0.08] text-ink-mute"
            )}
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </span>
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "[grid-template-rows:1fr]" : "[grid-template-rows:0fr]"
        )}
      >
        <div className="overflow-hidden">
          <p className="max-w-prose px-5 pb-5 text-[13.5px] leading-6.5 text-ink-mute">
            {a}
          </p>
        </div>
      </div>
    </li>
  );
}

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="mt-28 scroll-mt-20 sm:mt-36 md:mt-44"
    >
      <div className="mx-auto grid max-w-[1180px] gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            <Eyebrow>FAQ</Eyebrow>
            <h2
              id="faq-title"
              className="font-display mt-4 max-w-md text-balance text-[1.9rem] leading-[1.12] font-semibold tracking-[-0.03em] text-ink sm:text-[2.4rem]"
            >
              Questions. The ones people ask most.
            </h2>
            <p className="mt-4 max-w-sm text-pretty text-[15px] leading-7 text-ink-mute">
              Everything about searches, lead data, AI, and monthly limits.
              Something else on your mind? We're one message away.
            </p>
            <SmartLink
              href="/contact"
              className="group mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600"
            >
              Talk to us
              <ArrowRight
                className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </SmartLink>
          </div>
        </Reveal>

        <Reveal delay={100} className="lg:col-span-7">
          <ul className="space-y-2.5">
            {FAQS.map((faq, i) => (
              <FaqItem
                key={faq.q}
                q={faq.q}
                a={faq.a}
                index={i}
                open={openIndex === i}
                onToggle={() => setOpenIndex(openIndex === i ? null : i)}
              />
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
