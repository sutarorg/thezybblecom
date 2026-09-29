/* ------------------------------------------------------------------ */
/* Zybble app — Find Leads                                             */
/*                                                                     */
/* Manual filter panel is the source of truth. Zybble AI interprets a  */
/* plain-language request into those filters, but NEVER runs a search: */
/* the user reviews the filters and presses "Find leads" themselves.   */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Check,
  Download,
  Globe,
  ListPlus,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Star,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import { LeadsTable } from "../components/LeadsTable";
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  FieldLabel,
  Input,
  SectionTitle,
  Switch,
  useToast,
} from "../components/ui";
import {
  MAX_LEADS_PER_SEARCH,
  PRICE_OPTIONS,
  QUANTITY_PRESETS,
  RADIUS_OPTIONS,
  RATING_OPTIONS,
  SORT_OPTIONS,
  planFromId,
} from "../data/plans";
import type { Lead } from "../data/types";
import { useAppSeo } from "../hooks";
import {
  EMPTY_FILTERS,
  interpretRequest,
  runExport,
  runSearch,
  type SearchFilters,
} from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

/* AI interpretation stages — exactly four, shown inside the AI panel */
const AI_STAGES = [
  "Reading your request",
  "Identifying the business type",
  "Detecting location and filters",
  "Preparing your search",
] as const;

/* Search execution stages */
const RUN_STAGES = [
  "Understanding your search",
  "Finding relevant businesses",
  "Collecting business information",
  "Removing duplicates",
  "Preparing your leads",
] as const;

function selectCls() {
  return "h-8 w-full rounded border border-black/[0.09] bg-white px-2 text-xs text-ink outline-none transition-colors focus:border-brand-600/50 focus:ring-2 focus:ring-brand-600/15";
}

