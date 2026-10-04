/* ------------------------------------------------------------------ */
/* /admin/usage — quota administration.                                */
/*                                                                     */
/* CRITICAL: this page reads usage_counters, which is the SAME row     */
/* reserve_leads() reserves from and the customer's /usage page        */
/* displays. An override writes that row too, so admin and customer   */
/* can never disagree.                                                 */
/* ------------------------------------------------------------------ */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RotateCw, SlidersHorizontal } from "lucide-react";
import { Btn, Card, Dialog, DialogHeader, Input, useToast } from "../../components/ui";
import { AdminApiError, adminPost, useAdminResource } from "../client";
import { useUrlFilters } from "./Users";
import {
  BarSeries,
  DataTable,
  Distribution,
  FilterBar,
  Metric,
  MetricGrid,
  PageHead,
  PlanBadge,
  SearchField,
  Section,
  SelectField,
  TableFooter,
  compact,
  full,
  type Column,
} from "../ui";

type Row = {
  workspace_id: string;
  workspace_name: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  plan_id: string;
  lead_allowance: number;
  leads_used: number;
  searches: number;
  exports: number;
  ai_runs: number;
  pct: number;
};

type Response = {
  periodStart: string;
  totals: { leads: number; searches: number; exports: number; ai: number; nearLimit: number; exhausted: number };
  byPlan: Record<string, { workspaces: number; leads: number; searches: number }>;
  history: { period_start: string; leads: number; searches: number; exports: number; ai: number }[];
  rows: Row[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const METRICS = [
  { value: "leads_used", label: "Leads used" },
  { value: "searches", label: "Searches" },
  { value: "exports", label: "Exports" },
  { value: "ai_runs", label: "AI runs" },
];

const VIEWS = [
  { value: "", label: "All workspaces" },
  { value: "active", label: "Active only" },
  { value: "near_limit", label: "Near limit (80%+)" },
  { value: "exhausted", label: "At or over quota" },
];

export function AdminUsage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { get, set } = useUrlFilters();
  const [target, setTarget] = useState<Row | null>(null);
  const [metric, setMetric] = useState("leads_used");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const params = useMemo(
    () => ({
      view: get("view"),
      plan: get("plan"),
      q: get("q"),
      periodStart: get("periodStart"),
      page: get("page") || 1,
      pageSize: 25,
    }),
    [get],
  );
  const { data, loading, error, reload } = useAdminResource<Response>("usage", params);

  function openOverride(row: Row) {
    setTarget(row);
    setMetric("leads_used");
    setValue(String(row.leads_used));
    setReason("");
  }

  async function submit() {
    if (!target) return;
    setBusy(true);
    try {
      const result = await adminPost<{ usage: { old_value: number; value: number }; audited?: boolean }>("usage", {
        action: "adjust",
        workspaceId: target.workspace_id,
        metric,
        value: Number(value),
        reason,
        periodStart: data?.periodStart,
      });
      toast(`${metric} changed from ${result.usage.old_value} to ${result.usage.value}.`, "success");
      setTarget(null);
      reload();
    } catch (e) {
      toast(e instanceof AdminApiError ? e.message : "That override failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Row>[] = [
    {
      key: "workspace",
      header: "Workspace",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.workspace_name}</p>
          <p className="truncate text-[11px] text-ink-mute">{row.owner_email || row.owner_name}</p>
        </div>
      ),
    },
    { key: "plan", header: "Plan", hide: "sm", render: (row) => <PlanBadge plan={row.plan_id} /> },
    {
      key: "usage",
      header: "Leads used",
      align: "right",
      render: (row) => (
        <span className="inline-flex flex-col items-end gap-1">
          <span className={row.pct >= 100 ? "text-red-600" : row.pct >= 80 ? "text-amber-600" : undefined}>
            {full(row.leads_used)} / {row.lead_allowance < 0 ? "∞" : full(row.lead_allowance)}
          </span>
          <span className="block h-1 w-24 overflow-hidden rounded-full bg-black/[0.07]">
            <span
              className={row.pct >= 100 ? "block h-full bg-red-500" : row.pct >= 80 ? "block h-full bg-amber-500" : "block h-full bg-brand-600"}
              style={{ width: `${Math.min(100, row.pct)}%` }}
            />
          </span>
        </span>
      ),
    },
    { key: "pct", header: "%", align: "right", hide: "sm", render: (row) => `${row.pct}%` },
    { key: "searches", header: "Searches", align: "right", hide: "md", render: (row) => full(row.searches) },
    { key: "exports", header: "Exports", align: "right", hide: "lg", render: (row) => full(row.exports) },
    { key: "ai", header: "AI runs", align: "right", hide: "lg", render: (row) => full(row.ai_runs) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Btn
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            openOverride(row);
          }}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          Adjust
        </Btn>
      ),
    },
  ];

  const t = data?.totals;

  return (
    <>
      <PageHead
        title="Usage &amp; quotas"
        description={`Billing period ${data?.periodStart ?? "…"}. These are the exact counters reserve_leads() writes, so they always match what the customer sees on /usage.`}
        actions={
          <Btn variant="outline" size="sm" onClick={reload} label="Refresh">
            <RotateCw className="size-3.5" aria-hidden="true" />
          </Btn>
        }
      />

      <div className="space-y-6">
        <MetricGrid cols={5}>
          <Metric label="Leads consumed" value={compact(t?.leads)} loading={loading} />
          <Metric label="Searches" value={full(t?.searches)} loading={loading} />
          <Metric label="Exports" value={full(t?.exports)} loading={loading} />
          <Metric label="Near limit" value={full(t?.nearLimit)} tone={t?.nearLimit ? "warn" : "neutral"} loading={loading} />
          <Metric label="At/over quota" value={full(t?.exhausted)} tone={t?.exhausted ? "bad" : "good"} loading={loading} />
        </MetricGrid>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Card className="min-w-0 p-4">
            <Section title="Consumption by plan" description="Leads consumed this period, grouped by effective plan.">
              <Distribution
                data={Object.fromEntries(Object.entries(data?.byPlan ?? {}).map(([plan, v]) => [plan, v.leads]))}
                emptyLabel="Nothing consumed this period yet."
              />
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="Platform usage over time" description="Totals per monthly billing period, last 12 months.">
              <BarSeries
                points={(data?.history ?? []).map((h) => ({ day: h.period_start, leads: h.leads, searches: h.searches }))}
                keys={[
                  { key: "leads", label: "Leads", className: "bg-brand-600" },
                  { key: "searches", label: "Searches", className: "bg-ink/50" },
                ]}
                emptyLabel="No historical usage recorded."
              />
            </Section>
          </Card>
        </div>

        <Section title="Highest consumers" description="Sorted by leads consumed this period.">
          <FilterBar>
            <SearchField value={get("q")} onChange={(v) => set({ q: v })} placeholder="Workspace or owner" />
            <SelectField label="View" value={get("view")} onChange={(v) => set({ view: v })} options={VIEWS} />
            <SelectField
              label="Plan"
              value={get("plan")}
              onChange={(v) => set({ plan: v })}
              options={[{ value: "", label: "All plans" }, ...["free", "growth", "agency", "scale"].map((p) => ({ value: p, label: p }))]}
            />
          </FilterBar>
          <DataTable
            columns={columns}
            rows={data?.rows ?? []}
            loading={loading}
            error={error}
            rowKey={(row) => row.workspace_id}
            onRowClick={(row) => navigate(`/admin/workspaces/${row.workspace_id}`)}
            empty={{ title: "No workspaces match", description: "No quota has been consumed under these filters." }}
          />
          {data ? (
            <TableFooter page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => set({ page: p })} />
          ) : null}
        </Section>
      </div>

      <Dialog open={Boolean(target)} onClose={() => setTarget(null)} label="Adjust usage counter" maxWidth="max-w-md">
        {target ? (
          <>
            <DialogHeader
              title="Adjust a usage counter"
              description={`${target.workspace_name} · billing period ${data?.periodStart}`}
              onClose={() => setTarget(null)}
            />
            <div className="space-y-3 px-4 py-4">
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[11.5px] leading-5 text-amber-800">
                  This writes the live <code className="font-mono">usage_counters</code> row. The customer will see the new
                  number on their own Usage page immediately, and their remaining allowance changes accordingly.
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink">Metric</span>
                <SelectField
                  label="Metric"
                  className="w-full"
                  value={metric}
                  onChange={(m) => {
                    setMetric(m);
                    const current =
                      m === "leads_used" ? target.leads_used : m === "searches" ? target.searches : m === "exports" ? target.exports : target.ai_runs;
                    setValue(String(current));
                  }}
                  options={METRICS}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink">New value</span>
                <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
                <span className="mt-1 block text-[11px] text-ink-mute">
                  Current:{" "}
                  {full(metric === "leads_used" ? target.leads_used : metric === "searches" ? target.searches : metric === "exports" ? target.exports : target.ai_runs)}
                  {metric === "leads_used" && target.lead_allowance > 0 ? ` · allowance ${full(target.lead_allowance)}` : ""}
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink">Reason (required, recorded in the audit log)</span>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. goodwill credit after failed search" />
              </label>

              <div className="flex justify-end gap-1.5 pt-1">
                <Btn variant="outline" size="sm" onClick={() => setTarget(null)} disabled={busy}>
                  Cancel
                </Btn>
                <Btn variant="primary" size="sm" disabled={busy || reason.trim().length < 4 || value === ""} onClick={submit}>
                  {busy ? "Applying…" : "Apply override"}
                </Btn>
              </div>
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  );
}
