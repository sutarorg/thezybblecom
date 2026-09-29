/* ------------------------------------------------------------------ */
/* Zybble app — Workspaces                                             */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Building2, FolderPlus, Lock, Users } from "lucide-react";
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
  Input,
  formatDate,
  useToast,
} from "../components/ui";
import { planFromId } from "../data/plans";
import type { Workspace } from "../data/types";
import { useAppSeo } from "../hooks";
import { createWorkspace, listWorkspaces } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

export function WorkspacesPage() {
  useAppSeo("Workspaces — Zybble", "Separate client spaces with their own usage and lists.", "/workspaces");
  const toast = useToast();
  const { planId, loading: ctxLoading } = useWorkspaceContext();
  const plan = planFromId(planId);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listWorkspaces()
      .then(setWorkspaces)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await createWorkspace(name.trim());
      setWorkspaces((w) => [...w, created]);
      setName("");
      setCreateOpen(false);
      toast(`Workspace “${created.name}” created`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || ctxLoading;

  return (
    <AppLayout
      title="Workspaces"
      description="Separate environments for clients and teams — their own searches, lists, and usage."
      aside={
        <Btn
          variant="primary"
          onClick={() => {
            if (!plan.clientWorkspaces) {
              toast("Client workspaces are available on Agency and Scale.", "error");
              return;
            }
            setCreateOpen(true);
          }}
        >
          <FolderPlus className="size-3.5" aria-hidden="true" />
          Create workspace
        </Btn>
      }
      wide
    >
      {!plan.clientWorkspaces && !busy ? (
        <Card className="mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="grid size-8 place-items-center rounded-md bg-neutral-100 text-neutral-400">
            <Lock className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink">Client workspaces are an Agency feature</p>
            <p className="text-[11px] leading-4.5 text-ink-mute">
              Keep each client's searches, lists, and exports separate — included on Agency and Scale.
            </p>
          </div>
          <Btn variant="outline" size="sm" href="/billing">
            View plans
          </Btn>
        </Card>
      ) : null}

      {error ? (
        <Card className="mb-3 p-4">
          <p className="text-[13px] font-medium text-ink">We couldn't load your workspaces</p>
          <p className="mt-0.5 text-xs leading-5 text-ink-mute">{error}</p>
          <Btn variant="outline" size="sm" className="mt-3" onClick={load}>
            Try again
          </Btn>
        </Card>
      ) : null}

      {busy ? (
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
            plan.clientWorkspaces ? (
              <Btn variant="primary" onClick={() => setCreateOpen(true)}>
                <FolderPlus className="size-3.5" aria-hidden="true" />
                Create workspace
              </Btn>
            ) : (
              <Btn variant="outline" href="/billing">
                View plans
              </Btn>
            )
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((ws) => {
            const pct = ws.leads_limit > 0 ? Math.min(100, Math.round((ws.leads_used / ws.leads_limit) * 100)) : 0;
            return (
              <li key={ws.id} className="group">
                <a href={`/workspaces/${ws.id}`}>
                  <Card className="h-full p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-black/[0.14]">
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
                            {ws.members} {ws.members === 1 ? "member" : "members"}
                          </span>
                        </span>
                      </span>
                      <ArrowUpRight
                        className="size-3 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden="true"
                      />
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
                      <p className="text-[10.5px] text-neutral-400">Created {formatDate(ws.created_at)}</p>
                      <Badge tone={ws.plan === "Free" ? "neutral" : "green"}>{ws.plan}</Badge>
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
              required
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
            <Btn variant="primary" size="sm" type="submit" disabled={saving || !name.trim()}>
              {saving ? "Creating…" : "Create workspace"}
            </Btn>
          </div>
        </form>
      </Dialog>
    </AppLayout>
  );
}
