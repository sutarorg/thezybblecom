/* ------------------------------------------------------------------ */
/* Zybble app — Search history                                         */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  History,
  ListPlus,
  MoreHorizontal,
  RefreshCw,
  Search,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import {
  Badge,
  Btn,
  ConfirmDialog,
  EmptyState,
  IconBtn,
  Input,
  MetaText,
  Pagination,
  PopItem,
  Popover,
  TableSkeleton,
  useToast,
} from "../components/ui";
import { LISTS, SEARCH_HISTORY } from "../data/mock";
import type { SearchRecord } from "../data/types";
import { navigate, useAppSeo } from "../hooks";
import { BACKEND_ENABLED, deleteSearch, getSearches } from "../services/api";
import { useWorkspace } from "../services/hooks";

const PAGE_SIZE = 10;
const STATUS_META: Record<SearchRecord["status"], { tone: "green" | "amber" | "red"; label: string }> = {
  completed: { tone: "green", label: "Completed" },
  partial: { tone: "amber", label: "Partial" },
  failed: { tone: "red", label: "Failed" },
};

export function SearchHistoryPage() {
  useAppSeo("Search history — Zybble", "Every search you've run, ready to re-run or save.", "/search-history");
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<SearchRecord[]>(SEARCH_HISTORY);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | SearchRecord["status"]>("all");
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<SearchRecord | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 460);
    return () => window.clearTimeout(t);
  }, []);

  const { workspace } = useWorkspace();
  useEffect(() => {
    if (!BACKEND_ENABLED || !workspace) return;
    setLoading(true);
    getSearches(workspace.id)
      .then((rows) => setRecords(rows.length ? rows : []))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [workspace]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (q && !`${r.query} ${r.location}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [records, query, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filterBtn = (value: typeof status, label: string, count: number) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        setStatus(value);
        setPage(1);
      }}
      aria-pressed={status === value}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs transition-colors",
        status === value
          ? "bg-ink font-medium text-white"
          : "bg-white text-ink-soft ring-1 ring-black/[0.08] hover:ring-black/[0.16]"
      )}
    >
      {label}
      <span className={cn("text-[10px]", status === value ? "text-white/60" : "text-neutral-400")}>{count}</span>
    </button>
  );

  return (
    <AppLayout
      title="Search history"
      description="Every search you've run — re-run them, save the results, or clean up."
      aside={
        <Btn variant="primary" href="#/find">
          <Search className="size-3.5" aria-hidden="true" />
          New search
        </Btn>
      }
      wide
    >
      {/* controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search history…"
            aria-label="Search history"
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {filterBtn("all", "All", records.length)}
          {filterBtn("completed", "Completed", records.filter((r) => r.status === "completed").length)}
          {filterBtn("partial", "Partial", records.filter((r) => r.status === "partial").length)}
          {filterBtn("failed", "Failed", records.filter((r) => r.status === "failed").length)}
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-black/[0.06] bg-white">
          <TableSkeleton rows={8} cols={5} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<History className="size-4" aria-hidden="true" />}
          title={query ? "Nothing matches" : "No searches yet"}
          description={
            query
              ? "Try a different phrase or clear the status filter."
              : "Searches you run from Find Leads will appear here, one click away from re-running."
          }
          action={<Btn variant="primary" href="#/find">Find leads</Btn>}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[780px] text-left">
              <thead>
                <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                  {["Search query", "Location", "Results", "Status", "Saved list", "When", ""].map((h, i) => (
                    <th key={i} scope="col" className="py-2 pl-3 pr-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((record) => {
                  const list = LISTS.find((l) => l.id === record.list_id);
                  return (
                    <tr
                      key={record.id}
                      onClick={() => navigate("/search-history")}
                      className="group border-b border-black/[0.04] transition-colors last:border-0 hover:bg-neutral-50/70"
                    >
                      <td className="max-w-[300px] py-2 pl-3 pr-3">
                        <a
                          href="#/find"
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate text-xs font-medium text-ink transition-colors hover:text-brand-700"
                        >
                          {record.query}
                        </a>
                      </td>
                      <td className="py-2 pl-3 pr-3 text-xs text-ink-soft">{record.location}</td>
                      <td className="py-2 pl-3 pr-3">
                        <span className="text-xs text-ink-soft">{record.results.toLocaleString()}</span>
                      </td>
                      <td className="py-2 pl-3 pr-3">
                        <Badge tone={STATUS_META[record.status].tone}>{STATUS_META[record.status].label}</Badge>
                      </td>
                      <td className="py-2 pl-3 pr-3">
                        {list ? (
                          <a
                            href={`#/lists/${list.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-600"
                          >
                            <ListPlus className="size-3" aria-hidden="true" />
                            {list.name}
                          </a>
                        ) : (
                          <span className="text-[11px] text-neutral-300">—</span>
                        )}
                      </td>
                      <td className="py-2 pl-3 pr-3">
                        <MetaText>{new Date(record.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</MetaText>
                      </td>
                      <td className="py-2 pl-3 pr-2" onClick={(e) => e.stopPropagation()}>
                        <Popover
                          align="end"
                          width="w-44"
                          trigger={(_, toggle) => (
                            <IconBtn variant="ghost" label="Search actions" onClick={toggle} className="opacity-60 group-hover:opacity-100">
                              <MoreHorizontal className="size-3.5" aria-hidden="true" />
                            </IconBtn>
                          )}
                        >
                          <PopItem icon={<ArrowUpRight className="size-3.5" aria-hidden="true" />} onClick={() => navigate("/find")}>
                            View results
                          </PopItem>
                          <PopItem
                            icon={<RefreshCw className="size-3.5" aria-hidden="true" />}
                            onClick={() => {
                              navigate("/find");
                              toast(`Re-running “${record.query}”`, "info");
                            }}
                          >
                            Re-run search
                          </PopItem>
                          <PopItem
                            icon={<ListPlus className="size-3.5" aria-hidden="true" />}
                            onClick={() => toast("Results saved to a new list")}
                          >
                            Save results
                          </PopItem>
                          <PopItem danger onClick={() => setToDelete(record)}>
                            Delete
                          </PopItem>
                        </Popover>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] px-3 py-2">
            <p className="text-[11px] text-ink-mute">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} searches
            </p>
            <Pagination page={Math.min(page, totalPages)} totalPages={totalPages} total={filtered.length} onPage={setPage} />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) {
            setRecords((r) => r.filter((x) => x.id !== toDelete.id));
            if (BACKEND_ENABLED) deleteSearch(toDelete.id);
          }
          setToDelete(null);
          toast("Search deleted");
        }}
        title="Delete this search?"
        description={`“${toDelete?.query}” will be removed from your history. Saved lists built from it aren't affected.`}
      />
    </AppLayout>
  );
}
