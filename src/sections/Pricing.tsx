import { Check } from "lucide-react";
import { cn } from "../utils/cn";
import { PLANS } from "../lib/site";
import { Reveal, SectionHeading, SourceStrip } from "../components/primitives";

export function Pricing() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="mt-28 scroll-mt-20 sm:mt-36 md:mt-44"
    >
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <SectionHeading
          eyebrow="Pricing"
          title={
            <span id="pricing-title">
              Simple pricing.
              <br className="hidden sm:block" /> Built around leads.
            </span>
          }
          copy="Pay for how much lead discovery you need. Monthly plans only — no long commitments."
        />

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan, i) => (
            <Reveal as="li" key={plan.name} delay={i * 80} className="h-full">
              <div
                className={cn(
                  "relative flex h-full flex-col rounded-2xl bg-white p-6",
                  plan.popular
                    ? "shadow-ui-sm ring-2 ring-brand-600"
                    : "ring-1 ring-black/[0.06]"
                )}
              >
                {plan.popular ? (
                  <p className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-[10px] font-semibold tracking-wide text-white uppercase">
                    Most popular
                  </p>
                ) : null}

                <h3 className="text-[15px] font-semibold text-ink">
                  {plan.name}
                </h3>
                <p className="mt-4 flex items-baseline gap-1">
                  <span className="font-display text-[2.1rem] leading-none font-semibold tracking-[-0.03em]">
                    ${plan.price}
                  </span>
                  <span className="text-[13px] text-ink-mute">/mo</span>
                </p>
                <p className="mt-2.5 min-h-10 text-[13px] leading-5.5 text-ink-mute">
                  {plan.blurb}
                </p>

                <div className="my-5 h-px bg-black/[0.06]" aria-hidden="true" />

                <ul className="space-y-2.5">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-[13px] leading-5 text-ink-soft"
                    >
                      <Check
                        className="mt-0.5 size-3.5 shrink-0 text-brand-600"
                        aria-hidden="true"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-6">
                  <a
                    href="/signup"
                    aria-label={`Start for free on the ${plan.name} plan`}
                    className={cn(
                      "inline-flex w-full items-center justify-center rounded-full bg-brand-600 py-2.5 text-[13px] font-medium text-white transition-all duration-200 hover:bg-brand-700",
                      plan.popular &&
                        "shadow-[0_4px_12px_-2px_rgba(11,99,67,0.4)]"
                    )}
                  >
                    {plan.cta}
                  </a>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>

        <Reveal delay={120}>
          <p className="mt-8 text-center text-[12px] text-ink-mute">
            All plans billed monthly. Lead allowances reset at the start of each
            monthly cycle.
          </p>
        </Reveal>

        {/* tiny data strip */}
        <Reveal delay={160}>
          <SourceStrip chips className="mt-8" />
        </Reveal>
      </div>
    </section>
  );
}
