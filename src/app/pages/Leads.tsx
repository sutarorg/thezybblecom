/* ------------------------------------------------------------------ */
/* Zybble app — Leads database (server-paginated, real data only)      */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Columns3,
  Download,
  FileSearch,
  Filter,
  LoaderCircle,
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
  Textarea,
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
  const [listQuery, setListQuery] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [tagMode, setTagMode] = useState<"add" | "remove">("add");
  const [savingDialog, setSavingDialog] = useState(false);
  const savingDialogRef = useRef(false);
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const [selectionClearSignal, setSelectionClearSignal] = useState(0);

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
  const filteredLists = useMemo(() => {
    const value = listQuery.trim().toLowerCase();
    return value ? lists.filter((list) => list.name.toLowerCase().includes(value)) : lists;
  }, [listQuery, lists]);

  const closeListDialog = () => {
    if (savingDialogRef.current) return;
    setListDialogIds([]);
    setListQuery("");
  };
  const closeTagDialog = () => {
    if (savingDialogRef.current) return;
    setTagDialogIds([]);
    setBulkTag("");
    setTagMode("add");
  };

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
    if (savingDialogRef.current) return;
    const leadIds = [...listDialogIds];
    if (!leadIds.length) return;
    savingDialogRef.current = true;
    setSavingDialog(true);
    setSavingTarget(`list:${listId}`);
    try {
      await addToList(listId, leadIds);
      const newlyAdded = rows.filter((lead) => leadIds.includes(lead.id) && !lead.list_ids.includes(listId)).length;
      setRows((current) => current.map((lead) => (leadIds.includes(lead.id) ? { ...lead, list_ids: [...new Set([...lead.list_ids, listId])] } : lead)));
      if (newlyAdded > 0) {
        setLists((current) => current.map((list) => list.id === listId ? { ...list, lead_count: list.lead_count + newlyAdded } : list));
      }
      toast(`${leadIds.length} ${leadIds.length === 1 ? "lead" : "leads"} added to list`);
      setListDialogIds([]);
      setListQuery("");
      setSelectionClearSignal((signal) => signal + 1);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      savingDialogRef.current = false;
      setSavingDialog(false);
      setSavingTarget(null);
    }
  };

  const createListAndAdd = async () => {
    if (!workspace || !newListName.trim() || savingDialogRef.current) return;
    const leadIds = [...listDialogIds];
    if (!leadIds.length) return;
    savingDialogRef.current = true;
    setSavingDialog(true);
    setSavingTarget("create-list");
    try {
      const list = await createList(workspace.id, newListName.trim(), newListDescription.trim());
      await addToList(list.id, leadIds);
      setLists((current) => [{ ...list, lead_count: leadIds.length }, ...current]);
      setListNames((current) => ({ ...current, [list.id]: list.name }));
      setRows((current) => current.map((lead) => (leadIds.includes(lead.id) ? { ...lead, list_ids: [...new Set([...lead.list_ids, list.id])] } : lead)));
      setNewListName("");
      setNewListDescription("");
      setListQuery("");
      setListDialogIds([]);
      setSelectionClearSignal((signal) => signal + 1);
      toast(`Created “${list.name}” and added ${leadIds.length} ${leadIds.length === 1 ? "lead" : "leads"}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      savingDialogRef.current = false;
      setSavingDialog(false);
      setSavingTarget(null);
    }
  };

  const applyBulkTag = async () => {
    if (!bulkTag.trim() || savingDialogRef.current) return;
    const leadIds = [...tagDialogIds];
    const normalizedTag = bulkTag.trim().toLowerCase();
    const mode = tagMode;
    if (!leadIds.length) return;
    savingDialogRef.current = true;
    setSavingDialog(true);
    setSavingTarget("tag");
    try {
      await applyTagToLeads(leadIds, normalizedTag, mode);
      setRows((current) => current.map((lead) => {
        if (!leadIds.includes(lead.id)) return lead;
        return { ...lead, tags: mode === "add" ? [...new Set([...lead.tags, normalizedTag])] : lead.tags.filter((value) => value !== normalizedTag) };
      }));
      if (mode === "add") setFacets((current) => ({ ...current, tags: [...new Set([...current.tags, normalizedTag])].sort() }));
      setBulkTag("");
      setTagDialogIds([]);
      setSelectionClearSignal((signal) => signal + 1);
      toast(mode === "add" ? `Tag “${normalizedTag}” added` : `Tag “${normalizedTag}” removed`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      savingDialogRef.current = false;
      setSavingDialog(false);
      setSavingTarget(null);
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
        selectionClearSignal={selectionClearSignal}
        onAddToList={(ids) => setListDialogIds([...ids])}
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
              return true;
            } catch (e) {
              toast((e as Error).message, "error");
              return false;
            }
          }
          if (action === "delete") {
            try {
              await deleteLeads(ids);
              setRows((r) => r.filter((x) => !ids.includes(x.id)));
              toast("Leads removed");
              return true;
            } catch (e) {
              toast((e as Error).message, "error");
              return false;
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

      <Dialog open={listDialogIds.length > 0} onClose={closeListDialog} label="Add selected leads to a list" maxWidth="max-w-2xl">
        <DialogHeader
          title="Add to list"
          description={`${listDialogIds.length} selected ${listDialogIds.length === 1 ? "lead" : "leads"}`}
          onClose={closeListDialog}
        />
        <div className="grid min-w-0 sm:grid-cols-2">
          <section className="min-w-0 border-b border-black/[0.05] px-4 py-4 sm:border-b-0 sm:border-r">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink">Existing lists</p>
              <span className="text-[10.5px] text-ink-mute">{lists.length} total</span>
            </div>
            {lists.length > 5 ? (
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300" aria-hidden="true" />
                <Input
                  data-dialog-autofocus
                  value={listQuery}
                  onChange={(event) => setListQuery(event.target.value)}
                  placeholder="Search lists…"
                  aria-label="Search existing lists"
                  disabled={savingDialog}
                  className="pl-8"
                />
              </div>
            ) : null}
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1 thin-scroll">
              {filteredLists.length ? filteredLists.map((list, index) => {
                const alreadyAdded = listDialogIds.every((id) => rows.find((lead) => lead.id === id)?.list_ids.includes(list.id));
                const savingThisList = savingTarget === `list:${list.id}`;
                return (
                  <button
                    key={list.id}
                    type="button"
                    data-dialog-autofocus={lists.length <= 5 && index === 0 ? "" : undefined}
                    disabled={savingDialog || alreadyAdded}
                    onClick={() => void addSelectedToExistingList(list.id)}
                    aria-label={alreadyAdded ? `All selected leads are already in ${list.name}` : `Add selected leads to ${list.name}`}
                    className={cn(
                      "flex w-full min-w-0 items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left text-xs outline-none transition-colors focus-visible:border-brand-600/40 focus-visible:ring-2 focus-visible:ring-brand-600/15 disabled:cursor-default",
                      alreadyAdded ? "border-brand-600/10 bg-brand-50/50" : "border-black/[0.07] bg-white hover:border-black/[0.12] hover:bg-neutral-50",
                      savingDialog && !savingThisList && "opacity-50"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{list.name}</span>
                      <span className="text-[10.5px] text-neutral-400">{list.lead_count.toLocaleString()} {list.lead_count === 1 ? "lead" : "leads"}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 font-medium text-brand-700">
                      {savingThisList ? <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> : alreadyAdded ? <Check className="size-3" aria-hidden="true" /> : null}
                      {savingThisList ? "Adding…" : alreadyAdded ? "Added" : "Add"}
                    </span>
                  </button>
                );
              }) : (
                <p className="rounded-md border border-dashed border-black/[0.09] px-3 py-5 text-center text-[11px] leading-5 text-ink-mute">
                  {lists.length ? "No lists match that search." : "No lists yet — create one here."}
                </p>
              )}
            </div>
          </section>

          <section className="min-w-0 px-4 py-4">
            <p className="text-xs font-semibold text-ink">Create a new list</p>
            <p className="mt-0.5 text-[11px] leading-4 text-ink-mute">Create the list and add this selection in one step.</p>
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void createListAndAdd();
              }}
            >
              <div>
                <FieldLabel htmlFor="bulk-list-name">List name</FieldLabel>
                <Input
                  id="bulk-list-name"
                  data-dialog-autofocus={lists.length === 0 ? "" : undefined}
                  value={newListName}
                  onChange={(event) => setNewListName(event.target.value)}
                  placeholder="e.g. Florida dentists"
                  disabled={savingDialog}
                  maxLength={100}
                />
              </div>
              <div>
                <FieldLabel htmlFor="bulk-list-description">Description <span className="font-normal text-ink-mute">(optional)</span></FieldLabel>
                <Textarea
                  id="bulk-list-description"
                  value={newListDescription}
                  onChange={(event) => setNewListDescription(event.target.value)}
                  placeholder="Why this list exists"
                  disabled={savingDialog}
                  maxLength={300}
                  className="min-h-[70px] resize-none"
                />
              </div>
              <Btn variant="primary" size="sm" type="submit" className="w-full" disabled={!newListName.trim() || savingDialog}>
                {savingTarget === "create-list" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                {savingTarget === "create-list" ? "Creating and adding…" : "Create and add leads"}
              </Btn>
            </form>
          </section>
        </div>
      </Dialog>

      <Dialog open={tagDialogIds.length > 0} onClose={closeTagDialog} label="Tag selected leads" maxWidth="max-w-md">
        <DialogHeader
          title="Tag leads"
          description={`${tagDialogIds.length} selected ${tagDialogIds.length === 1 ? "lead" : "leads"}`}
          onClose={closeTagDialog}
        />
        <form
          className="space-y-4 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void applyBulkTag();
          }}
        >
          {facets.tags.length ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Existing tags</p>
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1 thin-scroll" aria-label="Existing tags">
                {facets.tags.map((value) => {
                  const active = bulkTag.trim().toLowerCase() === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={savingDialog}
                      aria-pressed={active}
                      onClick={() => setBulkTag(value)}
                      className={cn(
                        "rounded border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-600/20 disabled:opacity-50",
                        active ? "border-brand-600/20 bg-brand-50 text-brand-700" : "border-black/[0.07] bg-neutral-50 text-ink-soft hover:border-black/[0.12] hover:bg-neutral-100"
                      )}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <FieldLabel htmlFor="bulk-tag">Tag</FieldLabel>
            <Input
              id="bulk-tag"
              data-dialog-autofocus
              value={bulkTag}
              onChange={(event) => setBulkTag(event.target.value)}
              placeholder="priority"
              disabled={savingDialog}
              autoComplete="off"
              maxLength={40}
            />
            <p className="mt-1 text-[10.5px] text-ink-mute">Use one lowercase word. Hyphens and underscores are allowed.</p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink">Action</p>
            <div className="grid grid-cols-2 rounded-md border border-black/[0.08] bg-neutral-50 p-0.5" role="group" aria-label="Tag action">
              {(["add", "remove"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={savingDialog}
                  aria-pressed={tagMode === mode}
                  onClick={() => setTagMode(mode)}
                  className={cn(
                    "h-7 rounded text-xs font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-brand-600/20",
                    tagMode === mode ? "border border-black/[0.07] bg-white text-ink shadow-sm" : "text-ink-mute hover:text-ink"
                  )}
                >
                  {mode === "add" ? "Add" : "Remove"}
                </button>
              ))}
            </div>
          </div>

          <Btn variant="primary" size="sm" type="submit" className="w-full" disabled={!bulkTag.trim() || savingDialog}>
            {savingTarget === "tag" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {savingTarget === "tag"
              ? tagMode === "add" ? "Adding tag…" : "Removing tag…"
              : `${tagMode === "add" ? "Add" : "Remove"} tag ${tagMode === "add" ? "to" : "from"} ${tagDialogIds.length} ${tagDialogIds.length === 1 ? "lead" : "leads"}`}
          </Btn>
        </form>
      </Dialog>
    </AppLayout>
  );
}
