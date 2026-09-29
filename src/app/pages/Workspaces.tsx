/* ------------------------------------------------------------------ */
/* Zybble app — Workspaces (list)                                      */
/* ------------------------------------------------------------------ */
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Building2,
  FolderPlus,
  MoreHorizontal,
  Users,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import {
  Badge,
  Btn,
  Card,
  Dialog,
  DialogHeader,
  EmptyState,
  FieldLabel,
  IconBtn,
  Input,
  PopItem,
  PopSep,
  Popover,
  formatDate,
  useToast,
} from "../components/ui";
import { WORKSPACES } from "../data/mock";
import type { Workspace } from "../data/types";
import { useAppSeo } from "../hooks";
import { BACKEND_ENABLED, createWorkspace, listWorkspaces } from "../services/api";
import { useWorkspace } from "../services/hooks";

export function WorkspacesPage() {
  useAppSeo("Workspaces — Zybble", "Separate client spaces with their own usage and lists.", "/workspaces");
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(WORKSPACES);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 420);
    return () => window.clearTimeout(t);
  }, []);

  const { workspace: _sel } = useWorkspace();
  useEffect(() => {
    if (!BACKEND_ENABLED || !_sel) return;
    setLoading(true);
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [_sel]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (BACKEND_ENABLED) {
      const { workspace: created, error } = await createWorkspace(name.trim());
      if (error && error !== "demo") {
        toast(error, "error");
        return;
      }
      if (created) {
        setWorkspaces((w) => [...w, created]);
        setName("");
        setCreateOpen(false);
        toast(`Workspace “${created.name}” created`);
        return;
      }
    }
    const next: Workspace = {
      id: `ws-${Date.now()}`,
      name: name.trim(),
      owner: "Avery Chen",
      plan: "Agency workspace",
      members: 1,
      leads_used: 0,
      leads_limit: 5000,
      searches: 0,
      lists: 0,
      created_at: new Date().toISOString(),
    };
    setWorkspaces((w) => [...w, next]);
    setName("");
    setCreateOpen(false);
    toast(`Workspace “${next.name}” created`);
  };

  return (
    <AppLayout
      title="Workspaces"
      description="Separate environments for clients and teams — their own searches, lists, and usage."
      aside={
        <Btn variant="primary" onClick={() => setCreateOpen(true)}>
          <FolderPlus className="size-3.5" aria-hidden="true" />
          Create workspace
        </Btn>
      }
      wide
    >
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-2.5">
                <span className="skel size-9 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <span className="skel block h-2.5 w-36 rounded" />
                  <span className="skel block h-2 w-24 rounded" />
                </div>
              </div>
              <span className="skel mt-4 block h-1.5 w-full rounded" />
              <span className="skel mt-3 block h-2 w-2/3 rounded" />
            </Card>
          ))}
        </div>
      ) : workspaces.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-4" aria-hidden="true" />}
          title="No workspaces yet"
          description="Workspaces keep each client's searches, lists, and exports fully separate."
          action={
            <Btn variant="primary" onClick={() => setCreateOpen(true)}>
              <FolderPlus className="size-3.5" aria-hidden="true" />
              Create workspace
            </Btn>
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((ws) => {
            const pct = Math.min(100, Math.round((ws.leads_used / ws.leads_limit) * 100));
            return (
              <li key={ws.id} className="group">
                <a href={`#/workspaces/${ws.id}`}>
                  <Card className="h-full p-4 transition-all duration-200 hover:border-black/[0.14] hover:-translate-y-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-neutral-100 text-[11px] font-bold text-ink-soft">
                          {ws.name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-ink transition-colors group-hover:text-brand-700">
                            {ws.name}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-mute">
                            <Users className="size-3" aria-hidden="true" />
                            {ws.members} members · owned by {ws.owner}
                          </span>
                        </span>
                      </span>
                      <span onClick={(e) => e.preventDefault()}>
                        <Popover
                          align="end"
                          width="w-40"
                          trigger={(_, toggle) => (
                            <IconBtn
                              variant="ghost"
                              label={`Actions for ${ws.name}`}
                              onClick={toggle}
                              className="opacity-0 transition-opacity group-hover:opacity-100"
                            >
                              <MoreHorizontal className="size-3.5" aria-hidden="true" />
                            </IconBtn>
                          )}
                        >
                          <PopItem icon={<ArrowUpRight className="size-3.5" aria-hidden="true" />} onClick={() => (window.location.hash = `#/workspaces/${ws.id}`)}>
                            Open workspace
                          </PopItem>
                          <PopItem onClick={() => toast("Workspace duplicated")}>Duplicate</PopItem>
                          <PopSep />
                          <PopItem danger onClick={() => toast("Archiving a workspace is irreversible — confirm first", "info")}>
                            Archive
                          </PopItem>
                        </Popover>
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between text-[11px]">
                      <span className="text-ink-mute">Lead usage</span>
                      <span className="font-medium text-ink">
                        {ws.leads_used.toLocaleString()} / {ws.leads_limit.toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/[0.06]">
                      <div
                        className={cn("h-full rounded-full", pct > 80 ? "bg-amber-500" : "bg-brand-600")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-1 border-t border-black/[0.05] pt-3">
                      <p className="text-[10.5px] text-neutral-400">
                        {ws.searches} searches · {ws.lists} lists · created {formatDate(ws.created_at)}
                      </p>
                      <Badge tone={ws.plan === "Agency" ? "green" : "neutral"}>{ws.plan}</Badge>
                    </div>
                  </Card>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} label="Create workspace">
        <DialogHeader
          title="New workspace"
          description="A clean environment for a client or team — its own searches, lists, and usage."
          onClose={() => setCreateOpen(false)}
        />
        <form onSubmit={onCreate} className="px-4 py-4">
          <div>
            <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
            <Input
              id="ws-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Client · Sunrise Dental"
              maxLength={48}
            />
          </div>
          <div className="mt-4 flex justify-end gap-1.5">
            <Btn variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" size="sm" type="submit" disabled={!name.trim()}>
              Create workspace
            </Btn>
          </div>
        </form>
      </Dialog>
    </AppLayout>
  );
}