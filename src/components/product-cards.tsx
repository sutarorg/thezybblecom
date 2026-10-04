/**
 * Tiny, authentic-feeling slices of the Zybble product.
 * One visual family: white, softly rounded, thin border, small green accents.
 * All records are illustrative demo data.
 */
import {
  ArrowUpRight,
  Building2,
  Check,
  Clock,
  Download,
  FileDown,
  Filter,
  Globe,
  ListChecks,
  Loader2,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Search,
  Sparkles,
  Star,
  Tag,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import { DEMO_DENTISTS, type DemoBusiness } from "../lib/site";
import { StatusDot, UiCard, ZybbleMark } from "./primitives";

/* ---------------------------------------------------------------- */
/* Shared bits                                                       */
/* ---------------------------------------------------------------- */
function TinyLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[9.5px] font-semibold uppercase tracking-[0.12em] text-neutral-400",
        className
      )}
    >
      {children}
    </p>
  );
}

function Chip({
  icon,
  children,
  active,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] font-medium whitespace-nowrap",
        active
          ? "border-brand-600/20 bg-brand-50 text-brand-700"
          : "border-black/[0.07] bg-neutral-50 text-ink-soft",
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function Stars({
  rating,
  reviews,
}: {
  rating: number;
  reviews?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
      <span className="text-[11px] font-semibold text-ink">
        {rating.toFixed(1)}
      </span>
      {reviews !== undefined && (
        <span className="text-[10px] text-neutral-400">({reviews})</span>
      )}
    </span>
  );
}

function BizAvatar({ biz, className }: { biz: DemoBusiness; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md text-[8.5px] font-bold tracking-wide",
        biz.tint,
        className
      )}
      aria-hidden="true"
    >
      {biz.initials}
    </span>
  );
}

function StatusPill({ status }: { status: DemoBusiness["status"] }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[9.5px] font-medium",
        status === "Enriched" && "bg-brand-50 text-brand-700",
        status === "New" && "bg-neutral-100 text-ink-soft",
        status === "Contacted" && "bg-amber-50 text-amber-700"
      )}
    >
      {status === "Enriched" && <Check className="size-2.5" aria-hidden="true" />}
      {status}
    </span>
  );
}

function GreenMiniButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-[10.5px] font-medium text-white",
        className
      )}
    >
      {children}
    </span>
  );
}

function CardHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-b border-black/[0.05] px-3.5 py-2.5",
        className
      )}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* HERO — the full app window                                        */
