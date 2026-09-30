/* ------------------------------------------------------------------ */
/* Zybble app — Usage                                                  */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  FileSearch,
  Gauge,
  Layers,
  ListChecks,
  Search,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import { Badge, Btn, Card, SectionTitle } from "../components/ui";
import { UsageSkeleton } from "../components/skeletons";
import { planFromId } from "../data/plans";
import { useAppSeo } from "../hooks";
import { getUsage, type UsageData } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex flex-1 flex-col items-center gap-1" title={`${label} · ${value.toLocaleString()} leads`}>
      <div className="flex h-32 w-full items-end justify-center">
        <div
          className="w-full max-w-[28px] rounded-t bg-brand-600 transition-all duration-500"
          style={{ height: `${Math.max(pct, value > 0 ? 4 : 0)}%` }}
        />
      </div>
      <span className="text-[9.5px] text-neutral-400">{label}</span>
    </div>
  );
}

function UsageRow({
  icon: Icon,
  label,
  used,
  limit,
  tint,
}: {
  icon: React.ElementType;
  label: string;
  used: number;
  limit?: number;
  tint: string;
}) {
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
          {limit ? (
            <span className="text-neutral-400"> / {limit.toLocaleString()}</span>
          ) : (
            <span className="text-neutral-400"> this cycle</span>
          )}
        </span>
      </div>
      {pct !== null ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/[0.06]">
          <div
            className={cn(
              "h-full rounded-full",
              pct > 85 ? "bg-amber-500" : pct > 0 ? "bg-brand-600" : "bg-black/[0.08]"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function UsagePage() {
  useAppSeo("Usage — Zybble", "How much of your monthly allowance this workspace has used.", "/usage");
  const { workspace, planId, loading: ctxLoading } = useWorkspaceContext();
  const plan = planFromId(planId);

  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    getUsage(workspace.id, planId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace, planId]);

  useEffect(() => {
    if (!ctxLoading && !workspace) setLoading(false);
    load();
  }, [load, ctxLoading, workspace]);

  const busy = loading || ctxLoading;
  const pct = data && data.allowance > 0 ? Math.round((data.used / data.allowance) * 100) : 0;
  const monthly = data?.monthly ?? [];
  const maxMonthly = Math.max(1, ...monthly.map((m) => m.value));
  const totalMonthly = useMemo(() => monthly.reduce((a, b) => a + b.value, 0), [monthly]);

  return (
    <AppLayout
      title="Usage"
      description="How your monthly lead allowance is being spent — searches, exports, and AI."
      wide
    >
      {error ? (
        <Card className="mb-3 flex items-start gap-3 p-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-red-50 text-red-600">
            <TriangleAlert className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[13px] font-medium text-ink">We couldn't load your usage</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-mute">{error}</p>
            <Btn variant="outline" size="sm" className="mt-3" onClick={load}>
              Try again
            </Btn>
          </div>
        </Card>
      ) : null}

      {/* Loading skeleton mirrors the KPI row, chart, and breakdown so the
          swap to real data causes no layout shift. */}
      {busy || !data ? (
        <UsageSkeleton />
      ) : (
        <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
              { icon: Gauge, label: "Leads used", value: data.used, sub: `${pct}% of monthly allowance` },
              { icon: Layers, label: "Allowance", value: data.allowance, sub: `${plan.label} plan · monthly` },
              { icon: FileSearch, label: "Remaining", value: data.remaining, sub: `resets ${data.resetDate}` },
              {
                icon: Sparkles,
                label: "AI analyses",
                value: data.aiRuns,
                sub: "included on every plan",
              },
            ].map((card) => (
              <Card key={card.label} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-ink-mute">{card.label}</p>
                  <span className="grid size-6 place-items-center rounded-md border border-black/[0.05] bg-neutral-50 text-neutral-400">
                    <card.icon className="size-3" aria-hidden="true" />
                  </span>
                </div>
                <p className="font-display mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
                  {card.value.toLocaleString()}
                </p>
                <p className="mt-1.5 text-[11px] text-ink-mute">{card.sub}</p>
              </Card>
            ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <SectionTitle
            title="Leads discovered"
            description={
              monthly.length
                ? `${totalMonthly.toLocaleString()} leads over your recorded cycles.`
                : "Your monthly history appears here once you start searching."
            }
            aside={<Badge tone="neutral">by billing cycle</Badge>}
          />
          {monthly.length === 0 ? (
            <div className="mt-4 flex h-32 items-center justify-center rounded-md border border-dashed border-black/[0.08]">
              <p className="text-[11.5px] text-ink-mute">No usage recorded yet.</p>
            </div>
          ) : (
            <div className="mt-4">
              <div className="flex items-end gap-1.5 min-[480px]:gap-2">
                {monthly.map((m, i) => (
                  <Bar key={`${m.label}-${i}`} value={m.value} max={maxMonthly} label={m.label} />
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3 border-t border-black/[0.05] pt-2.5 text-[10px] text-neutral-400">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-brand-600" aria-hidden="true" />
                  leads discovered
                </span>
                <span className="ml-auto">
                  Avg {Math.round(totalMonthly / Math.max(1, monthly.length)).toLocaleString()} / cycle
                </span>
              </div>
            </div>
          )}
        </Card>

        <Card className="px-4 pt-4">
          <SectionTitle title="Breakdown" />
            <div className="pt-1">
              <UsageRow
                icon={Search}
                label="Leads discovered"
                used={data.used}
                limit={data.allowance}
                tint="bg-brand-50 text-brand-700"
              />
              <UsageRow icon={ListChecks} label="Leads saved to lists" used={data.leadsSaved} tint="bg-neutral-100 text-neutral-500" />
              <UsageRow icon={Download} label="Exports created" used={data.exports} tint="bg-neutral-100 text-neutral-500" />
              <UsageRow icon={Sparkles} label="AI analyses" used={data.aiRuns} tint="bg-brand-50 text-brand-700" />
              <UsageRow icon={Zap} label="Searches run" used={data.searches} tint="bg-neutral-100 text-neutral-500" />
            </div>
          <p className="border-t border-black/[0.05] py-3 text-[10.5px] leading-4 text-neutral-400">
            Discovery draws on your monthly allowance. Saving, exporting, and AI analysis don't add extra per-use
            charges on your plan.
          </p>
        </Card>
      </div>

      {data ? (
        <Card className="mt-3 flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="grid size-8 place-items-center rounded-md bg-brand-50 text-brand-700">
            <Gauge className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink">
              {data.remaining.toLocaleString()} leads remaining before {data.resetDate}
            </p>
            <p className="text-[11px] leading-4.5 text-ink-mute">
              Allowances reset monthly. At the limit, new searches pause until the next cycle — saved lists and past
              exports stay accessible.
            </p>
          </div>
          <Btn variant="outline" size="sm" href="/billing">
            Manage plan
          </Btn>
        </Card>
      ) : null}
        </>
      )}
    </AppLayout>
  );
}
