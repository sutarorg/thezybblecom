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
import { LeadsTable, type LeadColumnId } from "../components/LeadsTable";
import {
  Badge,
  Btn,
  Dialog,
  DialogHeader,
  EmptyState,
  FieldLabel,
  Input,
  PopItem,
  PopLabel,
  PopSep,
  Popover,
  useToast,
} from "../components/ui";
import type { Lead, LeadStatus } from "../data/types";
import { useAppSeo } from "../hooks";
import { addToList, applyTagToLeads, createList, deleteLeads, downloadCsv, getLeadFacets, getLists, listLeads, runExport, updateLeadStatus } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

const COLUMNS: { id: LeadColumnId; label: string }[] = [
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
  const [tag, setTag] = useState("");
  const [withWebsite, setWithWebsite] = useState(false);
  const [withEmail, setWithEmail] = useState(false);
  const [visibleCols, setVisibleCols] = useState<LeadColumnId[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("zybble.leads.columns") ?? "null") as LeadColumnId[] | null;
      return saved?.length ? saved : COLUMNS.map((c) => c.id);
    } catch {
      return COLUMNS.map((c) => c.id);
    }
  });
  const [listDialogIds, setListDialogIds] = useState<string[]>([]);
  const [tagDialogIds, setTagDialogIds] = useState<string[]>([]);
  const [newListName, setNewListName] = useState("");
  const [newListDescription, setNewListDescription] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [tagMode, setTagMode] = useState<"add" | "remove">("add");
  const [savingDialog, setSavingDialog] = useState(false);

  const [facets, setFacets] = useState<{ cities: string[]; categories: string[]; tags: string[] }>({
    cities: [],
    categories: [],
    tags: [],
  });
  const [lists, setLists] = useState<{ id: string; name: string; description: string; lead_count: number }[]>([]);
  const [listNames, setListNames] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      localStorage.setItem("zybble.leads.columns", JSON.stringify(visibleCols));
    } catch {
      /* storage unavailable */
    }
  }, [visibleCols]);

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
      tag: tag || undefined,
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
  }, [workspace, debounced, city, category, rating, status, tag, withWebsite, withEmail]);

  useEffect(() => {
    if (!ctxLoading && !workspace) setLoading(false);
    load();
  }, [load, ctxLoading, workspace]);

  useEffect(() => {
    if (!workspace) return;
    getLeadFacets(workspace.id).then(setFacets).catch(() => undefined);
    getLists(workspace.id)
      .then((ls) => {
        setLists(ls);
        setListNames(Object.fromEntries(ls.map((l) => [l.id, l.name])));
      })
      .catch(() => undefined);
  }, [workspace]);

  const activeCount =
    [city, category, rating, status, tag].filter(Boolean).length + (withWebsite ? 1 : 0) + (withEmail ? 1 : 0);

  const clearFilters = () => {
    setCity("");
    setCategory("");
    setRating("");
    setStatus("");
    setTag("");
    setWithWebsite(false);
    setWithEmail(false);
  };

  const hasAnyFilter = activeCount > 0 || debounced.length > 0;
  const isEmptyAccount = !loading && !hasAnyFilter && rows.length === 0;

  const addSelectedToExistingList = async (listId: string) => {
    setSavingDialog(true);
    try {
      await addToList(listId, listDialogIds);
      setRows((r) => r.map((lead) => (listDialogIds.includes(lead.id) ? { ...lead, list_ids: [...new Set([...lead.list_ids, listId])] } : lead)));
      toast(`${listDialogIds.length} ${listDialogIds.length === 1 ? "lead" : "leads"} added to list`);
      setListDialogIds([]);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingDialog(false);
    }
  };

  const createListAndAdd = async () => {
    if (!workspace || !newListName.trim()) return;
    setSavingDialog(true);
    try {
      const list = await createList(workspace.id, newListName.trim(), newListDescription.trim());
      await addToList(list.id, listDialogIds);
      setLists((ls) => [{ ...list, lead_count: listDialogIds.length }, ...ls]);
      setListNames((m) => ({ ...m, [list.id]: list.name }));
      setRows((r) => r.map((lead) => (listDialogIds.includes(lead.id) ? { ...lead, list_ids: [...new Set([...lead.list_ids, list.id])] } : lead)));
      setNewListName("");
      setNewListDescription("");
      setListDialogIds([]);
      toast(`Created “${list.name}” and added ${listDialogIds.length} ${listDialogIds.length === 1 ? "lead" : "leads"}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingDialog(false);
    }
  };

  const applyBulkTag = async () => {
    if (!bulkTag.trim()) return;
    setSavingDialog(true);
    try {
      await applyTagToLeads(tagDialogIds, bulkTag, tagMode);
      setRows((r) => r.map((lead) => {
        if (!tagDialogIds.includes(lead.id)) return lead;
        const normalized = bulkTag.trim().toLowerCase();
        return { ...lead, tags: tagMode === "add" ? [...new Set([...lead.tags, normalized])] : lead.tags.filter((t) => t !== normalized) };
      }));
      if (tagMode === "add") setFacets((f) => ({ ...f, tags: [...new Set([...f.tags, bulkTag.trim().toLowerCase()])].sort() }));
      setBulkTag("");
      setTagDialogIds([]);
      toast(tagMode === "add" ? "Tag applied" : "Tag removed");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingDialog(false);
    }
  };

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
              if (res.export?.csv) downloadCsv(res.export.csv, res.export.file_name);
              toast("CSV export downloaded");
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
                <option value="contacted">Contacted</option>
              </select>
            </div>
            <div className="col-span-2">
              <p className="mb-1 text-[10px] font-medium text-neutral-400">Tags</p>
              <select
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="h-7 w-full rounded border border-black/[0.09] bg-white px-1.5 text-xs text-ink outline-none focus:border-brand-600/50"
                aria-label="Filter by tag"
              >
                <option value="">All tags</option>
                {facets.tags.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
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
        visibleColumns={visibleCols}
        emptyState={emptyState}
        onAddToList={(ids) => setListDialogIds(ids)}
        onBulk={async (action, ids) => {
          if (!workspace) return;
          if (action === "list") setListDialogIds(ids);
          if (action === "tag") setTagDialogIds(ids);
          if (action === "status:new" || action === "status:contacted") {
            const next = action === "status:new" ? "new" : "contacted";
            try {
              await Promise.all(ids.map((id) => updateLeadStatus(id, next)));
              setRows((r) => r.map((lead) => (ids.includes(lead.id) ? { ...lead, status: next } : lead)));
              toast(`Status updated to ${next === "new" ? "New" : "Contacted"}`);
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }
          if (action === "delete") {
            try {
              await deleteLeads(ids);
              setRows((r) => r.filter((x) => !ids.includes(x.id)));
              toast("Leads removed");
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }
          if (action === "export") {
            const res = await runExport({ workspaceId: workspace.id, leadIds: ids, source: "Selection" });
            if (res.error) {
              toast(res.error, "error");
            } else {
              if (res.export?.csv) downloadCsv(res.export.csv, res.export.file_name);
              toast("CSV export downloaded");
            }
          }
        }}
      />

      <Dialog open={listDialogIds.length > 0} onClose={() => setListDialogIds([])} label="Add selected leads to a list" maxWidth="max-w-lg">
        <DialogHeader title="Add to list" description={`${listDialogIds.length} selected ${listDialogIds.length === 1 ? "lead" : "leads"}`} onClose={() => setListDialogIds([])} />
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-ink">Existing lists</p>
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto thin-scroll pr-1">
              {lists.length ? lists.map((list) => (
                <button
                  key={list.id}
                  type="button"
                  disabled={savingDialog}
                  onClick={() => addSelectedToExistingList(list.id)}
                  className="flex w-full items-center justify-between gap-2 rounded border border-black/[0.06] px-2.5 py-2 text-left text-xs hover:bg-neutral-50 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{list.name}</span>
                    <span className="text-[10.5px] text-neutral-400">{list.lead_count} leads</span>
                  </span>
                  <span className="font-medium text-brand-700">Add</span>
                </button>
              )) : <p className="rounded border border-dashed border-black/[0.08] p-3 text-[11px] text-ink-mute">No lists yet — create one here.</p>}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-ink">Create list</p>
            <div className="mt-2 space-y-2">
              <div>
                <FieldLabel htmlFor="bulk-list-name">List name</FieldLabel>
                <Input id="bulk-list-name" value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="e.g. Florida dentists" />
              </div>
              <div>
                <FieldLabel htmlFor="bulk-list-description">Description optional</FieldLabel>
                <Input id="bulk-list-description" value={newListDescription} onChange={(e) => setNewListDescription(e.target.value)} placeholder="Why this list exists" />
              </div>
              <Btn variant="primary" size="sm" className="w-full" disabled={!newListName.trim() || savingDialog} onClick={createListAndAdd}>
                Create and add leads
              </Btn>
            </div>
          </div>
        </div>
      </Dialog>

      <Dialog open={tagDialogIds.length > 0} onClose={() => setTagDialogIds([])} label="Tag selected leads" maxWidth="max-w-md">
        <DialogHeader title="Bulk tag leads" description="Tags must be a single lowercase word." onClose={() => setTagDialogIds([])} />
        <div className="space-y-3 px-4 py-4">
          {facets.tags.length ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Existing tags</p>
              <div className="flex flex-wrap gap-1">
                {facets.tags.map((t) => <button key={t} type="button" onClick={() => setBulkTag(t)} className="rounded bg-neutral-100 px-1.5 py-1 text-[11px] text-ink-soft hover:bg-brand-50 hover:text-brand-700">{t}</button>)}
              </div>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div>
              <FieldLabel htmlFor="bulk-tag">Tag</FieldLabel>
              <Input id="bulk-tag" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="priority" />
            </div>
            <div>
              <FieldLabel>Action</FieldLabel>
              <select value={tagMode} onChange={(e) => setTagMode(e.target.value as "add" | "remove")} className="h-8 rounded border border-black/[0.09] bg-white px-2 text-xs text-ink">
                <option value="add">Add</option>
                <option value="remove">Remove</option>
              </select>
            </div>
          </div>
          <Btn variant="primary" size="sm" className="w-full" disabled={!bulkTag.trim() || savingDialog} onClick={applyBulkTag}>
            Apply to {tagDialogIds.length} {tagDialogIds.length === 1 ? "lead" : "leads"}
          </Btn>
        </div>
      </Dialog>
    </AppLayout>
  );
}
