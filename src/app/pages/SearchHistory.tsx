/* ------------------------------------------------------------------ */
/* Zybble app — Search history                                         */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, History, MoreHorizontal, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import {
  Badge,
  Btn,
  Card,
  ConfirmDialog,
  EmptyState,
  IconBtn,
  Input,
  MetaText,
  Pagination,
  PopItem,
  Popover,
  formatDate,
  useToast,
} from "../components/ui";
import { SearchHistorySkeleton } from "../components/skeletons";
import type { SearchRecord } from "../data/types";
import { navigate, useAppSeo } from "../hooks";
import { deleteSearch, getSearches } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

const PAGE_SIZE = 12;
const STATUS_META: Record<SearchRecord["status"], { tone: "green" | "amber" | "red"; label: string }> = {
  completed: { tone: "green", label: "Completed" },
  partial: { tone: "amber", label: "Partial" },
  failed: { tone: "red", label: "Failed" },
};

export function SearchHistoryPage() {
  useAppSeo("Search history — Zybble", "Every search you've run.", "/search-history");
  const toast = useToast();
  const { workspace, loading: ctxLoading } = useWorkspaceContext();

  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | SearchRecord["status"]>("all");
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<SearchRecord | null>(null);

  const load = useCallback(() => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    getSearches(workspace.id)
      .then(setRecords)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace]);

  useEffect(() => {
    if (!ctxLoading && !workspace) setLoading(false);
    load();
  }, [load, ctxLoading, workspace]);

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
  const busy = loading || ctxLoading;

  const chip = (value: typeof status, label: string, count: number) => (
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
      description="Every search you've run — re-run them or clean them up."
      aside={
        <Btn variant="primary" href="/find">
          <Search className="size-3.5" aria-hidden="true" />
          New search
        </Btn>
      }
      wide
    >
      {error ? (
        <Card className="mb-3 flex items-start gap-3 p-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-red-50 text-red-600">
            <TriangleAlert className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[13px] font-medium text-ink">We couldn't load your history</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-mute">{error}</p>
            <Btn variant="outline" size="sm" className="mt-3" onClick={load}>
              Try again
            </Btn>
          </div>
        </Card>
      ) : null}

      {records.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300"
              aria-hidden="true"
            />
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
            {chip("all", "All", records.length)}
            {chip("completed", "Completed", records.filter((r) => r.status === "completed").length)}
            {chip("partial", "Partial", records.filter((r) => r.status === "partial").length)}
            {chip("failed", "Failed", records.filter((r) => r.status === "failed").length)}
          </div>
        </div>
      ) : null}

      {busy ? (
        <SearchHistorySkeleton rows={8} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<History className="size-4" aria-hidden="true" />}
          title={query || status !== "all" ? "Nothing matches" : "No searches yet"}
          description={
            query || status !== "all"
              ? "Try a different phrase or clear the status filter."
              : "Searches you run from Find Leads appear here, one click from re-running."
          }
          action={
            <Btn variant="primary" href="/find">
              Find leads
            </Btn>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                  {["Search query", "Location", "Results", "Status", "When", ""].map((h, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="py-2 pl-3 pr-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((record) => (
                  <tr
                    key={record.id}
                    className="group border-b border-black/[0.04] transition-colors last:border-0 hover:bg-neutral-50/70"
                  >
                    <td className="max-w-[320px] py-2 pl-3 pr-3">
                      <span className="block truncate text-xs font-medium text-ink">{record.query}</span>
                    </td>
                    <td className="py-2 pl-3 pr-3 text-xs text-ink-soft">{record.location}</td>
                    <td className="py-2 pl-3 pr-3 text-xs text-ink-soft">{record.results.toLocaleString()}</td>
                    <td className="py-2 pl-3 pr-3">
                      <Badge tone={STATUS_META[record.status].tone}>{STATUS_META[record.status].label}</Badge>
                    </td>
                    <td className="py-2 pl-3 pr-3">
                      <MetaText>{formatDate(record.at)}</MetaText>
                    </td>
                    <td className="py-2 pl-3 pr-2">
                      <Popover
                        align="end"
                        width="w-44"
                        trigger={(_, toggle) => (
                          <IconBtn
                            variant="ghost"
                            label="Search actions"
                            onClick={toggle}
                            className="opacity-60 group-hover:opacity-100"
                          >
                            <MoreHorizontal className="size-3.5" aria-hidden="true" />
                          </IconBtn>
                        )}
                      >
                        <PopItem
                          icon={<ArrowUpRight className="size-3.5" aria-hidden="true" />}
                          onClick={() => navigate("/leads")}
                        >
                          View leads
                        </PopItem>
                        <PopItem
                          icon={<RefreshCw className="size-3.5" aria-hidden="true" />}
                          onClick={() => navigate("/find")}
                        >
                          Run a new search
                        </PopItem>
                        <PopItem danger onClick={() => setToDelete(record)}>
                          Delete
                        </PopItem>
                      </Popover>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] px-3 py-2">
            <p className="text-[11px] text-ink-mute">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} searches
            </p>
            <Pagination
              page={Math.min(page, totalPages)}
              totalPages={totalPages}
              total={filtered.length}
              onPage={setPage}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await deleteSearch(toDelete.id);
            setRecords((r) => r.filter((x) => x.id !== toDelete.id));
            toast("Search deleted");
          } catch (e) {
            toast((e as Error).message, "error");
          }
          setToDelete(null);
        }}
        title="Delete this search?"
        description={`“${toDelete?.query}” will be removed from your history. The leads it collected stay in your database.`}
      />
    </AppLayout>
  );
}