function ToggleRow({
  label,
  hint,
  icon: Icon,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  icon: React.ElementType;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-black/[0.05] bg-neutral-50/60 px-2.5 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-neutral-400" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-[11.5px] font-medium text-ink">{label}</span>
          <span className="block truncate text-[10px] text-neutral-400">{hint}</span>
        </span>
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

export function FindPage() {
  useAppSeo("Find Leads — Zybble", "Describe the businesses you need and collect them as leads.", "/find");
  const toast = useToast();
  const { workspace, planId, loading: ctxLoading } = useWorkspaceContext();
  const plan = planFromId(planId);

  /* ------------ manual filters (the source of truth) ------------ */
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const set = useCallback(<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);
  const [aiTouched, setAiTouched] = useState<Set<keyof SearchFilters>>(new Set());

  /* ------------ search execution ------------ */
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [runStage, setRunStage] = useState(0);
  const [results, setResults] = useState<Lead[]>([]);
  const [stats, setStats] = useState<{ savedCount: number; dedupeRemoved: number; insights: string[] } | null>(null);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  /* ------------ AI interpretation ------------ */
  const [request, setRequest] = useState("");
  const [aiPhase, setAiPhase] = useState<"idle" | "thinking" | "ready" | "error">("idle");
  const [aiStage, setAiStage] = useState(0);
  const [aiSummary, setAiSummary] = useState("");
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiTimers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      aiTimers.current.forEach((t) => window.clearTimeout(t));
    },
    []
  );

  /* The button stays clickable unless a search is already in flight (or the
     workspace context is still loading) — missing input is reported with a
     toast inside onFindLeads instead of silently disabling the button. */
  const canRun = phase !== "running" && !ctxLoading;
  const missingCategory = !filters.category.trim();

  /* ------------ run the actual search (explicit user action) ------------ */
  const onFindLeads = async () => {
    if (phase === "running") return;
    if (!filters.category.trim()) {
      toast("Add a business category to search for.", "error");
      return;
    }
    if (!workspace) {
      toast("Your workspace is still loading — try again in a moment.", "error");
      return;
    }
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPhase("running");
    setRunStage(0);
    setRunError(null);

    RUN_STAGES.forEach((_, i) => {
      if (i === 0) return;
      timers.current.push(window.setTimeout(() => setRunStage(i), i * 900));
    });

    const { result, error } = await runSearch(workspace.id, filters);

    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];

    if (error || !result) {
      setPhase("idle");
      setRunError(error ?? "The search couldn't complete.");
      return;
    }

    setResults(result.leads);
    setStats(result.stats);
    setSearchId(result.searchId);
    setPhase("done");
    if (result.stats.savedCount === 0) {
      toast("No new businesses matched — try widening your filters.", "info");
    } else {
      toast(`${result.stats.savedCount} leads collected`);
    }
  };

  /* ------------ AI: interpret only, never execute ------------ */
  const onInterpret = async () => {
    if (!request.trim() || !workspace) return;
    if (!plan.ai) {
      toast("Zybble AI is available on Growth, Agency, and Scale.", "error");
      return;
    }
    aiTimers.current.forEach((t) => window.clearTimeout(t));
    aiTimers.current = [];
    setAiPhase("thinking");
    setAiStage(0);
    setAiError(null);

    AI_STAGES.forEach((_, i) => {
      if (i === 0) return;
      aiTimers.current.push(window.setTimeout(() => setAiStage(i), i * 550));
    });

    const { result, error } = await interpretRequest(workspace.id, request.trim());

    aiTimers.current.forEach((t) => window.clearTimeout(t));
    aiTimers.current = [];

    if (error || !result) {
      setAiPhase("error");
      setAiError(error ?? "Zybble AI couldn't interpret that request.");
      return;
    }

    /* populate — but do NOT search */
    const touched = new Set<keyof SearchFilters>();
    setFilters((prev) => {
      const next = { ...prev };
      (Object.keys(result.filters) as (keyof SearchFilters)[]).forEach((key) => {
        const value = result.filters[key];
        if (value === undefined || value === null || value === "") return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (next as any)[key] = value;
        touched.add(key);
      });
      return next;
    });
    setAiTouched(touched);
    setAiSummary(result.summary);
    setAiNotes(result.notes ?? []);
    setAiStage(AI_STAGES.length - 1);
    setAiPhase("ready");
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setAiTouched(new Set());
    setAiPhase("idle");
    setAiSummary("");
    setAiNotes([]);
    setRequest("");
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.location.trim()) n++;
    if (filters.minRating) n++;
    if (filters.priceLevel) n++;
    if (filters.radius) n++;
    if (filters.requireWebsite) n++;
    if (filters.requirePhone) n++;
    if (filters.requireEmail) n++;
    if (filters.openNow) n++;
    return n;
  }, [filters]);

  const aiFlag = (key: keyof SearchFilters) =>
    aiTouched.has(key) ? (
      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-brand-50 px-1 text-[9px] font-medium text-brand-700">
        <Sparkles className="size-2" aria-hidden="true" />
        AI
      </span>
    ) : null;

  return (
    <AppLayout
      title="Find Leads"
      description="Set your criteria, review them, then run the search."
      wide
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* ————— main column: manual search builder ————— */}
        <div className="min-w-0 space-y-3">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.05] px-4 py-3">
              <SectionTitle title="Search criteria" description="What kind of businesses are you looking for?" />
              {activeFilterCount > 0 || filters.category ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-mute transition-colors hover:text-ink"
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                  Reset
                </button>
              ) : null}
            </div>

            <form
              className="p-4"
              onSubmit={(e) => {
                e.preventDefault();
                onFindLeads();
              }}
            >
              {/* primary criteria */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="f-category">
                    Business type or category{aiFlag("category")}
                  </FieldLabel>
                  <div className="relative">
                    <Building2
                      className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300"
                      aria-hidden="true"
                    />
                    <Input
                      id="f-category"
                      required
                      value={filters.category}
                      onChange={(e) => set("category", e.target.value)}
                      placeholder="e.g. dentists, coffee shops, law firms"
                      className="pl-8"
                    />
                  </div>
                </div>
                <div>
                  <FieldLabel htmlFor="f-location">Location{aiFlag("location")}</FieldLabel>
                  <div className="relative">
                    <MapPin
                      className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300"
                      aria-hidden="true"
                    />
                    <Input
                      id="f-location"
                      value={filters.location}
                      onChange={(e) => set("location", e.target.value)}
                      placeholder="e.g. Austin, TX"
                      className="pl-8"
                    />
                  </div>
                </div>
              </div>

              {/* quantity */}
              <div className="mt-3">
                <FieldLabel htmlFor="f-quantity">Number of leads{aiFlag("quantity")}</FieldLabel>
                <div className="flex flex-wrap items-center gap-1.5">
                  {QUANTITY_PRESETS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => set("quantity", q)}
                      aria-pressed={filters.quantity === q}
                      className={cn(
                        "inline-flex h-8 items-center rounded px-3 text-xs transition-colors",
                        filters.quantity === q
                          ? "bg-ink font-medium text-white"
                          : "bg-white text-ink-soft ring-1 ring-black/[0.08] hover:ring-black/[0.16]"
                      )}
                    >
                      {q}
                    </button>
                  ))}
                  <Input
                    id="f-quantity"
                    type="number"
                    min={1}
                    max={MAX_LEADS_PER_SEARCH}
                    value={filters.quantity}
                    onChange={(e) =>
                      set("quantity", Math.max(1, Math.min(MAX_LEADS_PER_SEARCH, Number(e.target.value) || 1)))
                    }
                    className="w-24"
                    aria-label="Custom lead count"
                  />
                  <span className="text-[10.5px] text-neutral-400">max {MAX_LEADS_PER_SEARCH} per search</span>
                </div>
              </div>

              {/* refinements */}
              <div className="mt-4 border-t border-black/[0.05] pt-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                  Refine results
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <FieldLabel htmlFor="f-rating">Minimum rating{aiFlag("minRating")}</FieldLabel>
                    <select
                      id="f-rating"
                      value={filters.minRating}
                      onChange={(e) => set("minRating", e.target.value)}
                      className={selectCls()}
                    >
                      {RATING_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="f-price">Price level</FieldLabel>
                    <select
                      id="f-price"
                      value={filters.priceLevel}
                      onChange={(e) => set("priceLevel", e.target.value)}
                      className={selectCls()}
                    >
                      {PRICE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="f-radius">Search area</FieldLabel>
                    <select
                      id="f-radius"
                      value={filters.radius}
                      onChange={(e) => set("radius", e.target.value)}
                      className={selectCls()}
                    >
                      {RADIUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="f-sort">Sort by</FieldLabel>
                    <select
                      id="f-sort"
                      value={filters.sort}
                      onChange={(e) => set("sort", e.target.value)}
                      className={selectCls()}
                    >
                      {SORT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* required data */}
                <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                  Only include businesses with
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ToggleRow
                    label="A website"
                    hint="Skip businesses with no site"
                    icon={Globe}
                    checked={filters.requireWebsite}
                    onChange={(v) => set("requireWebsite", v)}
                  />
                  <ToggleRow
                    label="A phone number"
                    hint="Direct dial available"
                    icon={Phone}
                    checked={filters.requirePhone}
                    onChange={(v) => set("requirePhone", v)}
                  />
                  <ToggleRow
                    label="A public email"
                    hint="Only where one is published"
                    icon={Mail}
                    checked={filters.requireEmail}
                    onChange={(v) => set("requireEmail", v)}
                  />
                  <ToggleRow
                    label="Open now"
                    hint="Currently trading"
                    icon={Star}
                    checked={filters.openNow}
                    onChange={(v) => set("openNow", v)}
                  />
                </div>
              </div>

              {/* submit */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.05] pt-4">
                <p className="text-[11px] text-ink-mute">
                  {activeFilterCount > 0 ? (
                    <>
                      <span className="font-medium text-ink">{activeFilterCount}</span> refinement
                      {activeFilterCount === 1 ? "" : "s"} applied
                    </>
                  ) : (
                    "No refinements — broad search"
                  )}
                </p>
                <button
                  type="submit"
                  disabled={!canRun}
                  aria-disabled={!canRun}
                  title={missingCategory ? "Add a business type first" : undefined}
                  className={`inline-flex h-9 items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-sm font-medium text-white shadow-[0_1px_2px_rgba(11,99,67,0.22),inset_0_1px_0_rgba(255,255,255,0.12)] transition-all hover:bg-brand-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
                    missingCategory && canRun ? "opacity-80" : ""
                  }`}
                >
                  {phase === "running" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Search className="size-4" aria-hidden="true" />
                  )}
                  {phase === "running" ? "Searching…" : "Find leads"}
                </button>
              </div>
            </form>
          </Card>

          {/* run error */}
          {runError ? (
            <Card className="flex items-start gap-3 p-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-red-50 text-red-600">
                <TriangleAlert className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">We couldn't complete that search</p>
                <p className="mt-0.5 text-xs leading-5 text-ink-mute">{runError}</p>
                <Btn variant="outline" size="sm" className="mt-3" onClick={onFindLeads}>
                  Try again
                </Btn>
              </div>
            </Card>
          ) : null}

          {/* running */}
          {phase === "running" ? (
            <Card className="p-5 sm:p-6">
              <div className="mx-auto max-w-sm">
                <p className="text-center text-sm font-medium text-ink">
                  Searching for {filters.category}
                  {filters.location ? ` in ${filters.location}` : ""}
                </p>
                <p className="mt-0.5 text-center text-xs text-ink-mute">Zybble is preparing your leads.</p>
                <ul className="mt-5 space-y-2.5">
                  {RUN_STAGES.map((stage, i) => {
                    const done = i < runStage;
                    const active = i === runStage;
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
                        <p
                          className={cn(
                            "text-[13px]",
                            done ? "text-ink-soft" : active ? "font-medium text-ink" : "text-neutral-400"
                          )}
                        >
                          {stage}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <div
                  className="mt-5 h-1 overflow-hidden rounded-full bg-black/[0.06]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={RUN_STAGES.length}
                  aria-valuenow={runStage + 1}
                >
                  <div
                    className="h-full rounded-full bg-brand-600 transition-all duration-700 ease-out"
                    style={{ width: `${((runStage + 1) / RUN_STAGES.length) * 100}%` }}
                  />
                </div>
              </div>
            </Card>
          ) : null}

          {/* idle */}
          {phase === "idle" && !runError ? (
            <Card className="p-5">
              <EmptyState
                className="border-0 bg-transparent py-8"
                icon={<Search className="size-4" aria-hidden="true" />}
                title="Set your criteria above"
                description="Enter a business type and location, refine what matters, then press Find leads. Or describe what you want to Zybble AI on the right and it will fill the filters in for you."
              />
            </Card>
          ) : null}

          {/* results */}
          {phase === "done" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-ink">
                  {results.length.toLocaleString()} {results.length === 1 ? "lead" : "leads"} collected
                </span>
                {stats?.dedupeRemoved ? (
                  <Badge tone="neutral">{stats.dedupeRemoved} duplicates removed</Badge>
                ) : null}
                <div className="ml-auto flex items-center gap-1.5">
                  <Btn variant="outline" size="sm" href="/leads">
                    <ListPlus className="size-3.5" aria-hidden="true" />
                    View all leads
                  </Btn>
                  <Btn
                    variant="outline"
                    size="sm"
                    disabled={!results.length}
                    onClick={async () => {
                      if (!workspace || !searchId) return;
                      const res = await runExport({
                        workspaceId: workspace.id,
                        searchId,
                        source: `Search · ${filters.category}`,
                      });
                      if (res.error) {
                        toast(res.error, "error");
                        return;
                      }
                      toast("Export ready — find it in Exports");
                    }}
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                    Export results
                  </Btn>
                </div>
              </div>

              <LeadsTable
                leads={results}
                pageSize={12}
                emptyState={
                  <EmptyState
                    icon={<Search className="size-4" aria-hidden="true" />}
                    title="No new businesses found"
                    description="Every match was already in your workspace, or the criteria were too narrow. Try widening the location or removing a requirement."
                  />
                }
              />
            </div>
          ) : null}
        </div>

        {/* ————— Zybble AI (fixed to the right) ————— */}
        <div className="min-w-0">
          <div className="xl:sticky xl:top-[60px]">
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-black/[0.05] px-3.5 py-2.5">
                <span className="grid size-6 place-items-center rounded-md bg-brand-600 text-white">
                  <Sparkles className="size-3" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink">Zybble AI</p>
                  <p className="text-[10px] leading-3.5 text-ink-mute">Turns your words into filters</p>
                </div>
              </div>

              <div className="space-y-3 p-3.5">
                {!plan.ai ? (
                  <div className="rounded-md border border-black/[0.06] bg-neutral-50/70 p-3 text-center">
                    <p className="text-[11.5px] font-medium text-ink">Zybble AI is a paid feature</p>
                    <p className="mt-1 text-[10.5px] leading-4 text-ink-mute">
                      Included on Growth, Agency, and Scale. You can still use the manual filters on any plan.
                    </p>
                    <Btn variant="outline" size="sm" className="mt-2.5 w-full" href="/billing">
                      View plans
                    </Btn>
                  </div>
                ) : (
                  <>
                    <div>
                      <FieldLabel htmlFor="ai-request">Describe what you need</FieldLabel>
                      <textarea
                        id="ai-request"
                        rows={3}
                        value={request}
                        onChange={(e) => setRequest(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            onInterpret();
                          }
                        }}
                        placeholder="e.g. Find 100 dentists in Austin with websites and 4+ ratings"
                        className="w-full resize-y rounded border border-black/[0.09] bg-white px-2.5 py-2 text-[12px] leading-5 text-ink placeholder:text-neutral-400 outline-none transition-colors focus:border-brand-600/50 focus:ring-2 focus:ring-brand-600/15"
                      />
                      <button
                        type="button"
                        onClick={onInterpret}
                        disabled={!request.trim() || aiPhase === "thinking"}
                        className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded bg-ink text-[12px] font-medium text-white transition-all hover:bg-ink/90 active:scale-[0.99] disabled:opacity-40"
                      >
                        {aiPhase === "thinking" ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Wand2 className="size-3.5" aria-hidden="true" />
                        )}
                        {aiPhase === "thinking" ? "Interpreting…" : "Fill in my filters"}
                      </button>
                    </div>

                    {/* four interpretation stages */}
                    {aiPhase === "thinking" || aiPhase === "ready" ? (
                      <div className="rounded-md border border-black/[0.06] bg-neutral-50/70 p-2.5">
                        <ul className="space-y-1.5">
                          {AI_STAGES.map((stage, i) => {
                            const done = aiPhase === "ready" || i < aiStage;
                            const active = aiPhase === "thinking" && i === aiStage;
                            return (
                              <li key={stage} className="flex items-center gap-2">
                                {done ? (
                                  <span className="grid size-3.5 shrink-0 place-items-center rounded-full bg-brand-100">
                                    <Check className="size-2 text-brand-700" strokeWidth={3} aria-hidden="true" />
                                  </span>
                                ) : active ? (
                                  <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-600" aria-hidden="true" />
                                ) : (
                                  <span className="mx-[5px] size-1 shrink-0 rounded-full bg-black/[0.15]" aria-hidden="true" />
                                )}
                                <span
                                  className={cn(
                                    "text-[11px]",
                                    done ? "text-ink-soft" : active ? "font-medium text-ink" : "text-neutral-400"
                                  )}
                                >
                                  {stage}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}

                    {/* interpretation result */}
                    {aiPhase === "ready" ? (
                      <div className="rounded-md border border-brand-600/15 bg-brand-50/50 p-2.5">
                        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-700">
                          <Check className="size-3" aria-hidden="true" />
                          Filters ready
                        </p>
                        {aiSummary ? (
                          <p className="mt-1.5 text-[11.5px] leading-4.5 text-ink-soft">{aiSummary}</p>
                        ) : null}
                        {aiNotes.length ? (
                          <ul className="mt-2 space-y-1">
                            {aiNotes.map((n) => (
                              <li key={n} className="flex gap-1.5 text-[10.5px] leading-4 text-ink-mute">
                                <span
                                  className="mt-[5px] size-1 shrink-0 rounded-full bg-brand-500"
                                  aria-hidden="true"
                                />
                                {n}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <p className="mt-2.5 flex items-start gap-1.5 border-t border-brand-600/10 pt-2 text-[10.5px] leading-4 text-brand-700">
                          <Send className="mt-0.5 size-2.5 shrink-0" aria-hidden="true" />
                          Review the filters, then press <span className="font-semibold">Find leads</span> to run the
                          search.
                        </p>
                      </div>
                    ) : null}

                    {aiPhase === "error" ? (
                      <p
                        role="alert"
                        className="flex items-start gap-1.5 rounded-md bg-red-50 px-2.5 py-2 text-[11px] leading-4 text-red-700"
                      >
                        <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                        {aiError}
                      </p>
                    ) : null}

                    {aiPhase === "idle" ? (
                      <p className="text-[11px] leading-4.5 text-ink-mute">
                        Write the request the way you'd say it out loud. Zybble AI fills in the filters — it never runs
                        a search on its own.
                      </p>
                    ) : null}
                  </>
                )}

                {/* insights from the last run */}
                {stats?.insights?.length ? (
                  <div className="border-t border-black/[0.05] pt-3">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                      Last search
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {stats.insights.map((line) => (
                        <li key={line} className="flex gap-1.5 text-[11px] leading-4.5 text-ink-soft">
                          <span className="mt-[6px] size-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="border-t border-black/[0.05] px-3.5 py-2">
                <p className="text-[9.5px] leading-3.5 text-neutral-400">
                  AI output reflects available business data — <span className="font-medium">verify before outreach</span>.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {ctxLoading ? null : !workspace ? (
        <p className="mt-3 text-[11px] text-ink-mute">Loading your workspace…</p>
      ) : null}
    </AppLayout>
  );
}
