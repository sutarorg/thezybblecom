/* ------------------------------------------------------------------ */
/* Zybble app — Lead lists                                             */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowUpDown,
  ArrowUpRight,
  ListChecks,
  ListPlus,
  MoreHorizontal,
  Search,
  Trash2,
  TriangleAlert,
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
import { planFromId } from "../data/plans";
import type { LeadList } from "../data/types";
import { navigate, useAppSeo } from "../hooks";
import { createList, deleteList, getLists } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

export function ListsPage() {
  useAppSeo("Lists — Zybble", "Organize your collected leads into working lists.", "/lists");
  const toast = useToast();
  const { workspace, planId, loading: ctxLoading } = useWorkspaceContext();
  const plan = planFromId(planId);

  const [lists, setLists] = useState<LeadList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "size">("recent");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<LeadList | null>(null);

  const load = useCallback(() => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    getLists(workspace.id)
      .then(setLists)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace]);

  useEffect(() => {
    if (!ctxLoading && !workspace) setLoading(false);
    load();
  }, [load, ctxLoading, workspace]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = lists.filter((l) => !q || `${l.name} ${l.description}`.toLowerCase().includes(q));
    if (sort === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "size") arr.sort((a, b) => b.lead_count - a.lead_count);
    else arr.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return arr;
  }, [lists, query, sort]);

  const atListLimit = plan.maxLists >= 0 && lists.length >= plan.maxLists;

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !workspace) return;
    setSaving(true);
    try {
      const created = await createList(workspace.id, name.trim(), desc.trim());
      setLists((l) => [created, ...l]);
      setCreateOpen(false);
      setName("");
      setDesc("");
      toast(`List “${created.name}” created`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || ctxLoading;

  return (
    <AppLayout
      title="Lists"
      description="Group collected businesses into working lists — campaigns, markets, or clients."
      aside={
        <Btn
          variant="primary"
          onClick={() => {
            if (atListLimit) {
              toast(`Your ${plan.label} plan includes ${plan.maxLists} list. Upgrade for unlimited lists.`, "error");
              return;
            }
            setCreateOpen(true);
          }}
        >
          <ListPlus className="size-3.5" aria-hidden="true" />
          New list
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
            <p className="text-[13px] font-medium text-ink">We couldn't load your lists</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-mute">{error}</p>
            <Btn variant="outline" size="sm" className="mt-3" onClick={load}>
              Try again
            </Btn>
          </div>
        </Card>
      ) : null}

      {lists.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search lists…"
              aria-label="Search lists"
              className="pl-8"
            />
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
                  sort === s
                    ? "bg-ink font-medium text-white"
                    : "bg-white text-ink-soft ring-1 ring-black/[0.08] hover:ring-black/[0.16]"
                )}
              >
                {s === "recent" ? "Recently updated" : s === "name" ? "Name" : "Size"}
                {sort === s && s !== "recent" ? <ArrowUpDown className="size-3" aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {busy ? (
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
              <span className="skel mt-3 block h-5 w-16 rounded" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="size-4" aria-hidden="true" />}
          title={query ? "No lists match" : "No lists yet"}
          description={
            query
              ? "Try a different name, or create this list instead."
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
              <Card className="relative h-full p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-black/[0.14]">
                <div className="flex items-start justify-between gap-2">
                  <a href={`/lists/${list.id}`} className="flex min-w-0 items-center gap-2.5">
                    <span className={`grid size-8 shrink-0 place-items-center rounded-md text-[10px] font-bold ${list.color}`}>
                      {list.name.split(" ").slice(0, 2).map((w) => w[0]).join("")}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink transition-colors group-hover:text-brand-700">
                        {list.name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-mute">
                        Updated {relative(list.updated_at)}
                      </span>
                    </span>
                  </a>
                  <Popover
                    align="end"
                    width="w-40"
                    trigger={(_, toggle) => (
                      <IconBtn
                        variant="ghost"
                        label={`Actions for ${list.name}`}
                        onClick={toggle}
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <MoreHorizontal className="size-3.5" aria-hidden="true" />
                      </IconBtn>
                    )}
                  >
                    <PopItem
                      icon={<ArrowUpRight className="size-3.5" aria-hidden="true" />}
                      onClick={() => navigate(`/lists/${list.id}`)}
                    >
                      Open list
                    </PopItem>
                    <PopSep />
                    <PopItem danger icon={<Trash2 className="size-3.5" aria-hidden="true" />} onClick={() => setToDelete(list)}>
                      Delete list
                    </PopItem>
                  </Popover>
                </div>

                <a href={`/lists/${list.id}`} className="mt-3 block">
                  <p className="line-clamp-2 min-h-[30px] text-[11.5px] leading-4.5 text-ink-mute">
                    {list.description || "No description."}
                  </p>
                  <div className="mt-3 flex items-baseline gap-1">
                    <p className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
                      {list.lead_count.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-ink-mute">leads</p>
                  </div>
                  <p className="mt-1 text-[10.5px] text-neutral-400">Created {formatDate(list.created_at)}</p>
                </a>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} label="Create list">
        <DialogHeader
          title="New list"
          description="Keep related businesses together and work them as a batch."
          onClose={() => setCreateOpen(false)}
        />
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
              required
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
            <Btn variant="primary" size="sm" type="submit" disabled={saving || !name.trim()}>
              {saving ? "Creating…" : "Create list"}
            </Btn>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await deleteList(toDelete.id);
            setLists((l) => l.filter((x) => x.id !== toDelete.id));
            toast("List deleted — leads remain in your database");
          } catch (e) {
            toast((e as Error).message, "error");
          }
          setToDelete(null);
        }}
        title="Delete this list?"
        description={`“${toDelete?.name}” will be removed. The ${toDelete?.lead_count.toLocaleString() ?? 0} leads inside stay in your database.`}
      />
    </AppLayout>
  );
}
