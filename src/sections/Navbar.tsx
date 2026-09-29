import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "../utils/cn";
import { NAV_LINKS } from "../lib/site";
import { ButtonGreen, SmartLink, ZybbleMark } from "../components/primitives";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b bg-paper transition-colors duration-300",
        scrolled
          ? "border-black/[0.06] bg-paper/85 backdrop-blur-md"
          : "border-transparent"
      )}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-14 max-w-[1180px] items-center justify-between px-5 sm:px-8"
      >
        <SmartLink
          href="/#top"
          className="flex items-center gap-2"
          ariaLabel="Zybble — back to top"
        >
          <ZybbleMark className="size-5.5" />
          <span className="font-display text-[15px] font-semibold tracking-[-0.02em]">
            Zybble
          </span>
        </SmartLink>

        <ul className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-0.5 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <SmartLink
                href={link.href}
                className="rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-black/[0.04] hover:text-ink"
              >
                {link.label}
              </SmartLink>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1.5">
          <SmartLink
            href="/contact"
            className="hidden rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink sm:block"
          >
            Contact
          </SmartLink>
          <ButtonGreen small href="/#pricing" className="hidden sm:inline-flex">
            Start for free
          </ButtonGreen>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid size-9 place-items-center rounded-full text-ink transition-colors hover:bg-black/[0.04] md:hidden"
          >
            {open ? (
              <X className="size-4.5" aria-hidden="true" />
            ) : (
              <Menu className="size-4.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </nav>

      {/* mobile menu */}
      <div
        id="mobile-menu"
        className={cn(
          "border-black/[0.06] bg-paper md:hidden",
          open ? "block border-t" : "hidden"
        )}
      >
        <ul className="space-y-1 px-5 py-4">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <SmartLink
                href={link.href}
                className="block rounded-xl px-3 py-2.5 text-[14px] font-medium text-ink-soft transition-colors hover:bg-black/[0.04] hover:text-ink"
              >
                {link.label}
              </SmartLink>
            </li>
          ))}
          <li>
            <SmartLink
              href="/contact"
              className="block rounded-xl px-3 py-2.5 text-[14px] font-medium text-ink-soft transition-colors hover:bg-black/[0.04] hover:text-ink"
            >
              Contact
            </SmartLink>
          </li>
          <li className="pt-2">
            <ButtonGreen href="/#pricing" className="w-full">
              Start for free
            </ButtonGreen>
          </li>
        </ul>
      </div>
    </header>
  );
}
