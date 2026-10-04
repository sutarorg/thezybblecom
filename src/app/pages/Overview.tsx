/* ------------------------------------------------------------------ */
/* Zybble app — Overview (real workspace metrics)                      */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  Download,
  FileSearch,
  Layers,
  ListChecks,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { AppLayout } from "../components/AppLayout";
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  SectionTitle,
  Skel,
  relative,
} from "../components/ui";
import { PendingInvitations } from "../components/PendingInvitations";
import { OverviewSkeleton } from "../components/skeletons";
import type { ActivityItem, LeadList, SearchRecord } from "../data/types";
import { useAppSeo } from "../hooks";
import { getOverview, type OverviewData } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

const ACT_ICON: Record<string, React.ElementType> = {
  search: Search,
  save: ListChecks,
  export: Download,
  ai: Sparkles,
  invite: FileSearch,
  list: ListChecks,
  workspace: Layers,
  billing: Layers,
};

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-mute">{label}</p>
        <span className="grid size-6 place-items-center rounded-md border border-black/[0.05] bg-neutral-50 text-neutral-400">
          <Icon className="size-3" aria-hidden="true" />
        </span>
      </div>
      <p className="font-display mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
        {value.toLocaleString()}
      </p>
      <p className="mt-1.5 text-[11px] text-ink-mute">{sub}</p>
    </Card>
  );
}

