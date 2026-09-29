/* ------------------------------------------------------------------ */
/* Zybble app — Workspace detail                                       */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Download,
  FileSearch,
  ListChecks,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import { Badge, Btn, Card, EmptyState, SectionTitle, Skel, relative } from "../components/ui";
import type { SearchRecord, TeamMember, Workspace } from "../data/types";
import { useAppSeo } from "../hooks";
import { getSearches, getTeam, getWorkspace } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-md border border-black/[0.05] bg-neutral-50 text-neutral-400">
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[11px] text-ink-mute">{label}</p>
          <p className="font-display text-lg font-semibold leading-6 tracking-[-0.02em] text-ink">{value}</p>
        </div>
      </div>
      <p className="mt-2 text-[10.5px] text-neutral-400">{sub}</p>
    </Card>
  );
}

export function WorkspaceDetailPage({ id }: { id: string }) {
  const { loading: ctxLoading } = useWorkspaceContext();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [searches, setSearches] = useState<SearchRecord[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useAppSeo(
    ws ? `${ws.name} — Zybble` : "Workspace — Zybble",
    ws ? `Workspace overview for ${ws.name}.` : "Workspace overview.",
    `/workspaces/${id}`
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([getWorkspace(id), getSearches(id), getTeam(id)])
      .then(([w, s, m]) => {
        setWs(w);
        setSearches(s.slice(0, 4));
        setMembers(m);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const busy = loading || ctxLoading;
  const pct = ws && ws.leads_limit > 0 ? Math.min(100, Math.round((ws.leads_used / ws.leads_limit) * 100)) : 0;

  if (!busy && !ws) {
    return (
      <AppLayout title="Workspace" wide>
        <EmptyState
          icon={<Building2 className="size-4" aria-hidden="true" />}
          title="Workspace not found"
          description={error ?? "This workspace doesn't exist, or you don't have access to it."}
          action={
            <Btn variant="primary" href="/workspaces">
              Back to workspaces
            </Btn>
          }
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title={ws?.name ?? "Workspace"}
      description="Workspace overview — usage, members, and activity."
      wide
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <a
          href="/workspaces"
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-mute transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Workspaces
        </a>
        <div className="flex items-center gap-1.5">
          {ws ? <Badge tone={ws.plan === "Free" ? "neutral" : "green"}>{ws.plan}</Badge> : null}
          <Btn variant="outline" size="sm" href="/settings">
            <Settings className="size-3.5" aria-hidden="true" />
            Settings
          </Btn>
        </div>
      </div>

      {busy ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skel className="h-2.5 w-20" />
              <Skel className="mt-2 h-6 w-14" />
              <Skel className="mt-2 h-2 w-24" />
            </Card>
          ))}
        </div>
      ) : ws ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={FileSearch}
            label="Leads collected"
            value={ws.leads_used.toLocaleString()}
            sub={`of ${ws.leads_limit.toLocaleString()} this cycle`}
          />
          <StatCard icon={Search} label="Searches" value={String(searches.length)} sub="most recent shown below" />
          <StatCard icon={ListChecks} label="Lists" value={String(ws.lists)} sub="saved groupings" />
          <StatCard icon={Users} label="Members" value={String(members.length || ws.members)} sub="with access" />
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <SectionTitle
            title="Usage this cycle"
            aside={
              <Btn variant="outline" size="sm" href="/usage">
                Full usage
              </Btn>
            }
          />
          {busy || !ws ? (
            <Skel className="mt-4 block h-16 w-full rounded" />
          ) : (
            <>
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink">
                    {ws.leads_used.toLocaleString()}
                    <span className="text-sm font-medium text-ink-mute">
                      {" "}
                      / {ws.leads_limit.toLocaleString()} leads
                    </span>
                  </p>
                  <p className="text-xs font-medium text-ink">{pct}%</p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-700",
                      pct > 80 ? "bg-amber-500" : "bg-brand-600"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-ink-mute">
                  {pct > 80
                    ? "Over 80% used — searches pause at the limit until the cycle resets."
                    : "Resets at the start of the next monthly cycle."}
                </p>
              </div>

              <div className="mt-4 border-t border-black/[0.05] pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Members</p>
                {members.length === 0 ? (
                  <p className="text-[11.5px] text-ink-mute">No members in this workspace yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {members.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center gap-2 rounded-md border border-black/[0.05] bg-neutral-50/70 px-2 py-1.5"
                      >
                        <span className={cn("grid size-5 place-items-center rounded-full text-[8px] font-bold", m.tint)}>
                          {m.initials}
                        </span>
                        <span className="text-[11px] font-medium text-ink">{m.name}</span>
                        <span className="text-[10px] text-neutral-400">{m.role}</span>
                      </li>
                    ))}
                    <li>
                      <a
                        href="/team"
                        className="flex h-[30px] items-center gap-1 rounded-md border border-dashed border-black/[0.12] px-2.5 text-[11px] text-ink-mute transition-colors hover:border-black/[0.2] hover:text-ink"
                      >
                        + Invite
                      </a>
                    </li>
                  </ul>
                )}
              </div>
            </>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between px-4 pb-1 pt-4">
            <SectionTitle title="Recent searches" />
          </div>
          {busy ? (
            <div className="px-4 pb-4" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skel key={i} className="mt-2 block h-8 w-full rounded" />
              ))}
            </div>
          ) : searches.length === 0 ? (
            <p className="px-4 pb-5 pt-1 text-[11.5px] leading-5 text-ink-mute">
              No searches have been run in this workspace yet.
            </p>
          ) : (
            <ul className="px-2 pb-2">
              {searches.map((s) => (
                <li key={s.id}>
                  <a
                    href="/search-history"
                    className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-neutral-50"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-md border border-black/[0.05] bg-neutral-50 text-neutral-400">
                      <Search className="size-3" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">{s.query}</span>
                      <span className="text-[10.5px] text-neutral-400">{relative(s.at)}</span>
                    </span>
                    <span className="text-[10.5px] text-neutral-400">{s.results}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-3 flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="grid size-8 place-items-center rounded-md bg-neutral-100 text-neutral-400">
          <Building2 className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">Workspace settings</p>
          <p className="text-[11px] text-ink-mute">Name, defaults, and members for “{ws?.name ?? "this workspace"}”.</p>
        </div>
        <Btn variant="outline" size="sm" href="/settings">
          Open settings
        </Btn>
        <Btn variant="outline" size="sm" href="/exports">
          <Download className="size-3.5" aria-hidden="true" />
          Exports
        </Btn>
      </Card>
    </AppLayout>
  );
}
