/* ------------------------------------------------------------------ */
/* /admin/leads — global lead-data operations.                         */
/*                                                                     */
/* An aggregate view, not a second copy of the customer Leads table.   */
/* Every figure is a Postgres count; the browser never receives lead   */
/* rows, so the page cost does not grow with the size of the dataset.  */
/* ------------------------------------------------------------------ */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RotateCw } from "lucide-react";
import { Btn, Card } from "../../components/ui";
import { useAdminResource } from "../client";
import { useUrlFilters } from "./Users";
import type { WorkspaceRow } from "./Workspaces";
import {
  BarSeries,
  DataTable,
  Distribution,
  FilterBar,
  Metric,
  MetricGrid,
  PageHead,
  PeriodPicker,
  PlanBadge,
  SearchField,
  Section,
  TableFooter,
  compact,
  defaultPeriod,
  full,
  num,
  periodParams,
  type Column,
  type PeriodState,
} from "../ui";

type Summary = {
  total: number;
  period: number;
  with_email: number;
  with_phone: number;
  with_website: number;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  by_provider: Record<string, number>;
  by_business_size: Record<string, number>;
  cross_workspace_duplicates: number;
  daily: { day: string; count: number }[];
};

type Response = {
  summary: Summary;
  workspaces: WorkspaceRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const coverage = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

export function AdminLeads() {
  const navigate = useNavigate();
  const { get, set } = useUrlFilters();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);

  const params = useMemo(
    () => ({ ...periodParams(period), q: get("q"), plan: get("plan"), page: get("page") || 1, pageSize: 20 }),
    [period, get],
  );
  const { data, loading, error, reload } = useAdminResource<Response>("leads", params);
  const s = data?.summary;

  const columns: Column<WorkspaceRow>[] = [
    {
      key: "name",
      header: "Workspace",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.name}</p>
          <p className="truncate text-[11px] text-ink-mute">{row.owner_email || row.owner_name}</p>
        </div>
      ),
    },
    { key: "plan", header: "Plan", hide: "sm", render: (row) => <PlanBadge plan={row.plan_id} /> },
    { key: "leads", header: "Leads stored", align: "right", render: (row) => full(row.lead_count) },
    { key: "used", header: "Used (mo)", align: "right", hide: "md", render: (row) => full(row.leads_used) },
    { key: "searches", header: "Searches (mo)", align: "right", hide: "lg", render: (row) => full(row.searches) },
    { key: "lists", header: "Lists", align: "right", hide: "lg", render: (row) => full(row.list_count) },
  ];

  return (
    <>
      <PageHead
        title="Lead operations"
        description="Ingestion volume, enrichment coverage and provider mix across every workspace."
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            <Btn variant="outline" size="sm" onClick={reload} label="Refresh">
              <RotateCw className="size-3.5" aria-hidden="true" />
            </Btn>
          </>
        }
      />

      <div className="space-y-6">
        <MetricGrid cols={5}>
          <Metric label="Leads stored" value={compact(s?.total)} loading={loading} />
          <Metric label="Ingested this period" value={full(s?.period)} loading={loading} />
          <Metric label="Email coverage" value={coverage(num(s?.with_email), num(s?.total))} hint={`${full(s?.with_email)} leads`} loading={loading} />
          <Metric label="Phone coverage" value={coverage(num(s?.with_phone), num(s?.total))} hint={`${full(s?.with_phone)} leads`} loading={loading} />
          <Metric label="Website coverage" value={coverage(num(s?.with_website), num(s?.total))} hint={`${full(s?.with_website)} leads`} loading={loading} />
        </MetricGrid>

        <Card className="min-w-0 p-4">
          <Section
            title="Ingestion volume"
            description="Leads created per day. Dedupe is enforced per workspace by a unique (workspace_id, dedupe_key) index, so these are distinct businesses within each account."
          >
            {loading ? (
              <div className="h-[120px] animate-pulse rounded bg-black/[0.04]" />
            ) : (
              <BarSeries
                points={(s?.daily ?? []).map((d) => ({ day: d.day, count: d.count }))}
                keys={[{ key: "count", label: "Leads", className: "bg-brand-600" }]}
                emptyLabel="No leads ingested in this period."
              />
            )}
          </Section>
        </Card>

        <div className="grid min-w-0 gap-4 lg:grid-cols-4">
          <Card className="min-w-0 p-4">
            <Section title="By source">
              <Distribution data={s?.by_source} total={num(s?.total)} emptyLabel="No leads yet." />
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="By provider">
              <Distribution data={s?.by_provider} total={num(s?.total)} emptyLabel="No leads yet." />
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="By workflow status">
              <Distribution data={s?.by_status} total={num(s?.total)} emptyLabel="No leads yet." />
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="By business size" description="Only populated where the provider or site scan was confident.">
              <Distribution data={s?.by_business_size} total={num(s?.total)} emptyLabel="No leads yet." />
            </Section>
          </Card>
        </div>

        <Card className="min-w-0 p-4">
          <Section
            title="Duplication"
            description="Within a workspace, duplicates are impossible — a unique index on (workspace_id, dedupe_key) rejects them at insert time. The only measurable overlap is the same business appearing in more than one workspace."
          >
            <p className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">
              {full(s?.cross_workspace_duplicates)}
            </p>
            <p className="mt-0.5 text-[11.5px] text-ink-mute">
              distinct businesses collected by more than one workspace
            </p>
          </Section>
        </Card>

        <Section title="Lead volume by workspace" description="Highest-volume workspaces first.">
          <FilterBar>
            <SearchField value={get("q")} onChange={(v) => set({ q: v })} placeholder="Workspace or owner" />
          </FilterBar>
          <DataTable
            columns={columns}
            rows={data?.workspaces ?? []}
            loading={loading}
            error={error}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/admin/workspaces/${row.id}`)}
            empty={{ title: "No workspaces with leads yet" }}
          />
          {data ? (
            <TableFooter page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => set({ page: p })} />
          ) : null}
        </Section>
      </div>
    </>
  );
}