export function OverviewPage() {
  useAppSeo("Overview — Zybble", "Your lead generation workspace at a glance.", "/overview");
  const { workspace, planId, loading: ctxLoading } = useWorkspaceContext();

  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    getOverview(workspace.id, planId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace, planId]);

  useEffect(() => {
    if (!ctxLoading && !workspace) setLoading(false);
    load();
  }, [load, ctxLoading, workspace]);

  const busy = loading || ctxLoading;
  const kpi = data?.kpi;
  const searches: SearchRecord[] = data?.searches ?? [];
  const lists: LeadList[] = data?.lists ?? [];
  const activity: ActivityItem[] = data?.activity ?? [];
  const usedPct = kpi && kpi.allowance > 0 ? Math.round(((kpi.allowance - kpi.remaining) / kpi.allowance) * 100) : 0;

  return (
    <AppLayout
      title="Overview"
      description="Your lead generation workspace at a glance."
      aside={
        <Btn variant="primary" href="/find">
          <Search className="size-3.5" aria-hidden="true" />
          Find leads
        </Btn>
      }
      wide
    >
      {/* An invited teammate lands here first — this is where they can
          actually join the workspace they were invited to. */}
      <PendingInvitations onAccepted={load} />

      {error ? (
        <Card className="mb-3 flex items-start gap-3 p-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-red-50 text-red-600">
            <TriangleAlert className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[13px] font-medium text-ink">We couldn't load your overview</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-mute">{error}</p>
            <Btn variant="outline" size="sm" className="mt-3" onClick={load}>
              Try again
            </Btn>
          </div>
        </Card>
      ) : null}

      {/* Loading skeleton mirrors the full page (KPI row, two-column
          sections, list cards) so the swap causes no layout shift. */}
      {busy ? (
        <OverviewSkeleton />
      ) : (
        <>
      {/* KPI row */}
      {kpi ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <KpiCard label="Leads found" value={kpi.leadsFound} sub="in this workspace" icon={Search} />
          <KpiCard label="Leads saved" value={kpi.leadsSaved} sub="across your lists" icon={ListChecks} />
          <KpiCard label="Searches" value={kpi.searches} sub="this billing cycle" icon={FileSearch} />
          <KpiCard label="Exported" value={kpi.exported} sub="files this cycle" icon={Download} />
          <KpiCard
            label="Remaining leads"
            value={kpi.remaining}
            sub={`of ${kpi.allowance.toLocaleString()} this cycle`}
            icon={Layers}
          />
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        {/* recent searches */}
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <SectionTitle title="Recent searches" />
            {searches.length ? (
              <a
                href="/search-history"
                className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-mute transition-colors hover:text-brand-700"
              >
                View all
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </a>
            ) : null}
          </div>
          {searches.length === 0 ? (
            <div className="px-4 pb-4">
              <EmptyState
                className="border-0 bg-transparent py-8"
                icon={<Search className="size-4" aria-hidden="true" />}
                title="No searches yet"
                description="Describe the businesses you need and Zybble will collect them into this workspace."
                action={
                  <Btn variant="primary" href="/find">
                    Run your first search
                  </Btn>
                }
              />
            </div>
          ) : (
            <ul className="px-2 pb-2">
              {searches.map((s) => (
                <li key={s.id}>
                  <a
                    href="/search-history"
                    className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-neutral-50"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-md border border-black/[0.05] bg-neutral-50 text-neutral-400">
                      <Search className="size-3" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">{s.query}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-mute">
                        <span>{s.location}</span>
                        <span aria-hidden="true">·</span>
                        <span>{relative(s.at)}</span>
                      </span>
                    </span>
                    <Badge tone="neutral">{s.results} results</Badge>
                    <ArrowRight
                      className="size-3 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* usage + activity */}
        <div className="space-y-3">
          <Card className="p-4">
            <SectionTitle
              title="Usage this cycle"
              aside={kpi ? <span className="text-xs font-medium text-ink">{usedPct}%</span> : null}
            />
            {!kpi ? (
              <>
                <Skel className="mt-3 block h-1.5 w-full rounded-full" />
                <Skel className="mt-2 block h-2 w-40 rounded" />
              </>
            ) : (
              <>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-[width] duration-700"
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-ink-mute">
                  <span>{(kpi.allowance - kpi.remaining).toLocaleString()} used</span>
                  <span>
                    {kpi.remaining.toLocaleString()} left of {kpi.allowance.toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-neutral-400">
                  <Clock className="size-3" aria-hidden="true" />
                  Resets at the start of next month
                </p>
              </>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
              <SectionTitle title="Recent activity" />
            </div>
            {activity.length === 0 ? (
              <p className="px-4 pb-5 pt-1 text-[11.5px] leading-5 text-ink-mute">
                Activity from you and your team will appear here.
              </p>
            ) : (
              <ul className="px-4 pb-3">
                {activity.map((a) => {
                  const Icon = ACT_ICON[a.kind] ?? Search;
                  return (
                    <li key={a.id} className="flex gap-2.5 border-b border-black/[0.04] py-2.5 last:border-0">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-neutral-50 text-neutral-400">
                        <Icon className="size-2.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs leading-5 text-ink-soft">{a.text}</p>
                        <p className="text-[10.5px] text-neutral-400">{relative(a.at)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* lists */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Lead lists" description="Where your saved leads live." />
          {lists.length ? (
            <a
              href="/lists"
              className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-mute transition-colors hover:text-brand-700"
            >
              View all
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {lists.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="size-4" aria-hidden="true" />}
            title="No lists yet"
            description="Save search results into a list to keep campaigns, markets, or clients separate."
            action={
              <Btn variant="outline" href="/lists">
                Create a list
              </Btn>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {lists.map((list) => (
              <a key={list.id} href={`/lists/${list.id}`} className="group">
                <Card className="p-4 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-black/[0.12]">
                  <div className="flex items-center justify-between">
                    <span className={`grid size-7 place-items-center rounded-md text-[9px] font-bold ${list.color}`}>
                      {list.name.split(" ").slice(0, 2).map((w) => w[0]).join("")}
                    </span>
                    <ArrowUpRight
                      className="size-3 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-3 truncate text-xs font-medium text-ink">{list.name}</p>
                  <p className="font-display mt-1 text-lg font-semibold tracking-[-0.02em] text-ink">
                    {list.lead_count.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-ink-mute">leads · updated {relative(list.updated_at)}</p>
                </Card>
              </a>
            ))}
          </div>
        )}
      </div>
        </>
      )}
    </AppLayout>
  );
}
