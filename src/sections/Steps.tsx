import { cn } from "../utils/cn";
import { LANDSCAPE_URL } from "../lib/site";
import { Reveal, SectionHeading, SourceStrip } from "../components/primitives";
import {
  StepProgressCard,
  StepSearchCard,
  StepTableCard,
} from "../components/product-cards";

const STEPS = [
  {
    step: "Step 1",
    title: "Tell Zybble what you need",
    copy: "Businesses, location, requirements — said in one sentence, in your own words.",
    position: "center 68%",
    Card: StepSearchCard,
  },
  {
    step: "Step 2",
    title: "Let Zybble find them",
    copy: "Zybble searches business data, processes the results, and organizes usable leads.",
    position: "center 50%",
    Card: StepProgressCard,
  },
  {
    step: "Step 3",
    title: "Work your leads",
    copy: "Save them to a list, enrich them, analyze them with AI, or export them.",
    position: "center 38%",
    Card: StepTableCard,
  },
];

export function Steps() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="steps-title"
      className="mt-28 scroll-mt-20 sm:mt-36 md:mt-44"
    >
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <SectionHeading
          eyebrow="How it works"
          title={
            <span id="steps-title">
              Three steps. Then you're ready
              <br className="hidden sm:block" /> to work your leads.
            </span>
          }
          copy="No setup, no scraping scripts, no spreadsheets to untangle. Describe the businesses once — Zybble does the searching and the structuring."
        />

        {/* thin source row */}
        <Reveal delay={150}>
          <SourceStrip chips className="mt-9" />
        </Reveal>

        <div className="mt-12 grid gap-4 sm:mt-14 sm:gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal
              key={s.step}
              delay={i * 110}
              as="article"
              className="flex"
            >
              <div className="group flex h-full w-full flex-col overflow-hidden rounded-[26px] bg-white ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-transform duration-500 ease-out hover:-translate-y-1">
                <div className="relative min-h-[280px] overflow-hidden sm:min-h-[290px]">
                  <img
                    src={LANDSCAPE_URL}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.02]"
                    style={{ objectPosition: s.position }}
                  />
                  <s.Card className="absolute inset-x-5 top-1/2 w-auto -translate-y-1/2 sm:inset-x-6" />
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <p className="text-[11px] leading-4 font-semibold tracking-[0.12em] text-ink-mute uppercase">
                    {s.step}
                  </p>
                  <h3 className="font-display mt-3 text-balance text-[1.3rem] leading-[1.2] font-semibold tracking-[-0.025em] text-ink">
                    {s.title}
                  </h3>
                  <p
                    className={cn(
                      "mt-2.5 text-pretty text-[14px] leading-6.5 text-ink-mute"
                    )}
                  >
                    {s.copy}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
