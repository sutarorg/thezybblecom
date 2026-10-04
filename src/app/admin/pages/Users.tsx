/* ------------------------------------------------------------------ */
/* /admin/users — customer administration.                             */
/*                                                                     */
/* Filtering, sorting and paging all happen in Postgres via            */
/* admin_list_users(); the browser never receives more than one page.  */
/* Filters are mirrored into the URL so a support link is shareable    */
/* and survives a refresh.                                             */
/* ------------------------------------------------------------------ */
import { useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Avatar } from "../../components/ui";
import { useAdminResource } from "../client";
import {
  Chip,
  DataTable,
  FilterBar,
  PageHead,
  PlanBadge,
  SearchField,
  SelectField,
  StatusBadge,
  TableFooter,
  ago,
  dateOnly,
  full,
  type Column,
} from "../ui";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  plan_id: string;
  subscription_status: string | null;
  subscription_id: string | null;
  workspace_count: number;
  leads_used: number;
  searches: number;
  last_activity_at: string | null;
};

type Response = {
  rows: UserRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const PLAN_OPTIONS = [
  { value: "", label: "All plans" },
  { value: "free", label: "Free" },
  { value: "growth", label: "Growth" },
  { value: "agency", label: "Agency" },
  { value: "scale", label: "Scale" },
];
const ROLE_OPTIONS = [
  { value: "", label: "All roles" },
  { value: "user", label: "User" },
  { value: "admin", label: "Admin" },
];
const STATUS_OPTIONS = [
  { value: "", label: "All accounts" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];
const SUBSCRIPTION_OPTIONS = [
  { value: "", label: "Any subscription" },
  { value: "none", label: "No subscription" },
  ...["created", "authenticated", "pending", "active", "trialing", "past_due", "cancelled", "paused", "halted", "failed", "expired", "completed"].map(
    (s) => ({ value: s, label: s.replace(/_/g, " ") }),
  ),
];

/** URL ⇄ filter state. Keeps /admin/users?plan=growth refresh-safe. */
export function useUrlFilters(defaults: Record<string, string> = {}) {
  const [params, setParams] = useSearchParams();
  const get = useCallback((key: string) => params.get(key) ?? defaults[key] ?? "", [params, defaults]);
  const set = useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === undefined) next.delete(key);
        else next.set(key, String(value));
      }
      // Any filter change invalidates the current page.
      if (!("page" in patch)) next.delete("page");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  const clearAll = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  return { get, set, clearAll, params };
}

export function AdminUsers() {
  const navigate = useNavigate();
  const { get, set, clearAll } = useUrlFilters({ sort: "created_at", dir: "desc" });

  const query = useMemo(
    () => ({
      q: get("q"),
      plan: get("plan"),
      role: get("role"),
      status: get("status"),
      subscription: get("subscription"),
      from: get("from"),
      to: get("to"),
      sort: get("sort") || "created_at",
      dir: get("dir") || "desc",
      page: get("page") || 1,
      pageSize: 25,
    }),
    [get],
  );

  const { data, loading, error } = useAdminResource<Response>("users", query);

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Customer",
      sortable: true,
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={row.name || row.email || "?"} tint="bg-brand-50 text-brand-700" size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.name || "Unnamed"}</p>
            <p className="truncate text-[11px] text-ink-mute">{row.email || "—"}</p>
          </div>
        </div>
      ),
    },
    { key: "plan", header: "Plan", sortable: true, hide: "sm", render: (row) => <PlanBadge plan={row.plan_id} /> },
    {
      key: "subscription_status",
      header: "Subscription",
      hide: "md",
      render: (row) => (row.subscription_status ? <StatusBadge value={row.subscription_status} /> : <span className="text-[11px] text-neutral-400">none</span>),
    },
    {
      key: "status",
      header: "Account",
      hide: "sm",
      render: (row) => (
        <span className="inline-flex items-center gap-1">
          <StatusBadge value={row.status} />
          {row.role === "admin" ? <StatusBadge value="admin" /> : null}
        </span>
      ),
    },
    { key: "workspace_count", header: "WS", align: "right", hide: "lg", render: (row) => full(row.workspace_count) },
    {
      key: "leads_used",
      header: "Leads (mo)",
      align: "right",
      sortable: true,
      hide: "md",
      render: (row) => full(row.leads_used),
    },
    { key: "searches", header: "Searches", align: "right", hide: "lg", render: (row) => full(row.searches) },
    {
      key: "last_activity_at",
      header: "Last active",
      hide: "lg",
      render: (row) => <span className="text-[11.5px] text-ink-mute">{ago(row.last_activity_at)}</span>,
    },
    {
      key: "created_at",
      header: "Signed up",
      sortable: true,
      align: "right",
      hide: "sm",
      render: (row) => <span className="whitespace-nowrap text-[11.5px] text-ink-mute">{dateOnly(row.created_at)}</span>,
    },
  ];

  const chips = (
    [
      ["q", `Search: ${get("q")}`],
      ["plan", `Plan: ${get("plan")}`],
      ["role", `Role: ${get("role")}`],
      ["status", `Account: ${get("status")}`],
      ["subscription", `Subscription: ${get("subscription")}`],
      ["from", `From: ${get("from")}`],
      ["to", `To: ${get("to")}`],
    ] as const
  ).filter(([key]) => get(key));

  return (
    <>
      <PageHead
        title="Users"
        description={data ? `${full(data.total)} account(s) match the current filters.` : "Every Zybble account, with its effective plan and current usage."}
      />

      <FilterBar>
        <SearchField value={get("q")} onChange={(v) => set({ q: v })} placeholder="Name, email or user id" />
        <SelectField label="Plan" value={get("plan")} onChange={(v) => set({ plan: v })} options={PLAN_OPTIONS} />
        <SelectField label="Role" value={get("role")} onChange={(v) => set({ role: v })} options={ROLE_OPTIONS} />
        <SelectField label="Account status" value={get("status")} onChange={(v) => set({ status: v })} options={STATUS_OPTIONS} />
        <SelectField
          label="Subscription status"
          value={get("subscription")}
          onChange={(v) => set({ subscription: v })}
          options={SUBSCRIPTION_OPTIONS}
        />
        <input
          type="date"
          aria-label="Signed up from"
          value={get("from")}
          onChange={(e) => set({ from: e.target.value })}
          className="h-8 shrink-0 rounded border border-black/[0.09] bg-white px-2 text-xs text-ink outline-none focus:border-black/[0.2]"
        />
        <input
          type="date"
          aria-label="Signed up to"
          value={get("to")}
          onChange={(e) => set({ to: e.target.value })}
          className="h-8 shrink-0 rounded border border-black/[0.09] bg-white px-2 text-xs text-ink outline-none focus:border-black/[0.2]"
        />
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
        onRowClick={(row) => navigate(`/admin/users/${row.id}`)}
        sort={{ key: get("sort") || "created_at", dir: (get("dir") || "desc") as "asc" | "desc" }}
        onSort={(key) => set({ sort: key, dir: get("sort") === key && get("dir") === "desc" ? "asc" : "desc" })}
        empty={{
          title: chips.length ? "No users match those filters" : "No accounts yet",
          description: chips.length
            ? "Try widening the search or clearing a filter."
            : "Accounts appear here as soon as someone signs up for Zybble.",
        }}
      />

      {data ? (
        <TableFooter
          page={data.page}
          totalPages={data.totalPages}
          total={data.total}
          pageSize={data.pageSize}
          onPage={(p) => set({ page: p })}
        />
      ) : null}
    </>
  );
}
