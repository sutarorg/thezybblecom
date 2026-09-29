/* ------------------------------------------------------------------ */
/* Zybble app — Leads database (server-paginated, real data only)      */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Columns3,
  Download,
  FileSearch,
  Filter,
  Mail,
  Phone,
  Search,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import { LeadsTable } from "../components/LeadsTable";
import {
  Badge,
  Btn,
  EmptyState,
  Input,
  PopItem,
  PopLabel,
  PopSep,
  Popover,
  useToast,
} from "../components/ui";
import type { Lead, LeadStatus } from "../data/types";
import { useAppSeo } from "../hooks";
import { deleteLeads, getLeadFacets, getLists, listLeads, runExport } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

const COLUMNS = [
  { id: "category", label: "Category" },
  { id: "rating", label: "Rating & reviews" },
  { id: "phone", label: "Phone" },
  { id: "website", label: "Website" },
  { id: "location", label: "Location" },
  { id: "status", label: "Status" },
  { id: "list", label: "List" },
];

const PAGE_SIZE = 25;

export function LeadsPage() {
  useAppSeo("Leads — Zybble", "Your collected business leads.", "/leads");
  const toast = useToast();
  const { workspace, loading: ctxLoading } = useWorkspaceContext();

  const [rows, setRows] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [rating, setRating] = useState("");
  const [status, setStatus] = useState("");
  const [withWebsite, setWithWebsite] = useState(false);
  const [withEmail, setWithEmail] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(COLUMNS.map((c) => c.id));

  const [facets, setFacets] = useState<{ cities: string[]; categories: string[] }>({
    cities: [],
    categories: [],
  });
  const [listNames, setListNames] = useState<Record<string, string>>({});

  /* debounce the text search so we don't hammer PostgREST */
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const load = useCallback(() => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    listLeads(workspace.id, {
      search: debounced || undefined,
      city: city || undefined,
      category: category || undefined,
      minRating: rating ? Number(rating) : undefined,
      status: (status as LeadStatus) || undefined,
      withWebsite,
      withEmail,
      pageSize: 500,
    })
      .then((res) => {
        setRows(res.rows);
        setTotal(res.total);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace, debounced, city, category, rating, status, withWebsite, withEmail]);

  useEffect(() => {
    if (!ctxLoading && !workspace) setLoading(false);
    load();
  }, [load, ctxLoading, workspace]);

  useEffect(() => {
    if (!workspace) return;
    getLeadFacets(workspace.id).then(setFacets).catch(() => undefined);
    getLists(workspace.id)
      .then((ls) => setListNames(Object.fromEntries(ls.map((l) => [l.id, l.name]))))
      .catch(() => undefined);
  }, [workspace]);

  const activeCount =
    [city, category, rating, status].filter(Boolean).length + (withWebsite ? 1 : 0) + (withEmail ? 1 : 0);

  const clearFilters = () => {
    setCity("");
    setCategory("");
    setRating("");
    setStatus("");
    setWithWebsite(false);
    setWithEmail(false);
  };

  const hasAnyFilter = activeCount > 0 || debounced.length > 0;
  const isEmptyAccount = !loading && !hasAnyFilter && rows.length === 0;

  const emptyState = useMemo(
    () =>
      isEmptyAccount ? (
        <EmptyState
          icon={<FileSearch className="size-4" aria-hidden="true" />}
          title="No leads yet"
          description="Run your first search and the businesses you discover will be collected here, ready to organize and export."
          action={
            <Btn variant="primary" href="/find">
              <Search className="size-3.5" aria-hidden="true" />
              Find your first leads
            </Btn>
          }
        />
      ) : undefined,
    [isEmptyAccount]
  );

  return (
    <AppLayout
      title="Leads"
      description="Every business you've collected — search, segment, and work them."
      aside={
        <>
          <Btn variant="outline" href="/find">
            <Search className="size-3.5" aria-hidden="true" />
            Find leads
          </Btn>
          <Btn
            variant="primary"
            onClick={async () => {
              if (!workspace || !rows.length) {
                toast("There are no leads to export yet.", "info");
                return;
              }
              const res = await runExport({
                workspaceId: workspace.id,
                leadIds: rows.map((r) => r.id),
                source: "Leads",
              });
              if (res.error) {
                toast(res.error, "error");
                return;
              }
              toast("Export ready — find it in Exports");
            }}
          >
            <Download className="size-3.5" aria-hidden="true" />
            Export
          </Btn>
        </>
      }
      wide
    >
      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads…"
            aria-label="Search leads"
            className="pl-8"
          />
        </div>

        <Popover
          width="w-64"
          trigger={(_, toggle) => (
            <Btn variant="outline" size="sm" onClick={toggle}>
              <Filter className="size-3.5 text-neutral-400" aria-hidden="true" />
              Filters
              {activeCount > 0 ? (
                <span className="grid size-4 place-items-center rounded-full bg-brand-600 text-[9.5px] font-semibold text-white">
                  {activeCount}
                </span>
              ) : (
                <ChevronDown className="size-3 text-neutral-400" aria-hidden="true" />
              )}
            </Btn>
          )}
        >
          <PopLabel>Filters</PopLabel>
          <div className="grid grid-cols-2 gap-2 px-2 pb-2 pt-1">
            <div>
              <p className="mb-1 text-[10px] font-medium text-neutral-400">City</p>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="h-7 w-full rounded border border-black/[0.09] bg-white px-1.5 text-xs text-ink outline-none focus:border-brand-600/50"
                aria-label="Filter by city"
              >
                <option value="">All cities</option>
                {facets.cities.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-medium text-neutral-400">Category</p>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-7 w-full rounded border border-black/[0.09] bg-white px-1.5 text-xs text-ink outline-none focus:border-brand-600/50"
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {facets.categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-medium text-neutral-400">Min rating</p>
              <select
                value={rating}
                onChange={(e) => setRating(e.target.value)}
                className="h-7 w-full rounded border border-black/[0.09] bg-white px-1.5 text-xs text-ink outline-none focus:border-brand-600/50"
                aria-label="Filter by minimum rating"
              >
                <option value="">Any</option>
                <option value="3.5">3.5+</option>
                <option value="4">4.0+</option>
                <option value="4.5">4.5+</option>
              </select>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-medium text-neutral-400">Status</p>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-7 w-full rounded border border-black/[0.09] bg-white px-1.5 text-xs text-ink outline-none focus:border-brand-600/50"
                aria-label="Filter by status"
              >
                <option value="">Any</option>
                <option value="new">New</option>
                <option value="enriched">Enriched</option>
                <option value="contacted">Contacted</option>
              </select>
            </div>
          </div>
          <PopSep />
          <div className="space-y-0.5 px-1 py-1">
            {[
              { label: "Has website", icon: <Phone className="size-3" />, state: withWebsite, set: setWithWebsite },
              { label: "Has email", icon: <Mail className="size-3" />, state: withEmail, set: setWithEmail },
            ].map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => t.set(!t.state)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-soft transition-colors hover:bg-black/[0.045]"
              >
                <span
                  className={cn(
                    "grid size-3.5 place-items-center rounded border",
                    t.state ? "border-brand-600 bg-brand-600 text-white" : "border-black/[0.15] text-transparent"
                  )}
                >
                  <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
                </span>
                {t.label}
              </button>
            ))}
          </div>
          {activeCount > 0 ? (
            <>
              <PopSep />
              <PopItem danger onClick={clearFilters}>
                Clear all filters
              </PopItem>
            </>
          ) : null}
        </Popover>

        <Popover
          align="end"
          width="w-48"
          trigger={(_, toggle) => (
            <Btn variant="outline" size="sm" onClick={toggle}>
              <Columns3 className="size-3.5 text-neutral-400" aria-hidden="true" />
              Columns
            </Btn>
          )}
        >
          <PopLabel>Visible columns</PopLabel>
          {COLUMNS.map((col) => {
            const on = visibleCols.includes(col.id);
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => setVisibleCols((v) => (on ? v.filter((x) => x !== col.id) : [...v, col.id]))}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-soft transition-colors hover:bg-black/[0.045]"
              >
                <span
                  className={cn(
                    "grid size-3.5 place-items-center rounded border",
                    on ? "border-brand-600 bg-brand-600 text-white" : "border-black/[0.15] text-transparent"
                  )}
                >
                  <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
                </span>
                {col.label}
              </button>
            );
          })}
        </Popover>

        {activeCount > 0 ? (
          <Badge tone="green">
            {activeCount} filter{activeCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
        {!loading ? (
          <span className="ml-auto text-[11px] text-ink-mute">
            {rows.length.toLocaleString()}
            {total > rows.length ? ` of ${total.toLocaleString()}` : ""} leads
          </span>
        ) : null}
      </div>

      <LeadsTable
        leads={rows}
        loading={loading || ctxLoading}
        error={error}
        onRetry={load}
        pageSize={PAGE_SIZE}
        listNames={listNames}
        noLists={!visibleCols.includes("list")}
        emptyState={emptyState}
        onBulk={async (action, ids) => {
          if (!workspace) return;
          if (action === "delete") {
            try {
              await deleteLeads(ids);
              setRows((r) => r.filter((x) => !ids.includes(x.id)));
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }
          if (action === "export") {
            const res = await runExport({ workspaceId: workspace.id, leadIds: ids, source: "Selection" });
            if (res.error) toast(res.error, "error");
          }
        }}
      />
    </AppLayout>
  );
}
