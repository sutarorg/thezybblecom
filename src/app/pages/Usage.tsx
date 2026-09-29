/* ------------------------------------------------------------------ */
/* Zybble app — Usage                                                  */
/* ------------------------------------------------------------------ */
import { useEffect, useState } from "react";
import {
  Download,
  FileSearch,
  Gauge,
  Layers,
  ListChecks,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { useMemo } from "react";
import { AppLayout, PeriodButton } from "../components/AppLayout";
import { Badge, Card, SectionTitle, Skel } from "../components/ui";
import { KPI, WEEKLY_USAGE, WEEK_LABELS } from "../data/mock";
import { useAppSeo } from "../hooks";
import { BACKEND_ENABLED, getUsage, type UsageData } from "../services/api";
import { useWorkspace } from "../services/hooks";

const LABELS = [...(WEEK_LABELS as string[])];

function Bar({ value, max, label, highlight }: { value: number; max: number; label: string; highlight?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1" title={`${label} · ${value} leads`}>
      <div className="flex h-32 w-full items-end justify-center">
        <div
          className={cn(
            "w-full max-w-[28px] rounded-t transition-all duration-500 hover:opacity-80",
            highlight ? "bg-brand-600" : "bg-black/[0.10]"
          )}
          style={{ height: `${(value / max) * 100}%` }}
        />
      </div>
      <span className={cn("text-[9.5px]", highlight ? "font-medium text-ink" : "text-neutral-400")}>{label}</span>
    </div>
  );
}

function UsageRow({ icon: Icon, label, used, limit, tint }: { icon: React.ElementType; label: string; used: number; limit?: number; tint: string }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : null;
  return (
    <div className="border-b border-black/[0.04] py-3 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className={cn("grid size-6 place-items-center rounded-md", tint)}>
            <Icon className="size-3" aria-hidden="true" />
          </span>
          <span className="text-xs font-medium text-ink">{label}</span>
        </span>
        <span className="text-xs text-ink-soft">
          <span className="font-medium text-ink">{used.toLocaleString()}</span>
          {limit ? <span className="text-neutral-400"> / {limit.toLocaleString()}</span> : <span className="text-neutral-400"> this cycle</span>}
        </span>
      </div>
      {pct !== null ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/[0.06]">
          <div
            className={cn("h-full rounded-full", pct > 85 ? "bg-amber-500" : pct > 60 ? "bg-brand-600" : "bg-black/[0.18]")}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function UsagePage() {
  useAppSeo("Usage — Zybble", "How much of your monthly allowance this workspace has used.", "/usage");
  const [loading, setLoading] = useState(true);
  const { workspace } = useWorkspace();
  const [remote, setRemote] = useState<UsageData | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 420);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!BACKEND_ENABLED || !workspace) return;
    getUsage(workspace.id).then(setRemote).catch(() => undefined);
  }, [workspace]);

  const data: UsageData = remote ?? {
    used: KPI.used,
    allowance: KPI.allowance,
    remaining: KPI.remaining,
    searches: KPI.searches,
    exports: KPI.exported,
    aiRuns: KPI.aiRuns,
    resetDate: KPI.resetDate,
    weekly: WEEKLY_USAGE as unknown as number[],
    weekLabels: WEEK_LABELS as unknown as string[],
  };

  const weeklyValues = remote ? data.weekly : (WEEKLY_USAGE as unknown as number[]);
  const pct = Math.round((data.used / Math.max(1, data.allowance)) * 100);
  const maxWeekly = Math.max(1, ...weeklyValues);
  const totalWeekly = useMemo(() => weeklyValues.reduce((a, b) => a + b, 0), [weeklyValues]);

  return (
    <AppLayout
      title="Usage"
      description="How your monthly lead allowance is being spent — searches, exports, and AI."
      aside={<PeriodButton />}
      wide
    >
      {/* headline stats */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: Gauge, label: "Leads used", value: data.used.toLocaleString(), sub: `${pct}% of monthly allowance` },
          { icon: Layers, label: "Allowance", value: data.allowance.toLocaleString(), sub: "Agency plan · monthly" },
          { icon: FileSearch, label: "Remaining", value: data.remaining.toLocaleString(), sub: `resets ${data.resetDate}` },
          { icon: Sparkles, label: "AI analyses", value: data.aiRuns.toLocaleString(), sub: "included on this plan" },
        ].map((card, i) =>
          loading ? (
            <Card key={i} className="p-4" aria-hidden="true">
              <Skel className="h-2.5 w-20" />
              <Skel className="mt-3 h-6 w-16" />
              <Skel className="mt-2 h-2 w-28" />
            </Card>
          ) : (
            <Card key={card.label} className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-mute">{card.label}</p>
                <span className="grid size-6 place-items-center rounded-md border border-black/[0.05] bg-neutral-50 text-neutral-400">
                  <card.icon className="size-3" aria-hidden="true" />
                </span>
              </div>
              <p className="font-display mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">{card.value}</p>
              <p className="mt-1.5 text-[11px] text-ink-mute">{card.sub}</p>
            </Card>
          )
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {/* weekly chart */}
        <Card className="p-4 lg:col-span-2">
          <SectionTitle
            title="Leads discovered — weekly"
            description={`${totalWeekly.toLocaleString()} leads over the last 12 weeks.`}
            aside={<Badge tone="neutral">last 12 weeks</Badge>}
          />
          {loading ? (
            <div className="mt-4 flex h-32 items-end gap-2" aria-hidden="true">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skel key={i} className="flex-1 rounded-t" />
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <div className="flex items-end gap-1.5 min-[480px]:gap-2">
                {weeklyValues.map((value, i) => (
                  <Bar key={i} value={value} max={maxWeekly} label={LABELS[i] ?? `W${i + 1}`} highlight={i === weeklyValues.length - 1} />
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3 border-t border-black/[0.05] pt-2.5 text-[10px] text-neutral-400">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-brand-600" aria-hidden="true" />
                  current week
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-black/[0.10]" aria-hidden="true" />
                  previous weeks
                </span>
                <span className="ml-auto">Avg {Math.round(totalWeekly / 12).toLocaleString()} / week</span>
              </div>
            </div>
          )}
        </Card>

        {/* breakdown */}
        <Card className="px-4 pt-4">
          <SectionTitle title="Breakdown" />
          <div className="pt-1">
            <UsageRow icon={Search} label="Leads discovered" used={data.used} limit={data.allowance} tint="bg-brand-50 text-brand-700" />
            <UsageRow icon={ListChecks} label="Leads saved" used={KPI.leadsSaved} tint="bg-neutral-100 text-neutral-500" />
            <UsageRow icon={Download} label="Leads exported" used={data.exports} tint="bg-neutral-100 text-neutral-500" />
            <UsageRow icon={Sparkles} label="AI analyses" used={data.aiRuns} tint="bg-brand-50 text-brand-700" />
            <UsageRow icon={Zap} label="Searches run" used={data.searches} tint="bg-neutral-100 text-neutral-500" />
          </div>
          <p className="border-t border-black/[0.05] py-3 text-[10.5px] leading-4 text-neutral-400">
            Discovery draws on your monthly allowance. Saving, exporting, and
            AI analysis don't add extra per-use charges on this plan.
          </p>
        </Card>
      </div>

      {/* reset + upgrade notice */}
      <Card className="mt-3 flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="grid size-8 place-items-center rounded-md bg-brand-50 text-brand-700">
          <Gauge className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">
            {data.remaining.toLocaleString()} leads remaining before {data.resetDate}
          </p>
          <p className="text-[11px] leading-4.5 text-ink-mute">
            Allowances reset monthly. At the limit, new searches pause until the next cycle — saved lists and past exports stay accessible.
          </p>
        </div>
        <Badge tone="green">
          <ListChecks className="size-2.5" aria-hidden="true" />
          Unlimited lists on this plan
        </Badge>
        <a href="#/billing" className="inline-flex h-8 items-center justify-center rounded border border-black/[0.09] bg-white px-3 text-xs font-medium text-ink transition-colors hover:border-black/[0.16] hover:bg-neutral-50">
          Manage plan
        </a>
      </Card>
    </AppLayout>
  );
}
