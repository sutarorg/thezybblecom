/* ------------------------------------------------------------------ */
/* /admin/workspaces — tenant directory                                */
/* ------------------------------------------------------------------ */
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  DataTable,
  DebouncedSearch,
  ErrorState,
  FilterSelect,
  Nothing,
  PagerBar,
  Panel,
  StatusBadge,
  formatNumber,
  timeAgo,
  useFilters,
  type Column,
} from "../components";
import { arr, bool, num, str, type Row } from "../shape";
import { Badge } from "../../components/ui";

export function AdminWorkspaces({ identity }: { identity: AdminIdentity }) {
  const navigate = useNavigate();
  const { get, set, page, setPage } = useFilters();
  const sort = get("sort", "created_at");
  const dir = get("dir", "desc");

  const query = useAdminData<Row>("workspaces", {
    q: get("q"),
    plan: get("plan"),
    kind: get("kind"),
    activity: get("activity"),
    sort,
    dir,
    page,
    pageSize: 25,
  });

  const rows = arr(query.data?.rows);
  const total = num(query.data?.total);

  const sortable = (key: string, header: string) => (
    <button
      type="button"
      aria-label={`Sort by ${header}`}
      onClick={() => set({ sort: key, dir: sort === key && dir === "desc" ? "asc" : "desc" })}
      className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-400 transition-colors hover:text-ink"
    >
      {header}
      {sort === key ? (
        dir === "desc" ? (
          <ArrowDown className="size-3" aria-hidden="true" />
        ) : (
          <ArrowUp className="size-3" aria-hidden="true" />
        )
      ) : null}
    </button>
  );

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: sortable("name", "Workspace"),
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-ink">{str(row.name)}</span>
            {bool(row.is_client) ? <Badge tone="sky">Client</Badge> : null}
          </div>
          <p className="truncate text-[11px] text-ink-mute">{formatNumber(row.list_count)} lists</p>
        </div>
      ),
    },
    {
      key: "owner",
      header: sortable("owner", "Owner"),
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-ink">{str(row.owner_name) || "—"}</p>
          <p className="truncate text-[11px] text-ink-mute">{str(row.owner_email)}</p>
        </div>
      ),
    },
    { key: "plan", header: "Plan", render: (row) => <StatusBadge value={row.plan_id} /> },
    { key: "members", header: sortable("members", "Members"), numeric: true, render: (row) => formatNumber(row.member_count) },
    { key: "leads_used", header: sortable("leads_used", "Leads used"), numeric: true, render: (row) => formatNumber(row.leads_used) },
    { key: "leads_total", header: sortable("leads_total", "Leads stored"), numeric: true, render: (row) => formatNumber(row.leads_total) },
    { key: "searches", header: sortable("searches", "Searches"), numeric: true, render: (row) => formatNumber(row.searches) },
    {
      key: "last_search",
      header: "Last search",
      render: (row) => <span className="text-[11px] text-ink-mute">{timeAgo(row.last_search_at)}</span>,
    },
  ];

  const filtered = Boolean(get("q") || get("plan") || get("kind") || get("activity"));

  return (
    <AdminLayout
      identity={identity}
      title="Workspaces"
      description="Every tenant workspace, its owner, its effective plan and its current-period consumption."
    >
      <Panel
        title={`${formatNumber(total)} ${total === 1 ? "workspace" : "workspaces"}`}
        description="Usage columns read the same usage_counters rows the product meters against."
        aside={
          <div className="flex flex-wrap items-center gap-1.5">
            <DebouncedSearch
              value={get("q")}
              placeholder="Search workspace, owner or id"
              onChange={(value) => set({ q: value })}
            />
            <FilterSelect
              label="Plan"
              value={get("plan")}
              width="w-[120px]"
              options={[
                { value: "", label: "All plans" },
                { value: "free", label: "Free" },
                { value: "growth", label: "Growth" },
                { value: "agency", label: "Agency" },
                { value: "scale", label: "Scale" },
              ]}
              onChange={(value) => set({ plan: value })}
            />
            <FilterSelect
              label="Type"
              value={get("kind")}
              width="w-[125px]"
              options={[
                { value: "", label: "All types" },
                { value: "personal", label: "Personal" },
                { value: "client", label: "Client" },
              ]}
              onChange={(value) => set({ kind: value })}
            />
            <FilterSelect
              label="Activity"
              value={get("activity")}
              width="w-[140px]"
              options={[
                { value: "", label: "Any activity" },
                { value: "active", label: "Searched in 30d" },
                { value: "idle", label: "Idle 30d+" },
              ]}
              onChange={(value) => set({ activity: value })}
            />
          </div>
        }
      >
        {query.error ? (
          <ErrorState message={query.error} onRetry={query.refresh} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              loading={query.loading}
              rowKey={(row) => str(row.id)}
              onRowClick={(row) => navigate(`/admin/workspaces/${str(row.id)}`)}
              minWidth="min-w-[920px]"
              empty={
                <Nothing
                  title={filtered ? "No workspaces match those filters" : "No workspaces yet"}
                  description={
                    filtered
                      ? "Clear a filter to widen the search."
                      : "A workspace is created automatically with the first account."
                  }
                />
              }
            />
            <PagerBar page={page} pageSize={num(query.data?.pageSize) || 25} total={total} onPage={setPage} />
          </>
        )}
      </Panel>
    </AdminLayout>
  );
}
