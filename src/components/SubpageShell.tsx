import type { ReactNode } from "react";
import { Navbar } from "../sections/Navbar";
import { Footer } from "../sections/Closing";
import { Eyebrow, Reveal } from "./primitives";

/**
 * Shared frame for static subpages (contact / privacy / terms).
 * Same navbar, footer, container, spacing and type system as the home page.
 */
export function SubpageShell({
  eyebrow,
  title,
  intro,
  children,
  narrow = true,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <>
      <Navbar />
      <main id="main" className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <header
          className={
            narrow
              ? "mx-auto max-w-[720px] pt-16 sm:pt-20 md:pt-24"
              : "pt-16 sm:pt-20 md:pt-24"
          }
        >
          <Reveal>
            <Eyebrow>{eyebrow}</Eyebrow>
          </Reveal>
          <Reveal delay={70}>
            <h1 className="font-display mt-4 text-balance text-[2.15rem] leading-[1.08] font-semibold tracking-[-0.04em] text-ink min-[480px]:text-[2.8rem] sm:text-6xl sm:leading-[1.04]">
              {title}
            </h1>
          </Reveal>
          <Reveal delay={130}>
            <p className="mt-5 max-w-xl text-pretty text-[15px] leading-7 text-ink-mute sm:text-[16px]">
              {intro}
            </p>
          </Reveal>
        </header>
        {children}
      </main>
      <Footer />
    </>
  );
}
