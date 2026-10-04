/* ------------------------------------------------------------------ */
/* /admin/audit-logs — the immutable record of privileged actions      */
/*                                                                     */
/* Rows are written by the API, never by the UI, and the table rejects */
/* UPDATE and DELETE at the database level (including from the service */
/* role). Normal customers cannot read it at all.                      */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  Caveat,
  DataTable,
  DebouncedSearch,
  ErrorState,
  FilterSelect,
  Nothing,
  PagerBar,
  Panel,
  RangeFilter,
  StatusBadge,
  formatDateTime,
  formatNumber,
  useFilters,
} from "../components";
import { arr, num, obj, str, type Row } from "../shape";

function StatePreview({ label, value }: { label: string; value: unknown }) {
  const entries = Object.entries(obj(value));
  if (!entries.length) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-neutral-400">{label}</p>
      <ul className="mt-0.5 space-y-0.5">
        {entries.map(([key, entry]) => (
          <li key={key} className="truncate font-mono text-[11px] text-ink-soft">
            {key}: {entry === null ? "null" : String(entry)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminAuditLogs({ identity }: { identity: AdminIdentity }) {
  const { get, set, page, setPage } = useFilters();
  const [expanded, setExpanded] = useState<string | null>(null);
  const range = get("range");

  const query = useAdminData<Row>("audit-logs", {
    action: get("action"),
    targetType: get("targetType"),
    adminId: get("adminId"),
    targetId: get("targetId"),
    range: range || undefined,
    from: get("from"),
    to: get("to"),
    page,
    pageSize: 25,
  });

  const rows = arr(query.data?.rows);
  const total = num(query.data?.total);
  const facets = obj(query.data?.facets);

  return (
    <AdminLayout
      identity={identity}
      title="Audit logs"
      description="Who did what, to which record, with the before and after state — append-only."
      aside={
        <RangeFilter
          value={range || "all"}
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
          <Panel
            title={`${formatNumber(total)} recorded actions`}
            aside={
              <div className="flex flex-wrap items-center gap-1.5">
                <DebouncedSearch
                  value={get("targetId")}
                  placeholder="Target id"
                  onChange={(value) => set({ targetId: value })}
                />
                <FilterSelect
                  label="Action"
                  value={get("action")}
                  width="w-[170px]"
                  options={[
                    { value: "", label: "All actions" },
                    ...(Array.isArray(facets.actions) ? (facets.actions as unknown[]) : []).map((action) => ({
                      value: String(action),
                      label: String(action),
                    })),
                  ]}
                  onChange={(value) => set({ action: value })}
                />
                <FilterSelect
                  label="Target type"
                  value={get("targetType")}
                  width="w-[140px]"
                  options={[
                    { value: "", label: "All targets" },
                    { value: "user", label: "User" },
                    { value: "workspace", label: "Workspace" },
                    { value: "plan", label: "Plan" },
                    { value: "subscription", label: "Subscription" },
                    { value: "usage", label: "Usage" },
                    { value: "webhook", label: "Webhook" },
                    { value: "system", label: "System" },
                  ]}
                  onChange={(value) => set({ targetType: value })}
                />
                <FilterSelect
                  label="Administrator"
                  value={get("adminId")}
                  width="w-[180px]"
                  options={[
                    { value: "", label: "All administrators" },
                    ...arr(facets.admins).map((admin) => ({
                      value: str(admin.id),
                      label: str(admin.email) || str(admin.id),
                    })),
                  ]}
                  onChange={(value) => set({ adminId: value })}
                />
              </div>
            }
          >
            <DataTable
              columns={[
                {
                  key: "when",
                  header: "When",
                  render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>,
                },
                {
                  key: "admin",
                  header: "Administrator",
                  render: (row) => (
                    <div className="min-w-0">
                      <p className="truncate text-xs text-ink">{str(row.admin_name) || "—"}</p>
                      <p className="truncate text-[11px] text-ink-mute">{str(row.admin_email)}</p>
                    </div>
                  ),
                },
                {
                  key: "action",
                  header: "Action",
                  render: (row) => <span className="font-mono text-[11px] text-ink">{str(row.action)}</span>,
                },
                {
                  key: "target",
                  header: "Target",
                  render: (row) => {
                    const type = str(row.target_type);
                    const id = str(row.target_id);
                    const label = str(row.target_label) || id || "—";
                    if (type === "user" && id) {
                      return (
                        <Link to={`/admin/users/${id}`} className="text-xs text-ink hover:underline">
                          {label}
                        </Link>
                      );
                    }
                    if (type === "workspace" && id) {
                      return (
                        <Link to={`/admin/workspaces/${id}`} className="text-xs text-ink hover:underline">
                          {label}
                        </Link>
                      );
                    }
                    return (
                      <span className="text-xs">
                        {type}
                        {label !== "—" ? ` · ${label}` : ""}
                      </span>
                    );
                  },
                },
                {
                  key: "summary",
                  header: "Summary",
                  render: (row) => (
                    <span className="text-[11px] text-ink-soft" title={str(row.summary)}>
                      {str(row.summary).slice(0, 70)}
                    </span>
                  ),
                },
                { key: "result", header: "Result", render: (row) => <StatusBadge value={row.result} /> },
                { key: "ip", header: "IP", render: (row) => <span className="font-mono text-[11px]">{str(row.ip) || "—"}</span> },
                {
                  key: "expand",
                  header: "",
                  render: (row) => (
                    <button
                      type="button"
                      aria-label="Show change detail"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpanded(expanded === str(row.id) ? null : str(row.id));
                      }}
                      className="text-neutral-400 transition-colors hover:text-ink"
                    >
                      {expanded === str(row.id) ? (
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                      )}
                    </button>
                  ),
                },
              ]}
              rows={rows}
              loading={query.loading}
              rowKey={(row) => str(row.id)}
              minWidth="min-w-[1040px]"
              empty={
                <Nothing
                  title="No admin actions recorded"
                  description="Every privileged change made in this console will appear here."
                />
              }
            />

            {expanded ? (
              <div className="mt-3 rounded border border-black/[0.07] bg-neutral-50 px-3 py-2.5">
                {rows
                  .filter((row) => str(row.id) === expanded)
                  .map((row) => (
                    <div key={str(row.id)} className="grid gap-3 sm:grid-cols-3">
                      <StatePreview label="Before" value={row.before_state} />
                      <StatePreview label="After" value={row.after_state} />
                      <StatePreview label="Metadata" value={row.metadata} />
                      {!Object.keys(obj(row.before_state)).length && !Object.keys(obj(row.after_state)).length ? (
                        <p className="text-[11px] text-ink-mute">
                          This action recorded no state change (it either failed or was read-only).
                        </p>
                      ) : null}
                    </div>
                  ))}
              </div>
            ) : null}

            <PagerBar page={page} pageSize={num(query.data?.pageSize) || 25} total={total} onPage={setPage} />
          </Panel>

          <Caveat>
            This table is append-only: a database trigger rejects every UPDATE and DELETE, including ones made with the
            service role, and row-level security lets only administrators read it. Entries are written by the API after
            the change is confirmed, with actor, action, target, before/after state, reason, IP and user agent.
          </Caveat>
        </div>
      )}
    </AdminLayout>
  );
}
