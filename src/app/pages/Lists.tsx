/* ------------------------------------------------------------------ */
/* Zybble app — Lead lists                                             */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowUpDown,
  ArrowUpRight,
  ListChecks,
  ListPlus,
  MoreHorizontal,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import {
  Btn,
  Card,
  ConfirmDialog,
  Dialog,
  DialogHeader,
  EmptyState,
  FieldLabel,
  IconBtn,
  Input,
  PopItem,
  PopSep,
  Popover,
  Textarea,
  formatDate,
  relative,
  useToast,
} from "../components/ui";
import { LISTS } from "../data/mock";
import type { LeadList } from "../data/types";
import { useAppSeo } from "../hooks";
import { BACKEND_ENABLED, createList, deleteList, getLists } from "../services/api";
import { useWorkspace } from "../services/hooks";

const CARD_TINTS = [
  "text-emerald-700 bg-emerald-50",
  "text-sky-700 bg-sky-50",
  "text-amber-700 bg-amber-50",
  "text-violet-700 bg-violet-50",
  "text-rose-700 bg-rose-50",
  "text-stone-600 bg-stone-100",
];

export function ListsPage() {
  useAppSeo("Lists — Zybble", "Organize your collected leads into working lists.", "/lists");
  const toast = useToast();
  const [lists, setLists] = useState<LeadList[]>(LISTS);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "size">("recent");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [toDelete, setToDelete] = useState<LeadList | null>(null);
  const { workspace } = useWorkspace();

  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 420);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!BACKEND_ENABLED || !workspace) return;
    setLoading(true);
    getLists(workspace.id)
      .then(setLists)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [workspace]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = lists.filter((l) => !q || `${l.name} ${l.description}`.toLowerCase().includes(q));
    if (sort === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "size") arr.sort((a, b) => b.lead_count - a.lead_count);
    else arr.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return arr;
  }, [lists, query, sort]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (BACKEND_ENABLED && workspace) {
      const { list, error } = await createList(workspace.id, name.trim(), desc.trim());
      if (error) {
        toast(error === "demo" ? "demo" : error, "error");
        return;
      }
      if (list) {
        setLists((l) => [{ ...list, color: CARD_TINTS[l.length % CARD_TINTS.length] }, ...l]);
        setCreateOpen(false);
        setName("");
        setDesc("");
        toast(`List “${list.name}” created`);
        return;
      }
    }
    const next: LeadList = {
      id: `list-${Date.now()}`,
      name: name.trim(),
      description: desc.trim() || "No description yet.",
      color: CARD_TINTS[lists.length % CARD_TINTS.length],
      lead_count: 0,
      owner: "Avery Chen",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      workspace_id: "ws-main",
    };
    setLists((l) => [next, ...l]);
    setCreateOpen(false);
    setName("");
    setDesc("");
    toast(`List “${next.name}” created`);
  };

  return (
    <AppLayout
      title="Lists"
      description="Group collected businesses into working lists — campaigns, markets, or clients."
      aside={
        <Btn variant="primary" onClick={() => setCreateOpen(true)}>
          <ListPlus className="size-3.5" aria-hidden="true" />
          New list
        </Btn>
      }
      wide
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search lists…" aria-label="Search lists" className="pl-8" />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 text-[11px] text-neutral-400">Sort</span>
          {(["recent", "name", "size"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded px-2.5 text-xs transition-colors",
                sort === s ? "bg-ink font-medium text-white" : "bg-white text-ink-soft ring-1 ring-black/[0.08] hover:ring-black/[0.16]"
              )}
            >
              {s === "recent" ? "Recently updated" : s === "name" ? "Name" : "Size"}
              {sort === s && s !== "recent" ? <ArrowUpDown className="size-3" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-2.5">
                <span className="skel size-8 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <span className="skel block h-2.5 w-32 rounded" />
                  <span className="skel block h-2 w-20 rounded" />
                </div>
              </div>
              <span className="skel mt-3 block h-2 w-full rounded" />
              <span className="skel mt-1.5 block h-2 w-2/3 rounded" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="size-4" aria-hidden="true" />}
          title={query ? "No lists match" : "No lists yet"}
          description={
            query
              ? "Try a different name — or create this list instead."
              : "Lists keep your leads organized by campaign, market, or client. Save any search results into one."
          }
          action={
            <Btn variant="primary" onClick={() => setCreateOpen(true)}>
              <ListPlus className="size-3.5" aria-hidden="true" />
              Create list
            </Btn>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((list) => (
            <li key={list.id} className="group">
              <Card className="relative h-full p-4 transition-all duration-200 hover:border-black/[0.14] hover:-translate-y-0.5">
                <div className="flex items-start justify-between gap-2">
                  <a href={`#/lists/${list.id}`} className="flex min-w-0 items-center gap-2.5">
                    <span className={`grid size-8 shrink-0 place-items-center rounded-md text-[10px] font-bold ${list.color}`}>
                      {list.name.split(" ").slice(0, 2).map((w) => w[0]).join("")}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink transition-colors group-hover:text-brand-700">
                        {list.name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-mute">by {list.owner}</span>
                    </span>
                  </a>
                  <Popover
                    align="end"
                    width="w-40"
                    trigger={(_, toggle) => (
                      <IconBtn variant="ghost" label={`Actions for ${list.name}`} onClick={toggle} className="opacity-0 transition-opacity group-hover:opacity-100">
                        <MoreHorizontal className="size-3.5" aria-hidden="true" />
                      </IconBtn>
                    )}
                  >
                    <PopItem icon={<ArrowUpRight className="size-3.5" aria-hidden="true" />} onClick={() => (window.location.hash = `#/lists/${list.id}`)}>
                      Open list
                    </PopItem>
                    <PopItem onClick={() => toast("List duplicated")}>Duplicate</PopItem>
                    <PopSep />
                    <PopItem danger icon={<Trash2 className="size-3.5" aria-hidden="true" />} onClick={() => setToDelete(list)}>
                      Delete list
                    </PopItem>
                  </Popover>
                </div>

                <a href={`#/lists/${list.id}`} className="mt-3 block">
                  <p className="line-clamp-2 min-h-[30px] text-[11.5px] leading-4.5 text-ink-mute">{list.description}</p>
                  <div className="mt-3 flex items-baseline gap-1">
                    <p className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">{list.lead_count.toLocaleString()}</p>
                    <p className="text-[11px] text-ink-mute">leads</p>
                  </div>
                  <p className="mt-1 text-[10.5px] text-neutral-400">
                    Created {formatDate(list.created_at)} · updated {relative(list.updated_at)}
                  </p>
                </a>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} label="Create list">
        <DialogHeader title="New list" description="Keep related businesses together and work them as a batch." onClose={() => setCreateOpen(false)} />
        <form onSubmit={onCreate} className="px-4 py-4">
          <div>
            <FieldLabel htmlFor="list-name">List name</FieldLabel>
            <Input
              id="list-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Austin Dentists"
              maxLength={60}
            />
          </div>
          <div className="mt-3">
            <FieldLabel htmlFor="list-desc">Description</FieldLabel>
            <Textarea
              id="list-desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="What are these leads for?"
            />
          </div>
          <div className="mt-4 flex justify-end gap-1.5">
            <Btn variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" size="sm" type="submit">
              Create list
            </Btn>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) {
            setLists((l) => l.filter((x) => x.id !== toDelete.id));
            if (BACKEND_ENABLED) deleteList(toDelete.id);
          }
          setToDelete(null);
          toast("List deleted — leads remain in your database");
        }}
        title="Delete this list?"
        description={`“${toDelete?.name}” and its grouping will be removed. The ${toDelete?.lead_count.toLocaleString()} leads stay in your database.`}
      />
    </AppLayout>
  );
}
