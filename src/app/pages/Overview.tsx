/* ------------------------------------------------------------------ */
/* Zybble app — Overview                                               */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { AppLayout, PeriodButton } from "../components/AppLayout";
import { Badge, Btn, Card, SectionTitle, Skel, relative } from "../components/ui";
import { ACTIVITY, KPI, LISTS, SEARCH_HISTORY } from "../data/mock";
import { useAppSeo } from "../hooks";
import { BACKEND_ENABLED, getOverview } from "../services/api";
import { useWorkspace } from "../services/hooks";

function buildCards(kpi: { leadsFound: number; leadsSaved: number; searches: number; exported: number; remaining: number; allowance: number }) {
  return [
    { label: "Leads found", value: kpi.leadsFound, delta: "+8.4%", icon: Search },
    { label: "Leads saved", value: kpi.leadsSaved, delta: "+5.1%", icon: ListChecks },
    { label: "Searches", value: kpi.searches, delta: "+12 this week", icon: FileSearch },
    { label: "Exported", value: kpi.exported, delta: "+214 this week", icon: Download },
    { label: "Remaining leads", value: kpi.remaining, delta: `of ${kpi.allowance.toLocaleString()}`, icon: Layers },
  ];
}

function KpiCard({ label, value, delta, icon: Icon, index }: ReturnType<typeof buildCards>[number] & { index: number }) {
  const used = label === "Remaining leads";
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
      <p className="mt-1.5 text-[11px] text-ink-mute">
        <span className={used ? "text-ink-mute" : "font-medium text-brand-700"}>{delta}</span>
        {!used && index !== 4 ? <span className="text-neutral-400"> vs last month</span> : index === 4 ? <span className="text-neutral-400"> this cycle</span> : null}
      </p>
    </Card>
  );
}

const ACT_ICON: Record<string, React.ElementType> = {
  search: Search,
  save: ListChecks,
  export: Download,
  ai: Sparkles,
  invite: FileSearch,
  list: ListChecks,
  workspace: Layers,
};

export function OverviewPage() {
  useAppSeo("Overview — Zybble", "Your lead-generation workspace at a glance.", "/overview");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 520);
    return () => window.clearTimeout(t);
  }, []);

  const { workspace } = useWorkspace();
  const [overview, setOverview] = useState<{
    leadsFound: number;
    leadsSaved: number;
    searches: number;
    exported: number;
    remaining: number;
    allowance: number;
  } | null>(null);
  const [remoteSearches, setRemoteSearches] = useState<typeof SEARCH_HISTORY>([]);
  const [remoteLists, setRemoteLists] = useState<typeof LISTS>([]);
  const [remoteActivity, setRemoteActivity] = useState<typeof ACTIVITY>([]);

  useEffect(() => {
    if (!BACKEND_ENABLED || !workspace) return;
    getOverview(workspace.id)
      .then((data) => {
        setOverview(data.kpi);
        setRemoteSearches(data.searches);
        setRemoteLists(data.lists);
        setRemoteActivity(data.activity);
      })
      .catch(() => undefined);
  }, [workspace]);

  const kpi = overview ?? {
    leadsFound: KPI.leadsFound,
    leadsSaved: KPI.leadsSaved,
    searches: KPI.searches,
    exported: KPI.exported,
    remaining: KPI.remaining,
    allowance: KPI.allowance,
  };
  const CARDS = buildCards(kpi);
  const fallbackLists = useMemo(() => LISTS.slice(0, 4), []);
  const fallbackHistory = useMemo(() => SEARCH_HISTORY.slice(0, 5), []);
  const fallbackActivity = useMemo(() => ACTIVITY.slice(0, 5), []);
  const lists = remoteLists.length ? remoteLists : fallbackLists;
  const history = remoteSearches.length ? remoteSearches : fallbackHistory;
  const activity = remoteActivity.length ? remoteActivity : fallbackActivity;

  return (
    <AppLayout
      title="Overview"
      description="Your lead generation workspace at a glance."
      aside={
        <>
          <PeriodButton />
          <Btn variant="primary" href="#/find">
            <Search className="size-3.5" aria-hidden="true" />
            Find leads
          </Btn>
        </>
      }
      wide
    >
      {/* KPI row */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skel className="h-2.5 w-20" />
              <Skel className="mt-3 h-6 w-16" />
              <Skel className="mt-2 h-2 w-24" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {CARDS.map((card, i) => (
            <KpiCard key={card.label} {...card} index={i} />
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        {/* recent searches */}
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <SectionTitle title="Recent searches" />
            <a href="#/search-history" className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-mute transition-colors hover:text-brand-700">
              View all
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </a>
          </div>
          {loading ? (
            <div className="px-4 pb-4 pt-1" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <Skel className="size-6 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skel className="h-2.5 w-56" />
                    <Skel className="h-2 w-32" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ul className="px-2 pb-2">
              {history.map((s) => (
                <li key={s.id}>
                  <a
                    href="#/search-history"
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

        {/* right column: usage + activity */}
        <div className="space-y-3">
          <Card className="p-4">
            <SectionTitle title="Usage this cycle" aside={<span className="text-xs font-medium text-ink">52%</span>} />
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
              <div className="h-full w-[52%] rounded-full bg-brand-600 transition-all duration-700" />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-ink-mute">
              <span>{KPI.used.toLocaleString()} used</span>
              <span>{KPI.remaining.toLocaleString()} left of {KPI.allowance.toLocaleString()}</span>
            </div>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-neutral-400">
              <Clock className="size-3" aria-hidden="true" />
              Resets {KPI.resetDate}
            </p>
          </Card>

          <Card>
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
              <SectionTitle title="Recent activity" />
            </div>
            {loading ? (
              <div className="px-4 pb-4" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="py-2.5">
                    <Skel className="h-2.5 w-full" />
                    <Skel className="mt-1.5 h-2 w-2/3" />
                  </div>
                ))}
              </div>
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
                        <p className="truncate text-xs leading-5 text-ink-soft">{a.text}</p>
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
          <a href="#/lists" className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-mute transition-colors hover:text-brand-700">
            View all
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        </div>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skel className="h-2.5 w-28" />
                <Skel className="mt-3 h-5 w-14" />
                <Skel className="mt-2 h-2 w-32" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {lists.map((list) => (
              <a key={list.id} href={`#/lists/${list.id}`} className="group">
                <Card className="p-4 transition-all duration-200 group-hover:border-black/[0.12] group-hover:-translate-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className={`grid size-7 place-items-center rounded-md text-[9px] font-bold ${list.color}`}>
                      {list.name.split(" ").slice(0, 2).map((w) => w[0]).join("")}
                    </span>
                    <ArrowUpRight className="size-3 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
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
    </AppLayout>
  );
}
