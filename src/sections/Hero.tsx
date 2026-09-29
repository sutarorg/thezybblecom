import { Sparkles } from "lucide-react";
import { LandscapeStage, Reveal } from "../components/primitives";
import { AuthCta } from "../components/AuthCta";
import { HeroAppCard } from "../components/product-cards";
import { LANDSCAPE_ALT } from "../lib/site";

const AVATARS = [
  "https://i.pravatar.cc/48?img=12",
  "https://i.pravatar.cc/48?img=32",
  "https://i.pravatar.cc/48?img=47",
  "https://i.pravatar.cc/48?img=5",
  "https://i.pravatar.cc/48?img=56",
];

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="overflow-x-clip">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="pt-16 text-center sm:pt-20 md:pt-24">
          {/* eyebrow pill */}
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-black/[0.07] bg-white px-3.5 py-1.5 text-[12px] font-medium text-ink-soft shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <Sparkles className="size-3.5 text-brand-600" aria-hidden="true" />
              AI-powered business discovery
            </p>
          </Reveal>

          {/* two-line headline */}
          <Reveal delay={80}>
            <h1
              id="hero-title"
              className="font-display mx-auto mt-6 max-w-4xl text-[2.15rem] leading-[1.08] font-semibold tracking-[-0.045em] text-ink min-[480px]:text-[2.8rem] sm:text-6xl md:text-7xl md:leading-[1.02]"
            >
              <span className="block">Find the businesses you need.</span>
              <span className="block font-light text-neutral-500">
                Turn them into usable leads.
              </span>
            </h1>
          </Reveal>

          {/* supporting copy — 2–3 short lines */}
          <Reveal delay={160}>
            <p className="mx-auto mt-5 max-w-xl text-balance text-[15px] leading-7 text-ink-mute sm:text-[16px]">
              Tell Zybble which businesses you need. It discovers them,
              organizes them into lead lists, enriches the details, and helps
              you understand every prospect with AI.
            </p>
          </Reveal>

          {/* CTA + supporting line */}
          <Reveal delay={230}>
            <div className="mt-7 flex flex-col items-center gap-3">
              <AuthCta className="px-5.5 py-2.5 text-[14px]" />
              <div className="flex items-center gap-2.5">
                <div className="flex -space-x-2" aria-hidden="true">
                  {AVATARS.map((src) => (
                    <img
                      key={src}
                      src={src}
                      alt=""
                      width={24}
                      height={24}
                      loading="lazy"
                      decoding="async"
                      className="size-6 rounded-full object-cover ring-2 ring-paper"
                    />
                  ))}
                </div>
                <p className="text-[12px] text-ink-mute">
                  <span className="font-semibold text-ink-soft">495+</span>{" "}
                  people use it
                </p>
              </div>
            </div>
          </Reveal>

          {/* tiny trust/product line */}
          <Reveal delay={280}>
            <p className="mt-6 text-[12px] font-medium text-neutral-400">
              Natural-language search · Structured lead data · CSV export
            </p>
          </Reveal>
        </div>

        {/* large product visualization — intentionally not animated */}
        <div className="mt-12 sm:mt-16">
          <div className="relative w-full">
            <LandscapeStage
              eager
              alt={LANDSCAPE_ALT}
              position="center 55%"
              className="aspect-[5/6] shadow-panel min-[480px]:aspect-[16/12] sm:aspect-[16/10] lg:aspect-[16/9.5]"
            >
              <div className="absolute inset-0 flex items-end justify-center p-3.5 pb-6 min-[480px]:items-center min-[480px]:p-6 sm:p-9">
                <HeroAppCard className="max-w-[680px] min-[480px]:-translate-y-1" />
              </div>
            </LandscapeStage>
            <p className="mt-4 text-center text-[11.5px] text-ink-mute">
              Product preview · businesses shown are illustrative demo data
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
