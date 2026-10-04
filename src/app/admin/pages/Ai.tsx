/* ------------------------------------------------------------------ */
/* /admin/ai — AI operations                                           */
/*                                                                     */
/* Everything comes from `ai_requests`. Token counts and spend are NOT */
/* shown as if they were known: the column exists but no code path     */
/* writes it, so the page reports that coverage honestly instead of    */
/* inventing a cost figure.                                            */
/* ------------------------------------------------------------------ */
import { Link } from "react-router-dom";
import { useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  BarSeries,
  Caveat,
  CountChips,
  DataTable,
  ErrorState,
  Nothing,
  Panel,
  RangeFilter,
  Stat,
  StatGrid,
  StatusBadge,
  formatNumber,
  timeAgo,
  useFilters,
} from "../components";
import { arr, bool, counts, num, obj, str } from "../shape";
import { Badge } from "../../components/ui";

export function AdminAi({ identity }: { identity: AdminIdentity }) {
  const { get, set } = useFilters();
  const range = get("range", "30d");

  const query = useAdminData<Record<string, unknown>>("ai", {
    range,
    from: get("from"),
    to: get("to"),
  });

  const configuration = obj(query.data?.configuration);
  const total = num(query.data?.total);
  const failed = num(query.data?.failed);
  const tokenRows = num(query.data?.token_rows);

  return (
    <AdminLayout
      identity={identity}
      title="AI"
      description="Interpretation, analysis and summary requests across every workspace."
      aside={
        <RangeFilter
          value={range}
          from={get("from")}
          to={get("to")}
          onChange={(patch) => set(patch as Record<string, string | null>)}
        />
      }
    >
      {query.error ? (
        <ErrorState message={query.error} onRetry={query.refresh} />
      ) : (
        <div className="space-y-2.5">
          <StatGrid>
            <Stat label="Requests in range" value={formatNumber(total)} loading={query.initial} />
            <Stat label="Completed" value={formatNumber(query.data?.completed)} loading={query.initial} />
            <Stat
              label="Failed"
              value={formatNumber(failed)}
              tone={failed > 0 ? "danger" : "default"}
              hint={total ? `${Math.round((failed / total) * 100)}% failure rate` : undefined}
              loading={query.initial}
            />
            <Stat
              label="Still processing"
              value={formatNumber(query.data?.processing)}
              tone={num(query.data?.processing) > 0 ? "warn" : "default"}
              loading={query.initial}
            />
          </StatGrid>

          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel title="Requests per day" className="lg:col-span-2">
              <BarSeries
                points={arr(query.data?.by_day).map((row) => ({ date: str(row.date), value: num(row.total) }))}
                label="AI requests"
              />
            </Panel>
            <Panel title="Configuration" description="Presence only — keys never leave the server">
              <ul className="space-y-1.5 text-xs">
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">OpenRouter key</span>
                  {bool(configuration.openRouterConfigured) ? (
                    <Badge tone="green">Configured</Badge>
                  ) : (
                    <Badge tone="red">Missing</Badge>
                  )}
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">Model</span>
                  <span className="font-mono text-[11px] text-ink">{str(configuration.model)}</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">Attribution header</span>
                  {bool(configuration.attribution) ? <Badge tone="green">Set</Badge> : <Badge>Not set</Badge>}
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">SerpApi key</span>
                  {bool(configuration.serpApiConfigured) ? (
                    <Badge tone="green">Configured</Badge>
                  ) : (
                    <Badge tone="red">Missing</Badge>
                  )}
                </li>
              </ul>
            </Panel>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="By kind">
              <CountChips counts={counts(query.data?.by_kind)} />
            </Panel>
            <Panel title="By model">
              <CountChips counts={counts(query.data?.by_model)} />
            </Panel>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Busiest workspaces">
              <DataTable
                columns={[
                  {
                    key: "workspace",
                    header: "Workspace",
                    render: (row) => (
                      <Link to={`/admin/workspaces/${str(row.workspace_id)}`} className="text-xs text-ink hover:underline">
                        {str(row.workspace_name) || "Unnamed workspace"}
                      </Link>
                    ),
                  },
                  { key: "requests", header: "Requests", numeric: true, render: (row) => formatNumber(row.requests) },
                  { key: "failed", header: "Failed", numeric: true, render: (row) => formatNumber(row.failed) },
                ]}
                rows={arr(query.data?.top_workspaces)}
                rowKey={(row) => str(row.workspace_id)}
                minWidth="min-w-[420px]"
                empty={<Nothing title="No AI usage" />}
              />
            </Panel>
            <Panel title="Most frequent errors">
              <DataTable
                columns={[
                  {
                    key: "error",
                    header: "Error",
                    render: (row) => (
                      <span className="text-[11px] text-ink-soft" title={str(row.error)}>
                        {str(row.error).slice(0, 80)}
                      </span>
                    ),
                  },
                  { key: "count", header: "Count", numeric: true, render: (row) => formatNumber(row.c) },
                ]}
                rows={arr(query.data?.errors)}
                rowKey={(row, index) => `${str(row.error)}-${index}`}
                minWidth="min-w-[420px]"
                empty={<Nothing title="No failures" description="No AI request failed in this range." />}
              />
            </Panel>
          </div>

          <Panel title="Recent requests" description="Last 25 in range">
            <DataTable
              columns={[
                { key: "kind", header: "Kind", render: (row) => str(row.kind) },
                { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                { key: "model", header: "Model", render: (row) => str(row.model) || "—" },
                {
                  key: "workspace",
                  header: "Workspace",
                  render: (row) => (
                    <Link to={`/admin/workspaces/${str(row.workspace_id)}`} className="text-xs hover:underline">
                      {str(row.workspace_name) || "—"}
                    </Link>
                  ),
                },
                { key: "user", header: "Customer", render: (row) => str(row.user_name) || "—" },
                {
                  key: "error",
                  header: "Error",
                  render: (row) =>
                    str(row.error) ? (
                      <span className="text-[11px] text-red-600" title={str(row.error)}>
                        {str(row.error).slice(0, 36)}
                      </span>
                    ) : (
                      "—"
                    ),
                },
                { key: "at", header: "When", render: (row) => timeAgo(row.created_at) },
              ]}
              rows={arr(query.data?.recent)}
              loading={query.loading}
              rowKey={(row) => str(row.id)}
              minWidth="min-w-[900px]"
              empty={<Nothing title="No AI requests" description="Nothing has called the AI features in this range." />}
            />
          </Panel>

          <Caveat>
            Token usage and cost are not shown: <code>ai_requests.tokens</code> exists but nothing writes it today
            ({formatNumber(tokenRows)} of {formatNumber(total)} requests in this range have a value), so any spend
            figure here would be fabricated. Billing for AI lives in your OpenRouter dashboard until the worker starts
            recording usage.
          </Caveat>
        </div>
      )}
    </AdminLayout>
  );
}
