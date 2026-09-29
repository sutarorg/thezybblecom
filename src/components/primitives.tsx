import {
  type ReactNode,
  type CSSProperties,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  Database,
  FileDown,
  Globe,
  Mail,
  MapPinned,
  Phone,
  Sparkles,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "../utils/cn";
import { LANDSCAPE_URL, LANDSCAPE_ALT } from "../lib/site";

/* ------------------------------------------------------------------ */
/* Link helpers — clean paths only, no hash URLs                       */
/* ------------------------------------------------------------------ */

/** Smoothly scroll to a section id without ever writing "#" to the URL. */
export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return false;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  return true;
}

function parseTarget(href: string) {
  // "#pricing"  → section on the current page
  // "/#pricing" → home page, then section
  // "/contact"  → route
  // "mailto:"   → external
  if (href.startsWith("#")) return { kind: "section" as const, id: href.slice(1), path: "/" };
  if (href.startsWith("/#")) return { kind: "home-section" as const, id: href.slice(2), path: "/" };
  if (/^(https?:|mailto:|tel:)/.test(href)) return { kind: "external" as const, id: "", path: href };
  return { kind: "route" as const, id: "", path: href };
}

/**
 * Renders a real-path link. Section links scroll in place (or navigate
 * home first) and never leave a "#" fragment in the address bar.
 */
export function SmartLink({
  href,
  className,
  children,
  ariaLabel,
  onClick,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  onClick?: () => void;
}) {
  const target = parseTarget(href);
  const navigate = useNavigate();
  const location = useLocation();

  if (target.kind === "external") {
    const external = /^https?:/.test(href);
    return (
      <a
        href={href}
        className={className}
        aria-label={ariaLabel}
        onClick={onClick}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {children}
      </a>
    );
  }

  if (target.kind === "route") {
    return (
      <Link to={target.path} className={className} aria-label={ariaLabel} onClick={onClick}>
        {children}
      </Link>
    );
  }

  // section / home-section
  return (
    <a
      href={target.path === "/" && location.pathname === "/" ? `/${""}` : target.path}
      className={className}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
        if (location.pathname === "/") {
          scrollToSection(target.id);
        } else {
          navigate("/", { state: { scrollTo: target.id } });
        }
      }}
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */
export function ButtonGreen({
  children,
  href = "#pricing",
  className,
  small,
}: {
  children: ReactNode;
  href?: string;
  className?: string;
  small?: boolean;
}) {
  return (
    <SmartLink
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full bg-brand-600 font-medium text-white",
        "shadow-[0_1px_2px_rgba(11,99,67,0.25),inset_0_1px_0_rgba(255,255,255,0.14)]",
        "transition-all duration-200 hover:bg-brand-700 hover:shadow-[0_4px_12px_-2px_rgba(11,99,67,0.4)] active:scale-[0.98]",
        small ? "px-4 py-2 text-[13px]" : "px-5.5 py-2.5 text-sm",
        className
      )}
    >
      {children}
    </SmartLink>
  );
}

export function ButtonGhost({
  children,
  href,
  className,
}: {
  children: ReactNode;
  href: string;
  className?: string;
}) {
  return (
    <SmartLink
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full border border-line bg-white px-5.5 py-2.5 text-sm font-medium text-ink",
        "transition-colors duration-200 hover:border-ink/20 hover:bg-neutral-50",
        className
      )}
    >
      {children}
    </SmartLink>
  );
}

/* ------------------------------------------------------------------ */
/* Type helpers                                                        */
/* ------------------------------------------------------------------ */
export function Eyebrow({
  children,
  center,
  className,
}: {
  children: ReactNode;
  center?: boolean;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute",
        center && "justify-center",
        className
      )}
    >
      <span className="size-1 rounded-full bg-brand-600" aria-hidden="true" />
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  copy,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  copy?: string;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-2xl text-center", className)}>
      <Reveal>
        <Eyebrow center>{eyebrow}</Eyebrow>
      </Reveal>
      <Reveal delay={70}>
        <h2 className="font-display mt-4 text-[1.9rem] leading-[1.12] font-semibold tracking-[-0.03em] text-ink text-balance sm:text-[2.4rem] md:text-[2.6rem]">
          {title}
        </h2>
      </Reveal>
      {copy ? (
        <Reveal delay={130}>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-ink-mute text-pretty">
            {copy}
          </p>
        </Reveal>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reveal on scroll                                                    */
/* ------------------------------------------------------------------ */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "article" | "li" | "span" | "p" | "h2" | "h3" | "aside";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={cn("reveal", visible && "is-visible", className)}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Landscape stage — the recurring image + floating UI composition     */
/* ------------------------------------------------------------------ */
export function LandscapeStage({
  children,
  position = "center 62%",
  className,
  eager,
  alt,
}: {
  children: ReactNode;
  /** object-position for the shared landscape */
  position?: string;
  className?: string;
  eager?: boolean;
  alt?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[22px] ring-1 ring-black/[0.06] sm:rounded-[26px]",
        className
      )}
    >
      <img
        src={LANDSCAPE_URL}
        alt={alt ?? ""}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={eager ? "high" : "auto"}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: position }}
      />
      {/* gentle top light so white UI always reads cleanly */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.06] via-transparent to-black/[0.05]"
        aria-hidden="true"
      />
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Floating white product card inside the landscape                    */
/* ------------------------------------------------------------------ */
export function UiCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-black/[0.07] bg-white shadow-ui",
        className
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tiny app chrome dot                                                 */
/* ------------------------------------------------------------------ */
export function StatusDot({ className }: { className?: string }) {
  return (
    <span
      className={cn("relative inline-flex size-1.5 rounded-full", className)}
      aria-hidden="true"
    >
      <span className="absolute inline-flex size-full rounded-full bg-current opacity-40 pulse-dot" />
      <span className="relative inline-flex size-1.5 rounded-full bg-current" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Tiny source strip — muted product/data indicators, not buttons      */
/* ------------------------------------------------------------------ */
const SOURCES_CORE: { icon: LucideIcon; label: string }[] = [
  { icon: MapPinned, label: "Google Maps" },
  { icon: Database, label: "Business data" },
  { icon: Globe, label: "Websites" },
  { icon: Phone, label: "Phone" },
  { icon: Mail, label: "Email" },
  { icon: Sparkles, label: "Zybble AI" },
  { icon: FileDown, label: "CSV" },
];

export function SourceStrip({
  chips,
  className,
  labels,
}: {
  chips?: boolean;
  className?: string;
  labels?: { icon: LucideIcon; label: string }[];
}) {
  const items = labels ?? SOURCES_CORE;
  return (
    <ul
      aria-label="Zybble data sources"
      className={cn(
        "flex flex-wrap items-center justify-center",
        chips ? "gap-1.5" : "gap-x-5 gap-y-2",
        className
      )}
    >
      {items.map((item) =>
        chips ? (
          <li
            key={item.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.05] bg-white px-3 py-1.5 text-[11.5px] font-medium text-ink-mute"
          >
            <item.icon className="size-3.5 text-neutral-400" aria-hidden="true" />
            {item.label}
          </li>
        ) : (
          <li
            key={item.label}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-neutral-400"
          >
            <item.icon className="size-3.5 text-neutral-300" aria-hidden="true" />
            {item.label}
          </li>
        )
      )}
    </ul>
  );
}

export function ZybbleMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-[7px] bg-brand-600 text-white",
        className
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[60%]"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.7-4.7" />
        <path d="M8.5 11h5" />
      </svg>
    </span>
  );
}

export { LANDSCAPE_ALT };
