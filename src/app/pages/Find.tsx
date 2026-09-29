/* ------------------------------------------------------------------ */
/* Zybble app — Find Leads (search workspace + Zybble AI panel)        */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  Filter,
  Globe,
  ListPlus,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import { AiPanel, type AiSuggestion } from "../components/AiPanel";
import { Badge, Btn, Card, EmptyState, useToast } from "../components/ui";
import { LeadsTable } from "../components/LeadsTable";
import { LEADS } from "../data/mock";
import type { Lead } from "../data/types";
import { useAppSeo } from "../hooks";
import { BACKEND_ENABLED, runSearch } from "../services/api";
import { useWorkspace } from "../services/hooks";

const EXAMPLES = [
  "Find dentists in Austin",
  "Coffee shops in New York",
  "Marketing agencies in London",
  "Restaurants in Miami with websites",
];

const STAGES = [
  "Understanding your search",
  "Finding relevant businesses",
  "Collecting business information",
  "Checking results",
  "Removing duplicates",
  "Preparing your leads",
];

function parseQuery(q: string) {
  const lower = q.toLowerCase();
  const withWebsite = /with (a )?website/.test(lower) || /websites$/.test(lower);
  const ratingMatch = lower.match(/rated?\s*(?:above|over)?\s*(\d(?:\.\d)?)/);
  const locationMatch = lower.match(/\bin\s+([a-z][a-z .]+?)(?:\s+(?:with|rated|and)|$)/i);
  const quantityMatch = lower.match(/find\s+(\d+)\s+/);
  const category = lower
    .replace(/^find\s+\d+\s+/, "")
    .replace(/^find\s+/, "")
    .replace(/\s+in\s+.*/, "")
    .replace(/\s+with.*/, "")
    .trim();
  return {
    category: category ? category.replace(/\b\w/g, (c) => c.toUpperCase()) : null,
    location: locationMatch ? locationMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()) : null,
    quantity: quantityMatch ? Number(quantityMatch[1]) : null,
    withWebsite,
    minRating: ratingMatch ? Number(ratingMatch[1]) : null,
  };
}

function matches(lead: Lead, parsed: ReturnType<typeof parseQuery>, query: string) {
  const text = `${lead.category} ${lead.name} ${lead.city} ${lead.state}`.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !["with", "rated", "above", "find"].includes(w));
  const some = words.length === 0 || words.some((w) => text.includes(w));
  if (!some) return false;
  if (parsed.withWebsite && !lead.website) return false;
  if (parsed.minRating && lead.rating < parsed.minRating) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Filter chip popover                                                 */
