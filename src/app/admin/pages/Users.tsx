/* ------------------------------------------------------------------ */
/* /admin/users — customer directory                                   */
/*                                                                     */
/* Search, filtering, sorting and pagination all happen in Postgres    */
/* (admin_user_directory); the browser never receives more than one    */
/* page of rows.                                                       */
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
import { arr, num, str, type Row } from "../shape";
import { Badge } from "../../components/ui";

const PLAN_OPTIONS = [
  { value: "", label: "All plans" },
  { value: "free", label: "Free" },
  { value: "growth", label: "Growth" },
  { value: "agency", label: "Agency" },
  { value: "scale", label: "Scale" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Any subscription" },
  { value: "none", label: "No subscription row" },
  { value: "active", label: "Active" },
  { value: "trialing", label: "Trialing" },
  { value: "pending", label: "Pending" },
  { value: "past_due", label: "Past due" },
  { value: "halted", label: "Halted" },
  { value: "paused", label: "Paused" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "created", label: "Created" },
  { value: "authenticated", label: "Authenticated" },
];

const ROLE_OPTIONS = [
  { value: "", label: "All roles" },
  { value: "user", label: "Customers" },
  { value: "admin", label: "Administrators" },
];

export function AdminUsers({ identity }: { identity: AdminIdentity }) {
  const navigate = useNavigate();
  const { get, set, page, setPage } = useFilters();

  const sort = get("sort", "created_at");
  const dir = get("dir", "desc");

  const query = useAdminData<Row>("users", {
    q: get("q"),
    plan: get("plan"),
    role: get("role"),
    status: get("status"),
    sort,
    dir,
    page,
    pageSize: 25,
  });

  const rows = arr(query.data?.rows);
  const total = num(query.data?.total);

  /** Column headers double as the sort control — the RPC does the sorting. */
  const sortable = (key: string, header: string) => (
    <button
      type="button"
      onClick={() => set({ sort: key, dir: sort === key && dir === "desc" ? "asc" : "desc" })}
      aria-label={`Sort by ${header}`}
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
      header: sortable("name", "Customer"),
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-ink">{str(row.name) || "Unnamed"}</span>
            {str(row.role) === "admin" ? <Badge tone="violet">Admin</Badge> : null}
            {row.banned_until ? <Badge tone="red">Suspended</Badge> : null}
          </div>
          <p className="truncate text-[11px] text-ink-mute">{str(row.email) || "No email on file"}</p>
        </div>
      ),
    },
    {
      key: "plan",
      header: sortable("plan", "Plan"),
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge value={str(row.plan_id)} />
          {str(row.subscription_status) ? (
            <span className="text-[11px] text-ink-mute">{str(row.subscription_status)}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "workspaces",
      header: sortable("workspaces", "Workspaces"),
      numeric: true,
      render: (row) => formatNumber(row.workspace_count),
    },
    {
      key: "leads_used",
      header: sortable("leads_used", "Leads (period)"),
      numeric: true,
      render: (row) => formatNumber(row.leads_used),
    },
    {
      key: "last_activity",
      header: sortable("last_activity", "Last activity"),
      render: (row) => <span className="text-[11px] text-ink-mute">{timeAgo(row.last_activity_at)}</span>,
    },
    {
      key: "created_at",
      header: sortable("created_at", "Joined"),
      render: (row) => <span className="text-[11px] text-ink-mute">{timeAgo(row.created_at)}</span>,
    },
  ];

  return (
    <AdminLayout
      identity={identity}
      title="Users"
      description="Every account on Zybble, with the plan and subscription state the app actually enforces."
    >
      <Panel
        title={`${formatNumber(total)} ${total === 1 ? "customer" : "customers"}`}
        description="Filtered server-side — searching looks at name, email and user id."
        aside={
          <div className="flex flex-wrap items-center gap-1.5">
            <DebouncedSearch
              value={get("q")}
              placeholder="Search name, email or id"
              onChange={(value) => set({ q: value })}
            />
            <FilterSelect label="Plan" value={get("plan")} options={PLAN_OPTIONS} onChange={(v) => set({ plan: v })} width="w-[120px]" />
            <FilterSelect
              label="Subscription status"
              value={get("status")}
              options={STATUS_OPTIONS}
              onChange={(v) => set({ status: v })}
              width="w-[165px]"
            />
            <FilterSelect label="Role" value={get("role")} options={ROLE_OPTIONS} onChange={(v) => set({ role: v })} width="w-[135px]" />
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
              onRowClick={(row) => navigate(`/admin/users/${str(row.id)}`)}
              empty={
                <Nothing
                  title={get("q") || get("plan") || get("status") || get("role") ? "No customers match those filters" : "No customers yet"}
                  description={
                    get("q") || get("plan") || get("status") || get("role")
                      ? "Clear a filter to widen the search."
                      : "Accounts appear here as soon as somebody signs up."
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
