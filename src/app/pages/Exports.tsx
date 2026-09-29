/* ------------------------------------------------------------------ */
/* Zybble app — Exports                                                */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  FileDown,
  Loader2,
  RotateCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  MetaText,
  TableSkeleton,
  formatDate,
  useToast,
} from "../components/ui";
import type { ExportRecord } from "../data/types";
import { useAppSeo } from "../hooks";
import { downloadExport, getExports } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

const STATUS_META: Record<
  ExportRecord["status"],
  { tone: "neutral" | "green" | "amber" | "red"; label: string; live?: boolean }
> = {
  preparing: { tone: "amber", label: "Preparing", live: true },
  processing: { tone: "amber", label: "Processing", live: true },
  completed: { tone: "green", label: "Completed" },
  failed: { tone: "red", label: "Failed" },
};

export function ExportsPage() {
  useAppSeo("Exports — Zybble", "Your exported lead files.", "/exports");
  const toast = useToast();
  const { workspace, loading: ctxLoading } = useWorkspaceContext();

  const [records, setRecords] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | ExportRecord["status"]>("all");

  const load = useCallback(() => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    getExports(workspace.id)
      .then(setRecords)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace]);

  useEffect(() => {
    if (!ctxLoading && !workspace) setLoading(false);
    load();
  }, [load, ctxLoading, workspace]);

  /* poll while anything is still processing (real status from the DB) */
  const hasPending = records.some((r) => r.status === "preparing" || r.status === "processing");
  useEffect(() => {
    if (!hasPending || !workspace) return;
    const t = window.setInterval(() => {
      getExports(workspace.id).then(setRecords).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(t);
  }, [hasPending, workspace]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (q && !`${r.file_name} ${r.source}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [records, query, filter]);

  const download = async (record: ExportRecord) => {
    const { csv, fileName, error: dlError } = await downloadExport(record.id);
    if (dlError || csv === undefined) {
      toast(dlError ?? "Download failed", "error");
      return;
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName ?? record.file_name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chip = (value: typeof filter, label: string, count: number) => (
    <button
      key={label}
      type="button"
      onClick={() => setFilter(value)}
      aria-pressed={filter === value}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs transition-colors",
        filter === value
          ? "bg-ink font-medium text-white"
          : "bg-white text-ink-soft ring-1 ring-black/[0.08] hover:ring-black/[0.16]"
      )}
    >
      {label}
      <span className={cn("text-[10px]", filter === value ? "text-white/60" : "text-neutral-400")}>{count}</span>
    </button>
  );

  const busy = loading || ctxLoading;

  return (
    <AppLayout
      title="Exports"
      description="Every CSV you've generated — tracked from preparing to download."
      aside={
        <Btn variant="primary" href="/leads">
          <Download className="size-3.5" aria-hidden="true" />
          New export
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
            <p className="text-[13px] font-medium text-ink">We couldn't load your exports</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-mute">{error}</p>
            <Btn variant="outline" size="sm" className="mt-3" onClick={load}>
              Try again
            </Btn>
          </div>
        </Card>
      ) : null}

      {records.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search exports…"
              aria-label="Search exports"
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {chip("all", "All", records.length)}
            {chip("completed", "Completed", records.filter((r) => r.status === "completed").length)}
            {chip(
              "processing",
              "In progress",
              records.filter((r) => r.status === "processing" || r.status === "preparing").length
            )}
            {chip("failed", "Failed", records.filter((r) => r.status === "failed").length)}
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="rounded-lg border border-black/[0.06] bg-white">
          <TableSkeleton rows={6} cols={5} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileDown className="size-4" aria-hidden="true" />}
          title={query || filter !== "all" ? "No exports match" : "No exports yet"}
          description={
            query || filter !== "all"
              ? "Try a different file name or clear the status filter."
              : "Select leads anywhere in Zybble and export them — your files appear here with live status."
          }
          action={
            <Btn variant="primary" href="/leads">
              Go to leads
            </Btn>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[800px] text-left">
              <thead>
                <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                  {["File", "Source", "Leads", "Format", "Status", "Created", "Completed", ""].map((h, i) => (
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
                {filtered.map((record) => {
                  const meta = STATUS_META[record.status];
                  return (
                    <tr
                      key={record.id}
                      className="border-b border-black/[0.04] transition-colors last:border-0 hover:bg-neutral-50/70"
                    >
                      <td className="max-w-[260px] py-2 pl-3 pr-3">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={cn(
                              "grid size-7 shrink-0 place-items-center rounded-md",
                              record.status === "failed" ? "bg-red-50 text-red-500" : "bg-neutral-50 text-neutral-400"
                            )}
                          >
                            {meta.live ? (
                              <Loader2 className="size-3.5 animate-spin text-brand-600" aria-hidden="true" />
                            ) : record.status === "failed" ? (
                              <TriangleAlert className="size-3.5" aria-hidden="true" />
                            ) : (
                              <FileDown className="size-3.5" aria-hidden="true" />
                            )}
                          </span>
                          <span className="block truncate text-xs font-medium text-ink">{record.file_name}</span>
                        </span>
                      </td>
                      <td className="max-w-[200px] py-2 pl-3 pr-3">
                        <span className="block truncate text-xs text-ink-soft">{record.source}</span>
                      </td>
                      <td className="py-2 pl-3 pr-3 text-xs text-ink-soft">{record.leads.toLocaleString()}</td>
                      <td className="py-2 pl-3 pr-3">
                        <Badge tone="neutral">{record.format}</Badge>
                      </td>
                      <td className="py-2 pl-3 pr-3">
                        <Badge tone={meta.tone}>
                          {meta.live ? (
                            <Loader2 className="size-2.5 animate-spin" aria-hidden="true" />
                          ) : record.status === "completed" ? (
                            <Check className="size-2.5" aria-hidden="true" />
                          ) : null}
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="py-2 pl-3 pr-3">
                        <MetaText>{formatDate(record.created_at)}</MetaText>
                      </td>
                      <td className="py-2 pl-3 pr-3">
                        <MetaText>{record.completed_at ? formatDate(record.completed_at) : "—"}</MetaText>
                      </td>
                      <td className="py-2 pl-3 pr-3">
                        {record.status === "completed" ? (
                          <Btn variant="outline" size="sm" onClick={() => download(record)}>
                            <Download className="size-3.5" aria-hidden="true" />
                            Download
                          </Btn>
                        ) : record.status === "failed" ? (
                          <span className="text-[10.5px] text-red-600">Export failed</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10.5px] text-neutral-400">
                            <RotateCw className="size-3 animate-spin" aria-hidden="true" />
                            working
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-black/[0.06] px-3 py-2">
            <p className="text-[11px] text-ink-mute">
              {filtered.length} export{filtered.length === 1 ? "" : "s"}
            </p>
            <p className="text-[11px] text-neutral-400">Preparing → Processing → Completed</p>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