/* ------------------------------------------------------------------ */
function FilterChip({
  label,
  icon,
  active,
  options,
  onPick,
  onClear,
}: {
  label: string;
  icon: React.ReactNode;
  active: string | null;
  options: string[];
  onPick: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-pressed={Boolean(active)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded border px-2.5 text-xs transition-colors",
          active
            ? "border-brand-600/25 bg-brand-50 font-medium text-brand-700"
            : "border-black/[0.09] bg-white text-ink-soft hover:border-black/[0.16] hover:text-ink"
        )}
      >
        {icon}
        {active ?? label}
        <ChevronDown className="size-3 opacity-50" aria-hidden="true" />
      </button>
      {open ? (
        <div className="pop-in absolute z-40 mt-1.5 w-44 overflow-hidden rounded-md border border-black/[0.08] bg-white p-1 shadow-pop" role="menu">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              role="menuitemradio"
              aria-checked={active === opt}
              onClick={() => {
                onPick(opt === "Any" ? "" : opt);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-ink-soft transition-colors hover:bg-black/[0.045] hover:text-ink"
            >
              {opt}
              {active === opt ? <Check className="size-3 text-brand-600" aria-hidden="true" /> : null}
            </button>
          ))}
          {active ? (
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-neutral-400 transition-colors hover:bg-black/[0.045] hover:text-ink"
            >
              <X className="size-3" aria-hidden="true" />
              Clear filter
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export function FindPage() {
  useAppSeo("Find Leads — Zybble", "Describe the businesses you need and get structured leads.", "/find");
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<"idle" | "searching" | "done">("idle");
  const [stageIndex, setStageIndex] = useState(0);
  const [results, setResults] = useState<Lead[]>([]);
  const [lastQuery, setLastQuery] = useState("");
  const timers = useRef<number[]>([]);

  /* filters — visible after results */
  const [city, setCity] = useState("");
  const [rating, setRating] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState("");
  const [listAssign, setListAssign] = useState("");
  const { workspace } = useWorkspace();
  const [realInterpretation, setRealInterpretation] = useState<{
    category: string | null;
    location: string | null;
    quantity: number | null;
    minRating: number | null;
    withWebsite: boolean;
  } | null>(null);
  const [realInsights, setRealInsights] = useState<string[]>([]);
  const [realSuggestions, setRealSuggestions] = useState<string[]>([]);

  const parsed = useMemo(() => (lastQuery ? parseQuery(lastQuery) : null), [lastQuery]);

  const filteredResults = useMemo(() => {
    return results.filter((lead) => {
      if (city && lead.city !== city) return false;
      if (rating && lead.rating < Number(rating.replace("+", ""))) return false;
      if (website === "Has website" && !lead.website) return false;
      if (website === "No website" && lead.website) return false;
      if (status && lead.status.toLowerCase() !== status.toLowerCase()) return false;
      return true;
    });
  }, [results, city, rating, website, status]);

  const run = (forQuery?: string) => {
    const q = (forQuery ?? query).trim();
    if (!q || phase === "searching") return;
    if (forQuery) setQuery(forQuery);
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPhase("searching");
    setStageIndex(0);
    setLastQuery(q);
    STAGES.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setStageIndex(i), i * 480));
    });
    if (!BACKEND_ENABLED) {
      timers.current.push(
        window.setTimeout(() => {
          const p = parseQuery(q);
          const found = LEADS.filter((lead) => matches(lead, p, q));
          setResults(found.length ? found : LEADS.slice(0, 18));
          setPhase("done");
          setCity("");
          setRating("");
          setWebsite("");
          setStatus("");
        }, STAGES.length * 480 + 200)
      );
    }

    if (BACKEND_ENABLED && workspace) {
      runSearch(workspace.id, q).then(({ result, error }) => {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
        if (error || !result) {
          setPhase("idle");
          toast(error ?? "The search couldn't complete. Try again.", "error");
          return;
        }
        setStageIndex(STAGES.length - 1);
        setResults(result.leads.length ? result.leads : []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const plan = (result.stats.interpretation as any) ?? {};
        setRealInterpretation({
          category: plan.category ?? null,
          location: plan.location ?? result.stats.suggestions?.[0] ?? null,
          quantity: result.stats.requested ?? null,
          minRating: plan.filters?.min_rating ?? null,
          withWebsite: Boolean(plan.filters?.require_website),
        });
        setRealInsights(result.stats.insights ?? []);
        setRealSuggestions(result.stats.suggestions ?? []);
        setPhase("done");
        setCity("");
        setRating("");
        setWebsite("");
        setStatus("");
      });
    }
  };

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  /* AI panel facts */
  const activeFilters = [city, rating, website, status].filter(Boolean).length;
  const aiFacts = useMemo(() => {
    const facts: { label: string; value: string; icon: React.ReactNode }[] = [];
    if (realInterpretation) {
      if (realInterpretation.category) facts.push({ label: "Category", value: realInterpretation.category, icon: <Search className="size-2.5" aria-hidden="true" /> });
      if (realInterpretation.location) facts.push({ label: "Location", value: realInterpretation.location, icon: <MapPin className="size-2.5" aria-hidden="true" /> });
      if (realInterpretation.quantity) facts.push({ label: "Target", value: `${realInterpretation.quantity} leads`, icon: <ListPlus className="size-2.5" aria-hidden="true" /> });
      if (realInterpretation.minRating) facts.push({ label: "Rating", value: `${realInterpretation.minRating}+`, icon: <Star className="size-2.5" aria-hidden="true" /> });
      if (realInterpretation.withWebsite) facts.push({ label: "Website", value: "Required", icon: <Globe className="size-2.5" aria-hidden="true" /> });
      return facts;
    }
    if (!parsed) return facts;
    if (parsed.category) facts.push({ label: "Category", value: parsed.category, icon: <Search className="size-2.5" aria-hidden="true" /> });
    if (parsed.location) facts.push({ label: "Location", value: parsed.location, icon: <MapPin className="size-2.5" aria-hidden="true" /> });
    if (parsed.quantity) facts.push({ label: "Target", value: `${parsed.quantity} leads`, icon: <ListPlus className="size-2.5" aria-hidden="true" /> });
    if (parsed.minRating) facts.push({ label: "Rating", value: `${parsed.minRating}+`, icon: <Star className="size-2.5" aria-hidden="true" /> });
    if (parsed.withWebsite) facts.push({ label: "Website", value: "Required", icon: <Globe className="size-2.5" aria-hidden="true" /> });
    return facts;
  }, [parsed]);

  const aiSuggestions: AiSuggestion[] = useMemo(() => {
    if (phase !== "done" || !parsed) return [];
    const out: AiSuggestion[] = [
      { id: "s1", icon: <Search className="size-3" aria-hidden="true" />, label: parsed.category ? "Make this search more specific" : "Describe a category", action: () => toast("Try adding a specialty — ““cosmetic””, for example", "info") },
      { id: "s2", icon: <MapPin className="size-3" aria-hidden="true" />, label: parsed.location ? `Explore another market` : "Add a location", action: () => toast("Add a city — “in Denver”", "info") },
      { id: "s3", icon: <Globe className="size-3" aria-hidden="true" />, label: "Only show businesses with websites", action: () => setWebsite("Has website") },
      { id: "s4", icon: <Star className="size-3" aria-hidden="true" />, label: "Find businesses with 4.5+ ratings", action: () => setRating("4.5+") },
      { id: "s5", icon: <ListPlus className="size-3" aria-hidden="true" />, label: "Save these leads to a list", action: () => toast(`${filteredResults.length} leads saved to a new list`) },
    ];
    return out;
  }, [phase, parsed, toast, filteredResults.length]);

  const aiInsights = useMemo(() => {
    if (phase !== "done" || !filteredResults.length) return [];
    if (realInsights.length) return realInsights;
    const withEmail = filteredResults.filter((l) => l.email).length;
    const highRated = filteredResults.filter((l) => l.rating >= 4.5).length;
    return [
      `${withEmail} of ${filteredResults.length} leads include an email address.`,
      `${highRated} businesses are rated 4.5 or higher.`,
    ];
  }, [phase, filteredResults, realInsights]);

  const contextualSuggestions = useMemo<AiSuggestion[]>(() => {
    if (!realSuggestions.length) return [];
    const icons = [
      <Search key="1" className="size-3" aria-hidden="true" />,
      <MapPin key="2" className="size-3" aria-hidden="true" />,
      <Globe key="3" className="size-3" aria-hidden="true" />,
      <Star key="4" className="size-3" aria-hidden="true" />,
    ];
    return realSuggestions.map((label, i) => ({
      id: `real-${i}`,
      icon: icons[i % icons.length],
      label,
      action: () => toast(label, "info"),
    }));
  }, [realSuggestions, toast]);

  const busy = phase === "searching";
  const cityOptions = useMemo(() => Array.from(new Set(results.map((l) => l.city))).slice(0, 8), [results]);

  return (
    <AppLayout
      title="Find Leads"
      description="Describe the businesses you need — Zybble turns it into a structured lead search."
      wide
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_288px]">
        {/* ————— main column ————— */}
        <div className="min-w-0 space-y-3">
          {/* search bar */}
          <Card className="p-2.5 sm:p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run();
              }}
              role="search"
              aria-label="Find leads"
              className="flex flex-col gap-2 sm:flex-row"
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-300" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find businesses, professionals, or companies…"
                  aria-label="Search businesses in natural language"
                  autoFocus
                  className="h-10 w-full rounded-md border border-black/[0.09] bg-neutral-50/80 pl-9 pr-3 text-sm text-ink placeholder:text-neutral-400 outline-none transition-colors focus:border-brand-600/50 focus:bg-white focus:ring-2 focus:ring-brand-600/15"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !query.trim()}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white shadow-[0_1px_2px_rgba(11,99,67,0.22),inset_0_1px_0_rgba(255,255,255,0.12)] transition-all hover:bg-brand-700 active:scale-[0.99] disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
                {busy ? "Searching…" : "Find leads"}
              </button>
            </form>
            {phase === "idle" ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 px-1">
                <span className="text-[11px] text-neutral-400">Try</span>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => run(ex)}
                    className="rounded-full border border-black/[0.07] bg-white px-2.5 py-1 text-[11px] text-ink-soft transition-colors hover:border-brand-600/25 hover:text-ink"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            ) : null}
          </Card>

          {/* progress state */}
          {phase === "searching" ? (
            <Card className="p-5 sm:p-6">
              <div className="mx-auto max-w-sm">
                <p className="text-center text-sm font-medium text-ink">Searching “{lastQuery}”</p>
                <p className="mt-0.5 text-center text-xs text-ink-mute">Zybble is preparing your leads.</p>
                <ul className="mt-5 space-y-2.5">
                  {STAGES.map((stage, i) => {
                    const done = i < stageIndex;
                    const active = i === stageIndex;
                    return (
                      <li key={stage} className="flex items-center gap-2.5" aria-current={active ? "step" : undefined}>
                        {done ? (
                          <span className="grid size-4.5 place-items-center rounded-full bg-brand-50">
                            <Check className="size-2.5 text-brand-600" strokeWidth={3} aria-hidden="true" />
                          </span>
                        ) : active ? (
                          <Loader2 className="size-4.5 animate-spin text-brand-600" aria-hidden="true" />
                        ) : (
                          <span className="mx-1.5 size-1.5 rounded-full bg-black/[0.12]" aria-hidden="true" />
                        )}
                        <p className={cn("text-[13px]", done ? "text-ink-soft" : active ? "font-medium text-ink" : "text-neutral-400")}>
                          {stage}
                        </p>
                        {done ? <span className="ml-auto text-[10px] text-brand-700/80">done</span> : null}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-5 h-1 overflow-hidden rounded-full bg-black/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={STAGES.length} aria-valuenow={stageIndex + 1}>
                  <div
                    className="h-full rounded-full bg-brand-600 transition-all duration-500 ease-out"
                    style={{ width: `${((stageIndex + 1) / STAGES.length) * 100}%` }}
                  />
                </div>
              </div>
            </Card>
          ) : null}

          {/* idle hero hint */}
          {phase === "idle" ? (
            <Card className="p-5">
              <EmptyState
                className="border-0 py-8"
                icon={<Sparkles className="size-4" aria-hidden="true" />}
                title="Ready when you are"
                description="Write a plain-language request — category, location, and what matters to you. Zybble interprets it, searches business data, deduplicates, and structures the leads."
              />
            </Card>
          ) : null}

          {/* results */}
          {phase === "done" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                  <Filter className="size-3.5 text-neutral-400" aria-hidden="true" />
                  {filteredResults.length.toLocaleString()} results
                </span>
                {activeFilters > 0 ? <Badge tone="green">{activeFilters} active {activeFilters === 1 ? "filter" : "filters"}</Badge> : null}
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <FilterChip label="City" icon={<MapPin className="size-3 text-neutral-400" aria-hidden="true" />} active={city || null} options={["Any", ...cityOptions]} onPick={(v) => setCity(v)} onClear={() => setCity("")} />
                  <FilterChip label="Rating" icon={<Star className="size-3 text-neutral-400" aria-hidden="true" />} active={rating || null} options={["Any", "3.5+", "4.0+", "4.5+"]} onPick={setRating} onClear={() => setRating("")} />
                  <FilterChip label="Website" icon={<Globe className="size-3 text-neutral-400" aria-hidden="true" />} active={website || null} options={["Any", "Has website", "No website"]} onPick={setWebsite} onClear={() => setWebsite("")} />
                  <FilterChip label="Status" icon={<ListPlus className="size-3 text-neutral-400" aria-hidden="true" />} active={status || null} options={["Any", "New", "Enriched", "Contacted"]} onPick={setStatus} onClear={() => setStatus("")} />
                </div>
              </div>

              <LeadsTable leads={filteredResults} pageSize={12} />

              {/* save bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-ink-mute">
                  Demo search · {results.length.toLocaleString()} leads collected from public business data
                </p>
                <div className="flex items-center gap-1.5">
                  <FilterChip
                    label="Save to list"
                    icon={<ListPlus className="size-3 text-neutral-400" aria-hidden="true" />}
                    active={listAssign || null}
                    options={["Austin Dentists", "Q1 High-Intent Targets", "New list…"]}
                    onPick={(v) => {
                      setListAssign(v);
                      toast(`Saved ${filteredResults.length} leads to “${v}”`);
                    }}
                    onClear={() => setListAssign("")}
                  />
                  <Btn
                    variant="outline"
                    size="sm"
                    onClick={() => toast("Export started — find it in Exports", "info")}
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                    Export results
                  </Btn>
                  <Btn variant="ghost" size="sm" onClick={() => (window.location.hash = "#/search-history")}>
                    Search history
                  </Btn>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* ————— AI panel ————— */}
        <div className="min-w-0">
          <div className="xl:sticky xl:top-[60px]">
            <AiPanel
              title="Zybble AI"
              facts={aiFacts}
              suggestions={contextualSuggestions.length ? contextualSuggestions : aiSuggestions}
              insights={aiInsights}
              busy={busy}
              onClearContext={() => {
                setLastQuery("");
                setResults([]);
                setPhase("idle");
                setRealInterpretation(null);
                setRealInsights([]);
                setRealSuggestions([]);
              }}
            >
              {phase === "idle" ? (
                <p className="text-xs leading-5.5 text-ink-mute">
                  Write a search above and I'll interpret it — category,
                  location, quantity, and requirements — then suggest ways to
                  sharpen the results.
                </p>
              ) : null}
            </AiPanel>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
