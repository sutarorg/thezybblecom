/* ------------------------------------------------------------------ */
/* Zybble app — List detail                                            */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, ListPlus, Search, X } from "lucide-react";
import { AppLayout } from "../components/AppLayout";
import { LeadsTable } from "../components/LeadsTable";
import { Badge, Btn, Input, formatDate, relative, useToast } from "../components/ui";
import { LEADS, LISTS } from "../data/mock";
import { useAppSeo } from "../hooks";
import type { Lead } from "../data/types";
import { BACKEND_ENABLED, listMembers, removeFromList } from "../services/api";
import { useWorkspace } from "../services/hooks";

export function ListDetailPage({ id }: { id: string }) {
  const list = useMemo(() => LISTS.find((l) => l.id === id), [id]);
  useAppSeo(
    list ? `${list.name} — Zybble` : "List — Zybble",
    list ? list.description : "Lead list.",
    `/lists/${id}`
  );
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const { workspace } = useWorkspace();
  const [sourceLeads, setSourceLeads] = useState<Lead[]>(LEADS);

  useEffect(() => {
    setLoading(true);
    const t = window.setTimeout(() => setLoading(false), 420);
    return () => window.clearTimeout(t);
  }, [id]);

  useEffect(() => {
    if (!BACKEND_ENABLED || !workspace) return;
    listMembers(id, workspace.id)
      .then((rows) => setSourceLeads(rows.length ? rows : []))
      .catch(() => undefined);
  }, [id, workspace]);

  const leads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sourceLeads.filter((l) => {
      const belongs = Boolean(list && l.list_ids.includes(list.id));
      if (list && !belongs) {
        // Deterministic fallback so demo lists always have a sensible membership
        const idx = Math.abs(l.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
        if (idx % LISTS.length !== Math.max(0, LISTS.findIndex((x) => x.id === id))) return false;
      }
      if (removed.has(l.id)) return false;
      if (q && !`${l.name} ${l.category} ${l.city}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, id, removed, query, sourceLeads]);

  const listName = list?.name ?? "Unknown list";

  return (
    <AppLayout title={listName} description={list?.description ?? "This list may have been removed."} wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <a href="#/lists" className="inline-flex items-center gap-1 text-xs font-medium text-ink-mute transition-colors hover:text-ink">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Lists
        </a>
        <div className="flex items-center gap-1.5">
          <Badge tone="neutral">
            {list ? `${list.lead_count.toLocaleString()} leads` : "0 leads"}
          </Badge>
          {list ? (
            <Badge tone="neutral">Updated {relative(list.updated_at)}</Badge>
          ) : null}
          <Btn variant="outline" size="sm" onClick={() => toast("Use row selection to remove leads from this list", "info")}>
            <ListPlus className="size-3.5" aria-hidden="true" />
            Manage
          </Btn>
          <Btn variant="primary" size="sm" onClick={() => toast("Export started — find it in Exports", "info")}>
            <Download className="size-3.5" aria-hidden="true" />
            Export list
          </Btn>
        </div>
      </div>

      {list ? (
        <p className="mb-3 text-[11px] text-neutral-400">
          Created {formatDate(list.created_at)} · owned by {list.owner}
        </p>
      ) : null}

      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search inside this list…"
            aria-label="Search inside this list"
            className="pl-8"
          />
        </div>
        {removed.size > 0 ? (
          <button
            type="button"
            onClick={() => setRemoved(new Set())}
            className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-600"
          >
            <X className="size-3" aria-hidden="true" />
            Restore {removed.size} removed
          </button>
        ) : null}
      </div>

      <LeadsTable
        leads={leads}
        loading={loading}
        pageSize={12}
        noLists
        onBulk={(action, ids) => {
          if (action === "delete") {
            setRemoved((s) => new Set([...s, ...ids]));
            if (BACKEND_ENABLED) removeFromList(id, ids);
            toast(`${ids.length} ${ids.length === 1 ? "lead" : "leads"} removed from ${listName}`);
          }
        }}
      />
    </AppLayout>
  );
}
