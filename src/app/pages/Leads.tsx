/* ------------------------------------------------------------------ */
/* Zybble app — Leads database                                         */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Columns3,
  Download,
  Filter,
  Mail,
  Phone,
  Search,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import { LeadsTable } from "../components/LeadsTable";
import { Badge, Btn, Input, PopItem, PopLabel, PopSep, Popover, useToast } from "../components/ui";
import { LEADS } from "../data/mock";
import type { Lead } from "../data/types";
import { useAppSeo } from "../hooks";
import { BACKEND_ENABLED, deleteLeads, listLeads } from "../services/api";
import { useWorkspace } from "../services/hooks";

const CITIES = Array.from(new Set(LEADS.map((l) => l.city))).sort();
const CATEGORIES = Array.from(new Set(LEADS.map((l) => l.category))).sort();
const COLUMNS = [
  { id: "category", label: "Category" },
  { id: "rating", label: "Rating & reviews" },
  { id: "phone", label: "Phone" },
  { id: "website", label: "Website" },
  { id: "location", label: "Location" },
  { id: "status", label: "Status" },
  { id: "list", label: "List" },
];

export function LeadsPage() {
  useAppSeo("Leads — Zybble", "Your collected business leads, in one structured database.", "/leads");
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>(LEADS);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [rating, setRating] = useState("");
  const [status, setStatus] = useState("");
  const [withWebsite, setWithWebsite] = useState(false);
  const [withEmail, setWithEmail] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(COLUMNS.map((c) => c.id));
  const { workspace } = useWorkspace();

  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 520);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!BACKEND_ENABLED || !workspace) return;
    setLoading(true);
    listLeads(workspace.id, { pageSize: 500 })
      .then((res) => setLeads(res.rows))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [workspace]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((lead) => {
      if (q && !`${lead.name} ${lead.category} ${lead.city} ${lead.state} ${lead.email ?? ""}`.toLowerCase().includes(q)) return false;
      if (city && lead.city !== city) return false;
      if (category && lead.category !== category) return false;
      if (rating && lead.rating < Number(rating.replace("+", ""))) return false;
      if (status && lead.status.toLowerCase() !== status.toLowerCase()) return false;
      if (withWebsite && !lead.website) return false;
      if (withEmail && !lead.email) return false;
      return true;
    });
  }, [leads, query, city, category, rating, status, withWebsite, withEmail]);

  const activeCount = [city, category, rating, status].filter(Boolean).length + (withWebsite ? 1 : 0) + (withEmail ? 1 : 0);

  return (
    <AppLayout
      title="Leads"
      description="Every business you've collected — search, segment, and work them."
      aside={
        <>
          <Btn variant="outline" href="#/find">
            <Search className="size-3.5" aria-hidden="true" />
            Find leads
          </Btn>
          <Btn
            variant="primary"
            onClick={() => toast("Select lead rows to export them", "info")}
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
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads…"
            aria-label="Search leads"
            className="pl-8"
          />
        </div>

        {/* filters popover */}
        <Popover
          width="w-64"
          trigger={(_, toggle) => (
            <Btn variant="outline" size="sm" onClick={toggle}>
              <Filter className="size-3.5 text-neutral-400" aria-hidden="true" />
              Filters
              {activeCount > 0 ? (
                <span className="grid size-4 place-items-center rounded-full bg-brand-600 text-[9.5px] font-semibold text-white">{activeCount}</span>
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
                {CITIES.map((c) => (
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
                {CATEGORIES.map((c) => (
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
                <option>3.5+</option>
                <option>4.0+</option>
                <option>4.5+</option>
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
                <option>New</option>
                <option>Enriched</option>
                <option>Contacted</option>
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
                <span className={cn("grid size-3.5 place-items-center rounded border", t.state ? "border-brand-600 bg-brand-600 text-white" : "border-black/[0.15] text-transparent")}>
                  <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
                </span>
                {t.label}
              </button>
            ))}
          </div>
          {activeCount > 0 ? (
            <>
              <PopSep />
              <PopItem
                danger
                onClick={() => {
                  setCity("");
                  setCategory("");
                  setRating("");
                  setStatus("");
                  setWithWebsite(false);
                  setWithEmail(false);
                }}
              >
                Clear all filters
              </PopItem>
            </>
          ) : null}
        </Popover>

        {/* columns popover */}
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
                <span className={cn("grid size-3.5 place-items-center rounded border", on ? "border-brand-600 bg-brand-600 text-white" : "border-black/[0.15] text-transparent")}>
                  <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
                </span>
                {col.label}
              </button>
            );
          })}
        </Popover>

        {activeCount > 0 ? <Badge tone="green">{activeCount} filter{activeCount === 1 ? "" : "s"}</Badge> : null}
        <span className="ml-auto text-[11px] text-ink-mute">{filtered.length.toLocaleString()} of {leads.length.toLocaleString()}</span>
      </div>

      <LeadsTable
        leads={filtered}
        loading={loading}
        pageSize={12}
        onBulk={(action, ids) => {
          if (action === "delete") {
            setLeads((l) => l.filter((x) => !ids.includes(x.id)));
            if (BACKEND_ENABLED) deleteLeads(ids);
          }
        }}
      />
    </AppLayout>
  );
}
