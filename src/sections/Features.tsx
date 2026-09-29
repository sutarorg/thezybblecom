import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "../utils/cn";
import {
  Eyebrow,
  LandscapeStage,
  Reveal,
  SectionHeading,
} from "../components/primitives";
import {
  FeatureIntelCard,
  FeatureListCard,
  FeatureRequestCard,
} from "../components/product-cards";

function FeatureBlock({
  eyebrow,
  title,
  copy,
  cta,
  reverse,
  position,
  children,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  cta?: { label: string; href: string };
  reverse?: boolean;
  position: string;
  children: ReactNode;
}) {
  return (
    <Reveal as="article">
      <div className="grid w-full overflow-hidden rounded-[24px] bg-white ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:rounded-[28px] md:grid-cols-2">
        {/* landscape + floating UI — ~50% of the block */}
        <LandscapeStage
          position={position}
          className={cn(
            "min-h-[320px] rounded-none ring-0 sm:min-h-[380px] sm:rounded-none md:min-h-[440px]",
            reverse && "md:order-2"
          )}
        >
          <div className="absolute inset-0 flex items-center justify-center p-5 sm:p-7">
            {children}
          </div>
        </LandscapeStage>

        {/* text — ~50% of the block */}
        <div
          className={cn(
            "flex flex-col items-start justify-center border-black/[0.05] p-7 sm:p-10 lg:p-12",
            reverse
              ? "border-t md:border-t-0 md:border-r"
              : "border-t md:border-t-0 md:border-l"
          )}
        >
          <Eyebrow>{eyebrow}</Eyebrow>
          <h3 className="font-display mt-4 text-balance text-[1.7rem] leading-[1.14] font-semibold tracking-[-0.03em] text-ink md:text-[2.05rem]">
            {title}
          </h3>
          <p className="mt-3.5 max-w-sm text-pretty text-[14.5px] leading-7 text-ink-mute">
            {copy}
          </p>
          {cta ? (
            <a
              href={cta.href}
              className="group mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600"
            >
              {cta.label}
              <ArrowRight
                className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </a>
          ) : null}
        </div>
      </div>
    </Reveal>
  );
}

export function Features() {
  return (
    <section
      id="product"
      aria-labelledby="product-title"
      className="mt-28 scroll-mt-20 sm:mt-36 md:mt-44"
    >
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <SectionHeading
          eyebrow="One request"
          title={
            <span id="product-title">
              One request.
              <br className="hidden sm:block" /> A whole lead list.
            </span>
          }
          copy="A single plain-language sentence becomes a real search — structured businesses, enriched details, saved into a list."
        />

        <div className="mt-14 grid gap-5 sm:mt-16 sm:gap-6 md:gap-8">
          {/* 1 — AI Lead Finder · text left, visual right */}
          <FeatureBlock
            eyebrow="AI Lead Finder"
            title="Describe the leads you want."
            copy="Tell Zybble the businesses, the location, the quantity, and any requirements. The sentence becomes a structured search you can see and adjust."
            cta={{ label: "Find leads", href: "/#pricing" }}
            position="center 62%"
          >
            <FeatureRequestCard className="max-w-[380px]" />
          </FeatureBlock>

          {/* 2 — Business discovery · visual left, text right */}
          <FeatureBlock
            eyebrow="Business discovery"
            title="Search businesses, not databases."
            copy="No queries, no columns, no exports to clean up. Every request comes back as structured business rows, ready to review at a glance."
            reverse
            position="center 40%"
          >
            <FeatureListCard className="max-w-[440px]" />
          </FeatureBlock>

          {/* 3 — Lead intelligence · text left, visual right */}
          <FeatureBlock
            eyebrow="Lead intelligence"
            title="Find leads. Understand them too."
            copy="Open any lead for the essentials — phone, website, rating, hours, email when available — then let Zybble AI summarize what the data means."
            cta={{ label: "See Zybble AI", href: "/#pricing" }}
            position="center 56%"
          >
            <FeatureIntelCard className="max-w-[400px]" />
          </FeatureBlock>
        </div>
      </div>
    </section>
  );
}
