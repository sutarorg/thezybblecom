/* ------------------------------------------------------------------ */
/* /admin/leads — global lead operations                               */
/*                                                                     */
/* Aggregates only. Lead rows belong to a tenant workspace, so the     */
/* console reports volume, coverage and quality and sends you to the   */
/* owning workspace to look at records — no cross-tenant lead dump,    */
/* and no multi-megabyte payload to the browser.                       */
/* ------------------------------------------------------------------ */
import { Link } from "react-router-dom";
import { useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  BarSeries,
  Caveat,
  CountChips,
  DataTable,
  DistributionBar,
  ErrorState,
  Nothing,
  Panel,
  RangeFilter,
  Stat,
  StatGrid,
  formatNumber,
  useFilters,
} from "../components";
import { arr, counts, num, obj, str } from "../shape";

export function AdminLeads({ identity }: { identity: AdminIdentity }) {
  const { get, set } = useFilters();
  const range = get("range", "30d");

  const query = useAdminData<Record<string, unknown>>("leads", {
    range,
    from: get("from"),
    to: get("to"),
  });

  const coverage = obj(query.data?.coverage);
  const total = num(query.data?.total);
  const inRange = num(query.data?.in_range);
  const duplicates = num(query.data?.cross_workspace_duplicates);

  return (
    <AdminLayout
      identity={identity}
      title="Leads"
      description="Volume and data quality of everything the pipeline has discovered, across all workspaces."
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
            <Stat label="Leads stored" value={formatNumber(total)} loading={query.initial} />
            <Stat label="Discovered in range" value={formatNumber(inRange)} loading={query.initial} />
            <Stat
              label="With an email"
              value={total ? `${Math.round((num(coverage.email) / total) * 100)}%` : "—"}
              hint={`${formatNumber(coverage.email)} leads`}
              loading={query.initial}
            />
            <Stat
              label="Same business, different workspace"
              value={formatNumber(duplicates)}
              hint="Identical dedupe key across tenants"
              loading={query.initial}
            />
          </StatGrid>

          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel title="Leads discovered per day" className="lg:col-span-2">
              <BarSeries
                points={arr(query.data?.ingestion).map((row) => ({ date: str(row.date), value: num(row.leads) }))}
                label="leads"
              />
            </Panel>

            <Panel title="Contact coverage" description="Share of all stored leads">
              <DistributionBar
                items={[
                  { label: "Email", value: num(coverage.email) },
                  { label: "Phone", value: num(coverage.phone) },
                  { label: "Website", value: num(coverage.website) },
                  { label: "Rating", value: num(coverage.rating) },
                  { label: "Address", value: num(coverage.address) },
                ]}
                total={total || undefined}
              />
            </Panel>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel title="By status">
              <CountChips counts={counts(query.data?.by_status)} />
            </Panel>
            <Panel title="By source / provider">
              <div className="space-y-2.5">
                <CountChips counts={counts(query.data?.by_source)} />
                <CountChips counts={counts(query.data?.by_provider)} />
              </div>
            </Panel>
            <Panel title="By business size">
              <CountChips counts={counts(query.data?.by_business_size)} />
            </Panel>
          </div>

          <Panel title="Largest lead databases" description="Top 10 workspaces by stored leads">
            <DataTable
              columns={[
                {
                  key: "workspace",
                  header: "Workspace",
                  render: (row) => (
                    <Link to={`/admin/workspaces/${str(row.workspace_id)}`} className="text-xs font-medium text-ink hover:underline">
                      {str(row.workspace_name) || "Unnamed workspace"}
                    </Link>
                  ),
                },
                { key: "leads", header: "Leads stored", numeric: true, render: (row) => formatNumber(row.leads) },
                { key: "range", header: "In range", numeric: true, render: (row) => formatNumber(row.leads_in_range) },
              ]}
              rows={arr(query.data?.top_workspaces)}
              loading={query.loading}
              rowKey={(row) => str(row.workspace_id)}
              minWidth="min-w-[480px]"
              empty={<Nothing title="No leads yet" description="Nothing has been discovered by any workspace." />}
            />
          </Panel>

          <Caveat>
            Lead records themselves stay inside the workspace that collected them — this page deliberately exposes only
            counts and coverage. “Same business, different workspace” counts identical dedupe keys across tenants; it is
            expected in a lead product and is not a data leak.
          </Caveat>
        </div>
      )}
    </AdminLayout>
  );
}
