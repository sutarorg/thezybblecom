import {
  Eyebrow,
  LandscapeStage,
  Reveal,
  SmartLink,
  ZybbleMark,
} from "../components/primitives";
import { AuthCta } from "../components/AuthCta";
import { FinalSearchCard } from "../components/product-cards";
import { CONTACT_EMAIL, FOOTER_COLS } from "../lib/site";

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.25 6.93 6.06-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.4Z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}

import { ArrowUp, Mail } from "lucide-react";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .3Z" />
    </svg>
  );
}

export function FinalCta() {
  return (
    <section
      aria-labelledby="final-cta-title"
      className="mt-28 sm:mt-36 md:mt-44"
    >
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal>
          <div className="grid w-full overflow-hidden rounded-[24px] bg-white ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:rounded-[28px] md:grid-cols-2">
            {/* copy */}
            <div className="flex flex-col items-start justify-center p-7 sm:p-10 lg:p-12">
              <Eyebrow>Get started</Eyebrow>
              <h2
                id="final-cta-title"
                className="font-display mt-4 text-balance text-[1.8rem] leading-[1.12] font-semibold tracking-[-0.03em] text-ink md:text-[2.05rem]"
              >
                Find the leads.
                <br className="hidden sm:block" /> Then get back to work.
              </h2>
              <p className="mt-4 max-w-sm text-pretty text-[14.5px] leading-7 text-ink-mute">
                Your next search is one sentence away. Describe the
                businesses, let Zybble build the list, and spend your time on
                the work that matters.
              </p>
              <div className="mt-7 flex flex-col items-start gap-3">
                <AuthCta className="px-5.5 py-2.5 text-[14px]" />
                <p className="text-[12px] text-ink-mute">
                  Free plan · 50 leads a month
                </p>
              </div>
            </div>

            {/* landscape visual */}
            <LandscapeStage
              position="center 48%"
              className="min-h-[300px] rounded-none ring-0 sm:min-h-[380px] sm:rounded-none md:min-h-[420px] border-t border-black/[0.05] md:border-t-0 md:border-l"
            >
              <div className="absolute inset-0 flex items-center justify-center p-5 sm:p-8">
                <FinalSearchCard className="max-w-[420px]" />
              </div>
            </LandscapeStage>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="mt-28 border-t border-black/[0.06] sm:mt-36">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-x-8 gap-y-10 py-12 sm:py-14 md:grid-cols-12">
          <div className="md:col-span-6">
            <SmartLink
              href="/#top"
              className="inline-flex items-center gap-2"
              ariaLabel="Zybble — back to top"
            >
              <ZybbleMark className="size-5.5" />
              <span className="font-display text-[15px] font-semibold tracking-[-0.02em]">
                Zybble
              </span>
            </SmartLink>
            <p className="mt-3.5 max-w-xs text-[13px] leading-6 text-ink-mute">
              AI-powered business lead discovery. Describe the businesses you
              need — get a list you can work.
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-4 inline-flex items-center gap-2 text-[13px] font-medium text-ink-soft transition-colors hover:text-brand-700"
            >
              <Mail className="size-3.5 text-neutral-400" aria-hidden="true" />
              {CONTACT_EMAIL}
            </a>
            <ul className="mt-6 flex items-center gap-2">
              {[
                { icon: XIcon, label: "Zybble on X" },
                { icon: LinkedInIcon, label: "Zybble on LinkedIn" },
                { icon: GitHubIcon, label: "Zybble on GitHub" },
              ].map((social) => (
                <li key={social.label}>
                  <SmartLink
                    href="/#top"
                    ariaLabel={social.label}
                    className="grid size-8 place-items-center rounded-full border border-black/[0.07] text-ink-mute transition-colors hover:border-ink/20 hover:text-ink"
                  >
                    <social.icon className="size-3" aria-hidden="true" />
                  </SmartLink>
                </li>
              ))}
            </ul>
          </div>

          {FOOTER_COLS.map((col) => (
            <nav
              key={col.title}
              aria-label={`Footer — ${col.title}`}
              className="md:col-span-2"
            >
              <h3 className="text-[11px] font-semibold tracking-[0.12em] text-ink-mute uppercase">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <SmartLink
                      href={link.href}
                      className="inline-block w-fit text-[13px] text-ink-mute transition-colors hover:text-ink"
                    >
                      {link.label}
                    </SmartLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-black/[0.05] py-6">
          <p className="text-[12px] text-ink-mute">
            © 2026 Zybble. All rights reserved.
          </p>
          <SmartLink
            href="/#top"
            className="group inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-mute transition-colors hover:text-ink"
          >
            Back to top
            <ArrowUp
              className="size-3.5 transition-transform duration-300 group-hover:-translate-y-0.5"
              aria-hidden="true"
            />
          </SmartLink>
        </div>
      </div>
    </footer>
  );
}
