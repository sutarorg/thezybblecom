/* ------------------------------------------------------------------ */
/* Zybble app — Workspace detail                                       */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo } from "react";
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
import { useState } from "react";
import { AppLayout } from "../components/AppLayout";
import { Badge, Btn, Card, SectionTitle, relative } from "../components/ui";
import { SEARCH_HISTORY, TEAM, WORKSPACES } from "../data/mock";
import { useAppSeo } from "../hooks";
import { BACKEND_ENABLED, getWorkspace } from "../services/api";

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub: string }) {
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
  const baseWs = useMemo(() => WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0], [id]);
  useAppSeo(`${baseWs.name} — Zybble`, `Workspace overview for ${baseWs.name}.`, `/workspaces/${id}`);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(baseWs);
  useEffect(() => {
    setLoading(true);
    setDetail(baseWs);
    const t = window.setTimeout(() => setLoading(false), 420);
    return () => window.clearTimeout(t);
  }, [id, baseWs]);

  useEffect(() => {
    if (!BACKEND_ENABLED) return;
    getWorkspace(id).then((found) => {
      if (found) setDetail(found);
    }).catch(() => undefined);
  }, [id]);

  const ws = detail;

  const pct = Math.min(100, Math.round((ws.leads_used / ws.leads_limit) * 100));
  const recent = SEARCH_HISTORY.slice(0, 4);
  const members = TEAM.slice(0, Math.min(ws.members, TEAM.length));

  return (
    <AppLayout title={ws.name} description="Workspace overview — usage, members, and activity." wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <a href="#/workspaces" className="inline-flex items-center gap-1 text-xs font-medium text-ink-mute transition-colors hover:text-ink">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Workspaces
        </a>
        <div className="flex items-center gap-1.5">
          <Badge tone={ws.plan === "Agency" ? "green" : "neutral"}>{ws.plan}</Badge>
          <Btn variant="outline" size="sm" href="#/settings">
            <Settings className="size-3.5" aria-hidden="true" />
            Settings
          </Btn>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <span className="skel block h-2.5 w-20 rounded" />
              <span className="skel mt-2 block h-6 w-14 rounded" />
              <span className="skel mt-2 block h-2 w-24 rounded" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={FileSearch} label="Leads collected" value={ws.leads_used.toLocaleString()} sub={`of ${ws.leads_limit.toLocaleString()} this cycle`} />
          <StatCard icon={Search} label="Searches" value={String(ws.searches)} sub="across all markets" />
          <StatCard icon={ListChecks} label="Lists" value={String(ws.lists)} sub="saved groupings" />
          <StatCard icon={Users} label="Members" value={String(ws.members)} sub={`owned by ${ws.owner}`} />
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {/* usage */}
        <Card className="p-4 lg:col-span-2">
          <SectionTitle
            title="Usage this cycle"
            aside={<Btn variant="outline" size="sm" href="#/usage">Full usage</Btn>}
          />
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <p className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink">
                {ws.leads_used.toLocaleString()}
                <span className="text-sm font-medium text-ink-mute"> / {ws.leads_limit.toLocaleString()} leads</span>
              </p>
              <p className="text-xs font-medium text-ink">{pct}%</p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
              <div className={cn("h-full rounded-full transition-all duration-700", pct > 80 ? "bg-amber-500" : "bg-brand-600")} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-ink-mute">
              {pct > 80 ? "Over 80% used — searches pause at the limit until the cycle resets." : "Resets at the start of the next monthly cycle."}
            </p>
          </div>

          <div className="mt-4 border-t border-black/[0.05] pt-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Members</p>
            <ul className="flex flex-wrap gap-2">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 rounded-md border border-black/[0.05] bg-neutral-50/70 px-2 py-1.5">
                  <span className={cn("grid size-5 place-items-center rounded-full text-[8px] font-bold", m.tint)}>
                    {m.initials}
                  </span>
                  <span className="text-[11px] font-medium text-ink">{m.name}</span>
                  <span className="text-[10px] text-neutral-400">{m.role}</span>
                </li>
              ))}
              {ws.members < 3 ? (
                <li>
                  <a href="#/team" className="flex h-[30px] items-center gap-1 rounded-md border border-dashed border-black/[0.12] px-2.5 text-[11px] text-ink-mute transition-colors hover:border-black/[0.2] hover:text-ink">
                    + Invite
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        </Card>

        {/* recent searches */}
        <Card>
          <div className="flex items-center justify-between px-4 pb-1 pt-4">
            <SectionTitle title="Recent searches" />
          </div>
          <ul className="px-2 pb-2">
            {recent.map((s) => (
              <li key={s.id}>
                <a href="#/search-history" className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-neutral-50">
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
        </Card>
      </div>

      {/* settings strip */}
      <Card className="mt-3 flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="grid size-8 place-items-center rounded-md bg-neutral-100 text-neutral-400">
          <Building2 className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">Workspace settings</p>
          <p className="text-[11px] text-ink-mute">Name, defaults, and lead-pool destination for “{ws.name}”.</p>
        </div>
        <Btn variant="outline" size="sm" href="#/settings">
          Open settings
        </Btn>
        <Btn variant="outline" size="sm" href="#/exports">
          <Download className="size-3.5" aria-hidden="true" />
          Exports
        </Btn>
      </Card>
    </AppLayout>
  );
}
