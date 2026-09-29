/* ------------------------------------------------------------------ */
/* Zybble app — List detail                                            */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, ListChecks, Search } from "lucide-react";
import { AppLayout } from "../components/AppLayout";
import { LeadsTable } from "../components/LeadsTable";
import { Badge, Btn, EmptyState, Input, formatDate, relative, useToast } from "../components/ui";
import type { Lead, LeadList } from "../data/types";
import { useAppSeo } from "../hooks";
import { getList, listMembers, removeFromList, runExport } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

export function ListDetailPage({ id }: { id: string }) {
  const toast = useToast();
  const { workspace, loading: ctxLoading } = useWorkspaceContext();

  const [list, setList] = useState<LeadList | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useAppSeo(
    list ? `${list.name} — Zybble` : "List — Zybble",
    list?.description || "Lead list.",
    `/lists/${id}`
  );

  const load = useCallback(() => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    Promise.all([getList(id), listMembers(id)])
      .then(([l, rows]) => {
        setList(l);
        setLeads(rows);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, workspace]);

  useEffect(() => {
    if (!ctxLoading && !workspace) setLoading(false);
    load();
  }, [load, ctxLoading, workspace]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => `${l.name} ${l.category} ${l.city}`.toLowerCase().includes(q));
  }, [leads, query]);

  const busy = loading || ctxLoading;
  const listName = list?.name ?? "List";

  return (
    <AppLayout
      title={busy ? "List" : listName}
      description={list?.description || "Leads saved into this list."}
      wide
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <a
          href="/lists"
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-mute transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Lists
        </a>
        <div className="flex items-center gap-1.5">
          {!busy && list ? (
            <>
              <Badge tone="neutral">{leads.length.toLocaleString()} leads</Badge>
              <Badge tone="neutral">Updated {relative(list.updated_at)}</Badge>
            </>
          ) : null}
          <Btn
            variant="primary"
            size="sm"
            disabled={!leads.length}
            onClick={async () => {
              if (!workspace) return;
              const res = await runExport({ workspaceId: workspace.id, listId: id, source: listName });
              if (res.error) {
                toast(res.error, "error");
                return;
              }
              toast("Export ready — find it in Exports");
            }}
          >
            <Download className="size-3.5" aria-hidden="true" />
            Export list
          </Btn>
        </div>
      </div>

      {!busy && list ? (
        <p className="mb-3 text-[11px] text-neutral-400">Created {formatDate(list.created_at)}</p>
      ) : null}

      {leads.length > 0 ? (
        <div className="mb-3 flex items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search inside this list…"
              aria-label="Search inside this list"
              className="pl-8"
            />
          </div>
        </div>
      ) : null}

      <LeadsTable
        leads={filtered}
        loading={busy}
        error={error}
        onRetry={load}
        pageSize={25}
        noLists
        emptyState={
          query ? undefined : (
            <EmptyState
              icon={<ListChecks className="size-4" aria-hidden="true" />}
              title="This list is empty"
              description="Run a search and save the results here, or add leads from your database."
              action={
                <Btn variant="primary" href="/find">
                  Find leads
                </Btn>
              }
            />
          )
        }
        onBulk={async (action, ids) => {
          if (action === "delete") {
            try {
              await removeFromList(id, ids);
              setLeads((l) => l.filter((x) => !ids.includes(x.id)));
              toast(`${ids.length} ${ids.length === 1 ? "lead" : "leads"} removed from ${listName}`);
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }
          if (action === "export" && workspace) {
            const res = await runExport({ workspaceId: workspace.id, leadIds: ids, source: listName });
            if (res.error) toast(res.error, "error");
          }
        }}
      />
    </AppLayout>
  );
}