/* ---------------------------------------------------------------- */
export function HeroAppCard({ className }: { className?: string }) {
  const rows = DEMO_DENTISTS.slice(0, 4);
  return (
    <UiCard className={cn("w-full overflow-hidden", className)}>
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-black/[0.05] px-3.5 py-2.5 sm:px-5 sm:py-3">
        <ZybbleMark className="size-4.5 sm:size-5" />
        <p className="font-display text-[12px] font-semibold tracking-tight sm:text-[13px]">
          Zybble
        </p>
        <span className="hidden text-[11px] text-neutral-400 min-[420px]:inline">
          / New search
        </span>
        <Chip active className="ml-auto">
          <StatusDot className="text-brand-600" />
          500 leads found
        </Chip>
      </div>

      <div className="p-3.5 sm:p-5">
        {/* query bar */}
        <div className="flex items-center gap-2 rounded-xl border border-black/[0.07] bg-neutral-50 py-2 pl-3 pr-1.5 sm:py-2.5">
          <Sparkles
            className="size-3.5 shrink-0 text-brand-600"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 truncate text-[12px] text-ink sm:text-[13px]">
            Find 500 dentists in Austin
          </p>
          <GreenMiniButton>
            <Search className="size-3" aria-hidden="true" />
            Find leads
          </GreenMiniButton>
        </div>

        {/* interpretation */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 sm:mt-3">
          <TinyLabel className="mr-0.5">Understood</TinyLabel>
          <Chip icon={<Building2 className="size-2.5" aria-hidden="true" />}>
            Dentists
          </Chip>
          <Chip icon={<MapPin className="size-2.5" aria-hidden="true" />}>
            Austin, Texas
          </Chip>
          <Chip icon={<ListChecks className="size-2.5" aria-hidden="true" />}>
            500 leads requested
          </Chip>
        </div>

        {/* results table */}
        <div className="mt-3 overflow-hidden rounded-xl border border-black/[0.05] sm:mt-4">
          <div className="flex items-center gap-3 border-b border-black/[0.05] bg-neutral-50/70 px-3 py-2">
            <TinyLabel className="min-w-0 flex-1">Business</TinyLabel>
            <TinyLabel className="hidden w-24 md:block">Phone</TinyLabel>
            <TinyLabel className="hidden w-32 lg:block">Website</TinyLabel>
            <TinyLabel className="w-14 text-right sm:w-20 sm:text-left">
              Rating
            </TinyLabel>
            <TinyLabel className="hidden w-[70px] text-right sm:block">
              Status
            </TinyLabel>
          </div>
          <ul className="divide-y divide-black/[0.04]">
            {rows.map((biz, i) => (
              <li
                key={biz.name}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 sm:py-2.5",
                  i > 2 && "hidden sm:flex"
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <BizAvatar biz={biz} />
                  <span className="min-w-0">
                    <span className="block truncate text-[11.5px] font-medium sm:text-[12.5px]">
                      {biz.name}
                    </span>
                    <span className="block truncate text-[10px] text-neutral-400">
                      {biz.category} · {biz.location}
                    </span>
                  </span>
                </span>
                <span className="hidden w-24 items-center gap-1 text-[11px] text-ink-soft md:flex">
                  <Phone className="size-3 text-neutral-300" aria-hidden="true" />
                  {biz.phone}
                </span>
                <span className="hidden w-32 items-center gap-1 truncate text-[11px] text-ink-soft lg:flex">
                  <Globe className="size-3 shrink-0 text-neutral-300" aria-hidden="true" />
                  <span className="truncate">{biz.website}</span>
                </span>
                <span className="w-14 text-right sm:w-20 sm:text-left">
                  <Stars rating={biz.rating} />
                </span>
                <span className="hidden w-[70px] justify-end sm:flex">
                  <StatusPill status={biz.status} />
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-black/[0.05] bg-neutral-50/70 px-3 py-2">
            <p className="min-w-0 truncate text-[10px] text-neutral-400">
              + 496 more businesses
            </p>
            <p className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-brand-700">
              <Check className="size-3 shrink-0" aria-hidden="true" />
              Saved to “Austin Dentists”
            </p>
          </div>
        </div>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* STEP 1 — natural language input                                   */
/* ---------------------------------------------------------------- */
export function StepSearchCard({ className }: { className?: string }) {
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
          <Sparkles className="size-3.5 text-brand-600" aria-hidden="true" />
          New search
        </p>
        <Chip active>AI</Chip>
      </CardHeader>
      <div className="p-3.5">
        <div className="rounded-xl border border-black/[0.07] bg-neutral-50 px-3 py-2.5">
          <p className="text-[12.5px] text-ink">
            Find dentists in Austin
            <span
              className="ml-1 inline-block h-3.5 w-[2px] translate-y-[3px] animate-pulse rounded bg-brand-600"
              aria-hidden="true"
            />
          </p>
        </div>
        <p className="mt-2.5 text-[10.5px] leading-4 text-neutral-400">
          Say it like you would to a colleague — type, place, quantity.
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Chip>Dentists</Chip>
            <Chip>Austin, TX</Chip>
          </div>
          <GreenMiniButton>
            <Search className="size-3" aria-hidden="true" />
            Run
          </GreenMiniButton>
        </div>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* STEP 2 — search progress                                          */
/* ---------------------------------------------------------------- */
export function StepProgressCard({ className }: { className?: string }) {
  const found = DEMO_DENTISTS.slice(1, 3);
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <p className="flex items-center gap-2 text-[11.5px] font-medium">
          <StatusDot className="text-brand-600" />
          Finding businesses…
        </p>
        <p className="text-[10px] text-neutral-400">142 found</p>
      </CardHeader>
      <div className="p-3.5">
        <ul className="space-y-2">
          {[
            { label: "Searching business data", done: true },
            { label: "Processing results", done: true },
            { label: "Removing duplicates", done: false },
          ].map((step) => (
            <li key={step.label} className="flex items-center gap-2">
              {step.done ? (
                <span className="grid size-4 place-items-center rounded-full bg-brand-50">
                  <Check className="size-2.5 text-brand-600" aria-hidden="true" />
                </span>
              ) : (
                <Loader2
                  className="size-4 animate-spin text-neutral-300"
                  aria-hidden="true"
                />
              )}
              <p
                className={cn(
                  "text-[11px]",
                  step.done ? "text-ink-soft" : "text-neutral-400"
                )}
              >
                {step.label}
              </p>
              {step.done && (
                <Check className="ml-auto size-3 text-brand-600" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-neutral-100">
          <div className="h-full w-[78%] rounded-full bg-brand-500" />
        </div>
        <ul className="mt-3 divide-y divide-black/[0.04] border-t border-black/[0.05] pt-1">
          {found.map((biz) => (
            <li key={biz.name} className="flex items-center gap-2.5 py-1.5">
              <BizAvatar biz={biz} className="size-5 rounded-[5px]" />
              <p className="min-w-0 flex-1 truncate text-[11px] font-medium">
                {biz.name}
              </p>
              <Stars rating={biz.rating} />
            </li>
          ))}
        </ul>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* STEP 3 — lead table                                               */
/* ---------------------------------------------------------------- */
export function StepTableCard({ className }: { className?: string }) {
  const rows = DEMO_DENTISTS.slice(0, 3);
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <p className="text-[11.5px] font-medium">Austin Dentists</p>
        <div className="flex items-center gap-1.5">
          <Chip icon={<FileDown className="size-2.5" aria-hidden="true" />}>
            CSV
          </Chip>
          <Chip active>125 leads</Chip>
        </div>
      </CardHeader>
      <div>
        <div className="flex items-center gap-3 border-b border-black/[0.05] bg-neutral-50/70 px-3.5 py-2">
          <TinyLabel className="min-w-0 flex-1">Business</TinyLabel>
          <TinyLabel className="hidden w-20 sm:block">Website</TinyLabel>
          <TinyLabel className="w-12">Rating</TinyLabel>
          <TinyLabel className="w-[64px] text-right">Status</TinyLabel>
        </div>
        <ul className="divide-y divide-black/[0.04] px-1.5 py-1">
          {rows.map((biz) => (
            <li key={biz.name} className="flex items-center gap-3 px-2 py-2">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <BizAvatar biz={biz} className="size-5 rounded-[5px]" />
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium">
                    {biz.name}
                  </span>
                  <span className="block truncate text-[9.5px] text-neutral-400">
                    {biz.phone}
                    {biz.email ? ` · ${biz.email}` : ""}
                  </span>
                </span>
              </span>
              <span className="hidden w-20 items-center gap-1 truncate text-[10px] text-ink-soft sm:flex">
                <Globe className="size-2.5 shrink-0 text-neutral-300" aria-hidden="true" />
                <span className="truncate">{biz.website}</span>
              </span>
              <span className="w-12">
                <Stars rating={biz.rating} />
              </span>
              <span className="flex w-[64px] justify-end">
                <StatusPill status={biz.status} />
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-black/[0.05] px-3.5 py-2">
          <p className="text-[10px] text-neutral-400">
            Enrich, analyze with AI, or export — the list is yours.
          </p>
        </div>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* FEATURE 1 — compose search with filters                           */
/* ---------------------------------------------------------------- */
export function FeatureComposeCard({ className }: { className?: string }) {
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <TinyLabel>New search</TinyLabel>
        <Chip active icon={<Sparkles className="size-2.5" aria-hidden="true" />}>
          AI assisted
        </Chip>
      </CardHeader>
      <div className="p-3.5 sm:p-4">
        <TinyLabel>Find</TinyLabel>
        <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-black/[0.07] bg-neutral-50 px-3 py-2.5">
          <p className="min-w-0 flex-1 truncate text-[12.5px] sm:text-[13.5px]">
            500 dentists in Austin
          </p>
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <Filter className="size-3 text-neutral-300" aria-hidden="true" />
          <TinyLabel>Filters</TinyLabel>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Chip icon={<Star className="size-2.5 fill-amber-400 text-amber-400" aria-hidden="true" />}>
            Rating 4.0+
          </Chip>
          <Chip icon={<Globe className="size-2.5" aria-hidden="true" />}>
            Has website
          </Chip>
          <Chip icon={<Phone className="size-2.5" aria-hidden="true" />}>
            Has phone
          </Chip>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-black/[0.05] pt-3">
          <p className="text-[10px] text-neutral-400">Est. 480+ results</p>
          <GreenMiniButton className="px-3 py-2">
            <Search className="size-3" aria-hidden="true" />
            Find leads
          </GreenMiniButton>
        </div>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* FEATURE 2 — businesses, not databases                             */
/* ---------------------------------------------------------------- */
export function FeatureListCard({ className }: { className?: string }) {
  const rows = DEMO_DENTISTS.slice(0, 4);
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <p className="text-[11.5px] font-medium">Results</p>
        <Chip active>500 businesses</Chip>
      </CardHeader>
      <ul className="divide-y divide-black/[0.04] px-1.5 py-1">
        {rows.map((biz, i) => (
          <li
            key={biz.name}
            className={cn("flex items-center gap-2.5 px-2 py-2.5", i > 2 && "hidden sm:flex")}
          >
            <BizAvatar biz={biz} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">
                {biz.name}
              </span>
              <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-neutral-400">
                <MapPin className="size-2.5 shrink-0" aria-hidden="true" />
                {biz.location}
              </span>
            </span>
            <span className="hidden min-[420px]:block">
              <Chip>{biz.category}</Chip>
            </span>
            <Stars rating={biz.rating} reviews={biz.reviews} />
          </li>
        ))}
      </ul>
      <div className="border-t border-black/[0.05] px-3.5 py-2">
        <p className="text-[10px] text-neutral-400">
          Structured rows — not a database to query, a list to work.
        </p>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* FEATURE 3 — business detail                                       */
/* ---------------------------------------------------------------- */
export function FeatureDetailCard({ className }: { className?: string }) {
  const biz = DEMO_DENTISTS[0];
  const fields: { icon: ReactNode; label: string; value: string }[] = [
    { icon: <Building2 className="size-3" aria-hidden="true" />, label: "Category", value: "Dentist · Cosmetic" },
    { icon: <MapPin className="size-3" aria-hidden="true" />, label: "Address", value: "1204 Willow Bend Rd, Austin, TX" },
    { icon: <Phone className="size-3" aria-hidden="true" />, label: "Phone", value: biz.phone },
    { icon: <Globe className="size-3" aria-hidden="true" />, label: "Website", value: biz.website },
    { icon: <Users className="size-3" aria-hidden="true" />, label: "Reviews", value: `${biz.reviews} reviews` },
    { icon: <Clock className="size-3" aria-hidden="true" />, label: "Hours", value: "Mon–Fri · 8:00–17:00" },
    { icon: <Navigation className="size-3" aria-hidden="true" />, label: "Coordinates", value: "30.2672° N, 97.7431° W" },
    { icon: <Mail className="size-3" aria-hidden="true" />, label: "Email", value: biz.email ?? "Not available" },
  ];
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <span className="flex min-w-0 items-center gap-2.5">
          <BizAvatar biz={biz} />
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold">
              {biz.name}
            </span>
            <span className="flex items-center gap-1.5">
              <Stars rating={biz.rating} reviews={biz.reviews} />
            </span>
          </span>
        </span>
        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-black/[0.07] text-ink-soft">
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </span>
      </CardHeader>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 p-3.5 sm:p-4">
        {fields.map((f) => (
          <div key={f.label} className="flex items-start gap-2">
            <span className="mt-0.5 text-neutral-300">{f.icon}</span>
            <span className="min-w-0">
              <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                {f.label}
              </dt>
              <dd className="truncate text-[11px] text-ink-soft">{f.value}</dd>
            </span>
          </div>
        ))}
      </dl>
      <div className="border-t border-black/[0.05] px-3.5 py-2">
        <p className="text-[10px] text-neutral-400">
          Demo record · fields depend on available business data
        </p>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* FEATURE 4 — lead lists                                            */
/* ---------------------------------------------------------------- */
export function FeatureLeadsCard({ className }: { className?: string }) {
  const rows = DEMO_DENTISTS.slice(1, 4);
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <p className="flex items-center gap-2 text-[11.5px] font-medium">
          <ListChecks className="size-3.5 text-brand-600" aria-hidden="true" />
          Austin Dentists
        </p>
        <Chip active>125 leads</Chip>
      </CardHeader>
      <div className="p-3.5">
        <div className="flex items-center gap-1.5">
          <Tag className="size-3 text-neutral-300" aria-hidden="true" />
          <TinyLabel>Tags</TinyLabel>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Chip>New · 12</Chip>
          <Chip active>High rating · 48</Chip>
          <Chip icon={<Globe className="size-2.5" aria-hidden="true" />}>
            Website · 96
          </Chip>
        </div>
        <ul className="mt-3 space-y-1.5">
          {rows.map((biz) => (
            <li
              key={biz.name}
              className="flex items-center gap-2.5 rounded-lg border border-black/[0.05] bg-neutral-50/60 px-2.5 py-2"
            >
              <span className="grid size-4 place-items-center rounded-[5px] bg-brand-600">
                <Check className="size-2.5 text-white" aria-hidden="true" />
              </span>
              <p className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
                {biz.name}
              </p>
              <Stars rating={biz.rating} />
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-center text-[10px] text-neutral-400">
          + 122 more in this list
        </p>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* FEATURE 5 — AI summary                                            */
/* ---------------------------------------------------------------- */
export function FeatureAiCard({ className }: { className?: string }) {
  const biz = DEMO_DENTISTS[0];
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <span className="flex min-w-0 items-center gap-2">
          <BizAvatar biz={biz} className="size-5 rounded-[5px]" />
          <p className="truncate text-[11.5px] font-medium">{biz.name}</p>
        </span>
        <Chip active icon={<Sparkles className="size-2.5" aria-hidden="true" />}>
          Zybble AI
        </Chip>
      </CardHeader>
      <div className="p-3.5 sm:p-4">
        <TinyLabel>AI summary</TinyLabel>
        <div className="mt-1.5 rounded-xl bg-neutral-50 p-3">
          <ul className="space-y-1.5 text-[11px] leading-5 text-ink-soft">
            <li className="flex gap-1.5">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
              Strong local presence with a 4.8 rating across 214 reviews.
            </li>
            <li className="flex gap-1.5">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
              High review volume with recent activity.
            </li>
            <li className="flex gap-1.5">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
              Website detected — direct outreach channel available.
            </li>
            <li className="flex gap-1.5">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
              Potential outreach opportunity for growth services.
            </li>
          </ul>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1 text-[9.5px] text-neutral-400">
            <Sparkles className="size-2.5" aria-hidden="true" />
            AI generated — verify before outreach
          </p>
          <p className="text-[9.5px] text-neutral-400">
            Based on available business data
          </p>
        </div>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* FEATURE 6 — export                                                */
/* ---------------------------------------------------------------- */
export function FeatureExportCard({ className }: { className?: string }) {
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
          <FileDown className="size-3.5 text-brand-600" aria-hidden="true" />
          Export leads
        </p>
        <Chip>125 selected</Chip>
      </CardHeader>
      <div className="p-3.5 sm:p-4">
        <div className="flex items-center gap-2">
          <TinyLabel>Format</TinyLabel>
          <Chip active icon={<FileDown className="size-2.5" aria-hidden="true" />}>
            CSV
          </Chip>
        </div>
        <TinyLabel className="mt-3.5">Fields</TinyLabel>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {["Business", "Phone", "Email", "Website", "Address", "Rating"].map(
            (f) => (
              <Chip
                key={f}
                icon={<Check className="size-2.5 text-brand-600" aria-hidden="true" />}
              >
                {f}
              </Chip>
            )
          )}
        </div>
        <span className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-[11.5px] font-medium text-white">
          <Download className="size-3.5" aria-hidden="true" />
          Export CSV
        </span>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* FEATURE 1 — structured request panel                              */
/* ---------------------------------------------------------------- */
export function FeatureRequestCard({ className }: { className?: string }) {
  const rows = [
    { icon: <MapPin className="size-3" aria-hidden="true" />, label: "Location", value: "Austin, Texas" },
    { icon: <Building2 className="size-3" aria-hidden="true" />, label: "Category", value: "Dentists" },
    { icon: <ListChecks className="size-3" aria-hidden="true" />, label: "Target", value: "500 leads" },
  ];
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <TinyLabel>New search</TinyLabel>
        <Chip active icon={<Sparkles className="size-2.5" aria-hidden="true" />}>
          AI assisted
        </Chip>
      </CardHeader>
      <div className="p-3.5 sm:p-4">
        <div className="flex items-center gap-2 rounded-xl border border-black/[0.07] bg-neutral-50 px-3 py-2.5">
          <Sparkles className="size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-[12.5px] sm:text-[13px]">
            Find 500 dentists in Austin
          </p>
        </div>
        <dl className="mt-3 space-y-1.5">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center gap-2.5 rounded-lg border border-black/[0.05] px-2.5 py-2"
            >
              <span className="grid size-5 place-items-center rounded-md bg-neutral-50 text-neutral-400">
                {row.icon}
              </span>
              <dt className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                {row.label}
              </dt>
              <dd className="ml-auto text-[11.5px] font-medium text-ink">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        <span className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-[11.5px] font-medium text-white">
          <Search className="size-3.5" aria-hidden="true" />
          Find leads
        </span>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* FEATURE 3 — business detail + AI intelligence                     */
/* ---------------------------------------------------------------- */
export function FeatureIntelCard({ className }: { className?: string }) {
  const biz = DEMO_DENTISTS[0];
  const fields = [
    { icon: <Phone className="size-3" aria-hidden="true" />, value: biz.phone },
    { icon: <Globe className="size-3" aria-hidden="true" />, value: biz.website },
    { icon: <Clock className="size-3" aria-hidden="true" />, value: "Mon–Fri · 8:00–17:00" },
    { icon: <Mail className="size-3" aria-hidden="true" />, value: "hello@bluebonnetdental.co" },
  ];
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <span className="flex min-w-0 items-center gap-2">
          <BizAvatar biz={biz} />
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold">
              {biz.name}
            </span>
            <Stars rating={biz.rating} reviews={biz.reviews} />
          </span>
        </span>
        <Chip active icon={<Sparkles className="size-2.5" aria-hidden="true" />}>
          Zybble AI
        </Chip>
      </CardHeader>
      <div className="p-3.5">
        <ul className="grid grid-cols-2 gap-x-3 gap-y-2">
          {fields.map((f, i) => (
            <li key={i} className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-neutral-300">{f.icon}</span>
              <span className="truncate text-[10.5px] text-ink-soft">{f.value}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-black/[0.05] pt-3">
          <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-brand-700">
            <Sparkles className="size-3" aria-hidden="true" />
            AI analysis
          </p>
          <ul className="mt-2 space-y-1.5">
            {[
              "Strong local presence — 4.8 across 214 reviews",
              "Website detected with direct contact channel",
              "Potential outreach opportunity for growth services",
            ].map((line) => (
              <li key={line} className="flex gap-1.5 text-[10.5px] leading-4.5 text-ink-soft">
                <span className="mt-[6px] size-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[9px] text-neutral-400">
            AI generated from available business data · verify before outreach
          </p>
        </div>
      </div>
    </UiCard>
  );
}

/* ---------------------------------------------------------------- */
/* FINAL CTA — new search                                            */
/* ---------------------------------------------------------------- */
export function FinalSearchCard({ className }: { className?: string }) {
  return (
    <UiCard className={cn("w-full", className)}>
      <CardHeader>
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
          <Sparkles className="size-3.5 text-brand-600" aria-hidden="true" />
          New search
        </p>
        <p className="flex items-center gap-1.5 text-[10px] font-medium text-brand-700">
          <StatusDot />
          Ready
        </p>
      </CardHeader>
      <div className="p-3.5">
        <div className="rounded-xl border border-black/[0.07] bg-neutral-50 px-3 py-2.5">
          <p className="truncate text-[12px] text-ink sm:text-[12.5px]">
            Find 250 marketing agencies in Chicago
          </p>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            <Chip icon={<Building2 className="size-2.5" aria-hidden="true" />}>
              Agencies
            </Chip>
            <Chip icon={<MapPin className="size-2.5" aria-hidden="true" />}>
              Chicago, IL
            </Chip>
            <Chip>250 leads</Chip>
          </div>
          <GreenMiniButton className="shrink-0">
            <Search className="size-3" aria-hidden="true" />
            Find
          </GreenMiniButton>
        </div>
      </div>
    </UiCard>
  );
}
