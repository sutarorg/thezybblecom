/* ------------------------------------------------------------------ */
/* /admin/workspaces — global workspace administration.                */
/* ------------------------------------------------------------------ */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../components/ui";
import { useAdminResource } from "../client";
import { useUrlFilters } from "./Users";
import {
  Chip,
  DataTable,
  FilterBar,
  PageHead,
  PlanBadge,
  SearchField,
  SelectField,
  TableFooter,
  ago,
  dateOnly,
  full,
  type Column,
} from "../ui";

export type WorkspaceRow = {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  plan_id: string;
  is_client: boolean;
  created_at: string;
  member_count: number;
  lead_count: number;
  list_count: number;
  leads_used: number;
  searches: number;
  lead_allowance: number;
  last_search_at: string | null;
};

type Response = { rows: WorkspaceRow[]; page: number; pageSize: number; total: number; totalPages: number };

const PLAN_OPTIONS = [
  { value: "", label: "All plans" },
  { value: "free", label: "Free" },
  { value: "growth", label: "Growth" },
  { value: "agency", label: "Agency" },
  { value: "scale", label: "Scale" },
];
const CLIENT_OPTIONS = [
  { value: "", label: "All workspaces" },
  { value: "client", label: "Client workspaces" },
  { value: "internal", label: "Own workspaces" },
];
const SORT_OPTIONS = [
  { value: "created_at", label: "Newest" },
  { value: "name", label: "Name A→Z" },
  { value: "leads", label: "Most leads" },
  { value: "usage", label: "Highest usage" },
  { value: "activity", label: "Recent activity" },
  { value: "members", label: "Most members" },
];

export function AdminWorkspaces() {
  const navigate = useNavigate();
  const { get, set, clearAll } = useUrlFilters({ sort: "created_at" });

  const query = useMemo(
    () => ({
      q: get("q"),
      plan: get("plan"),
      client: get("client"),
      sort: get("sort") || "created_at",
      page: get("page") || 1,
      pageSize: 25,
    }),
    [get],
  );
  const { data, loading, error } = useAdminResource<Response>("workspaces", query);

  const columns: Column<WorkspaceRow>[] = [
    {
      key: "name",
      header: "Workspace",
      render: (row) => (
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-ink">{row.name}</span>
            {row.is_client ? <Badge tone="sky">Client</Badge> : null}
          </p>
          <p className="truncate text-[11px] text-ink-mute">{row.owner_name || row.owner_email || "Unknown owner"}</p>
        </div>
      ),
    },
    { key: "plan", header: "Plan", hide: "sm", render: (row) => <PlanBadge plan={row.plan_id} /> },
    { key: "members", header: "Members", align: "right", hide: "md", render: (row) => full(row.member_count) },
    { key: "leads", header: "Leads", align: "right", render: (row) => full(row.lead_count) },
    {
      key: "usage",
      header: "Used / allowance",
      align: "right",
      hide: "md",
      render: (row) => {
        const pct = row.lead_allowance > 0 ? (row.leads_used / row.lead_allowance) * 100 : 0;
        return (
          <span className={pct >= 100 ? "text-red-600" : pct >= 80 ? "text-amber-600" : undefined}>
            {full(row.leads_used)} / {row.lead_allowance < 0 ? "∞" : full(row.lead_allowance)}
          </span>
        );
      },
    },
    { key: "searches", header: "Searches", align: "right", hide: "lg", render: (row) => full(row.searches) },
    { key: "lists", header: "Lists", align: "right", hide: "lg", render: (row) => full(row.list_count) },
    {
      key: "activity",
      header: "Last search",
      hide: "lg",
      render: (row) => <span className="text-[11.5px] text-ink-mute">{ago(row.last_search_at)}</span>,
    },
    {
      key: "created_at",
      header: "Created",
      align: "right",
      hide: "sm",
      render: (row) => <span className="whitespace-nowrap text-[11.5px] text-ink-mute">{dateOnly(row.created_at)}</span>,
    },
  ];

  const chips = ([["q", `Search: ${get("q")}`], ["plan", `Plan: ${get("plan")}`], ["client", `Type: ${get("client")}`]] as const).filter(
    ([key]) => get(key),
  );

  return (
    <>
      <PageHead
        title="Workspaces"
        description={data ? `${full(data.total)} workspace(s) match the current filters.` : "Every workspace across every account."}
      />

      <FilterBar>
        <SearchField value={get("q")} onChange={(v) => set({ q: v })} placeholder="Workspace, owner name or owner email" />
        <SelectField label="Plan" value={get("plan")} onChange={(v) => set({ plan: v })} options={PLAN_OPTIONS} />
        <SelectField label="Workspace type" value={get("client")} onChange={(v) => set({ client: v })} options={CLIENT_OPTIONS} />
        <SelectField label="Sort" value={get("sort") || "created_at"} onChange={(v) => set({ sort: v })} options={SORT_OPTIONS} />
      </FilterBar>

      {chips.length ? (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          {chips.map(([key, label]) => (
            <Chip key={key} label={label} onClear={() => set({ [key]: null })} />
          ))}
          <button type="button" onClick={clearAll} className="text-[11px] text-ink-mute underline-offset-2 hover:text-ink hover:underline">
            Clear all
          </button>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        loading={loading}
        error={error}
        rowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/admin/workspaces/${row.id}`)}
        empty={{
          title: chips.length ? "No workspaces match those filters" : "No workspaces yet",
          description: chips.length ? "Try clearing a filter." : "A workspace is created automatically when someone signs up.",
        }}
      />

      {data ? (
        <TableFooter page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => set({ page: p })} />
      ) : null}
    </>
  );
}
