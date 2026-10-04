/* ------------------------------------------------------------------ */
/* /admin/searches — search operations console                         */
/*                                                                     */
/* Read-only by design: the lead pipeline is driven by SerpApi and the */
/* search-run function, and there is no safe server-side "re-run"      */
/* that wouldn't consume the customer's quota without their consent.   */
/* So this page answers "what happened", in full detail.               */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  Caveat,
  CopyValue,
  CountChips,
  DataTable,
  DebouncedSearch,
  ErrorState,
  FilterSelect,
  KeyValue,
  LoadingPanel,
  Nothing,
  PagerBar,
  Panel,
  RangeFilter,
  StatusBadge,
  formatDateTime,
  formatNumber,
  timeAgo,
  useFilters,
} from "../components";
import { arr, bool, counts, num, obj, str, type Row } from "../shape";
import { Drawer, IconBtn } from "../../components/ui";

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "failed_only", label: "Failed only" },
  { value: "processing_only", label: "In flight" },
  { value: "completed", label: "Completed" },
  { value: "partial", label: "Partial" },
  { value: "cancelled", label: "Cancelled" },
  { value: "queued", label: "Queued" },
  { value: "processing", label: "Processing" },
  { value: "fetching", label: "Fetching" },
  { value: "normalizing", label: "Normalizing" },
  { value: "deduplicating", label: "Deduplicating" },
  { value: "saving", label: "Saving" },
];

function SearchDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAdminData<Row>(`searches/${id}`);
  const search = obj(query.data?.search);
  const jobs = arr(query.data?.jobs);
  const leads = obj(query.data?.leads);

  return (
    <Drawer open onClose={onClose} label="Search detail">
      <div className="flex items-start justify-between gap-3 border-b border-black/[0.05] px-4 py-3.5">
        <div className="min-w-0">
          <p className="font-display truncate text-sm font-semibold tracking-[-0.01em] text-ink">
            {str(search.query) || "Search"}
          </p>
          <p className="truncate text-[11px] text-ink-mute">{str(search.location) || "No location"}</p>
        </div>
        <IconBtn variant="ghost" label="Close" onClick={onClose}>
          <X className="size-3.5" aria-hidden="true" />
        </IconBtn>
      </div>

      <div className="thin-scroll flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
        {query.error ? (
          <ErrorState message={query.error} onRetry={query.refresh} />
        ) : query.initial ? (
          <LoadingPanel rows={5} />
        ) : (
          <>
            <KeyValue
              items={[
                { label: "Status", value: <StatusBadge value={search.status} /> },
                { label: "Requested", value: formatNumber(search.requested_count) },
                { label: "Returned", value: formatNumber(search.result_count) },
                { label: "Started", value: formatDateTime(search.created_at) },
                { label: "Completed", value: formatDateTime(search.completed_at) },
                { label: "Search id", value: <CopyValue value={str(search.id)} label="search id" /> },
                {
                  label: "Workspace",
                  value: (
                    <Link to={`/admin/workspaces/${str(search.workspace_id)}`} className="hover:underline">
                      {str(search.workspace_name) || "—"}
                    </Link>
                  ),
                },
                {
                  label: "Run by",
                  value: (
                    <Link to={`/admin/users/${str(search.user_id)}`} className="hover:underline">
                      {str(search.user_name) || str(search.user_email) || "—"}
                    </Link>
                  ),
                },
              ]}
            />

            {str(search.error) ? (
              <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-4 text-red-700">
                {str(search.error)}
              </p>
            ) : null}

            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-400">Jobs</p>
              <DataTable
                columns={[
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  { key: "stage", header: "Stage", render: (row) => str(row.current_stage) || "—" },
                  {
                    key: "processed",
                    header: "Processed",
                    numeric: true,
                    render: (row) => `${formatNumber(row.processed_count)} / ${formatNumber(row.requested_count)}`,
                  },
                  { key: "at", header: "Started", render: (row) => timeAgo(row.created_at) },
                ]}
                rows={jobs}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[400px]"
                empty={<Nothing title="No job rows" description="This search never reached the job queue." />}
              />
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-400">
                Leads saved ({formatNumber(leads.count)})
              </p>
              <p className="mb-2 text-[11px] text-ink-mute">
                {formatNumber(leads.with_email)} with email · {formatNumber(leads.with_phone)} with phone ·{" "}
                {formatNumber(leads.with_website)} with website
              </p>
              <DataTable
                columns={[
                  { key: "name", header: "Business", render: (row) => str(row.name) },
                  { key: "city", header: "City", render: (row) => str(row.city) || "—" },
                  {
                    key: "contact",
                    header: "Contact",
                    render: (row) =>
                      [bool(row.has_email) ? "email" : null, bool(row.has_phone) ? "phone" : null, bool(row.has_website) ? "web" : null]
                        .filter(Boolean)
                        .join(" · ") || "none",
                  },
                  { key: "rating", header: "Rating", numeric: true, render: (row) => str(row.rating) || "—" },
                ]}
                rows={arr(leads.sample)}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[400px]"
                empty={<Nothing title="No leads saved" description="The search returned nothing that passed dedupe." />}
              />
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

export function AdminSearches({ identity }: { identity: AdminIdentity }) {
  const { get, set, page, setPage } = useFilters();
  const [openId, setOpenId] = useState<string | null>(null);
  const range = get("range");

  const query = useAdminData<Row>("searches", {
    q: get("q"),
    status: get("status"),
    workspaceId: get("workspaceId"),
    userId: get("userId"),
    range: range || undefined,
    from: get("from"),
    to: get("to"),
    page,
    pageSize: 25,
  });

  const rows = arr(query.data?.rows);
  const total = num(query.data?.total);

  return (
    <AdminLayout
      identity={identity}
      title="Searches"
      description="Every lead search across every workspace, with the job stages and errors behind it."
      aside={
        <RangeFilter
          value={range || "all"}
          from={get("from")}
          to={get("to")}
          /* "All time" here means no date filter at all, not a wide window. */
          onChange={(patch) =>
            set({ ...patch, range: patch.range === "all" ? null : patch.range } as Record<string, string | null>)
          }
        />
      }
    >
      {query.error ? (
        <ErrorState message={query.error} onRetry={query.refresh} />
      ) : (
        <div className="space-y-2.5">
          <Panel title="Status mix" description="Counts for the current filter">
            <CountChips counts={counts(query.data?.byStatus)} />
          </Panel>

          <Panel
            title={`${formatNumber(total)} ${total === 1 ? "search" : "searches"}`}
            aside={
              <div className="flex flex-wrap items-center gap-1.5">
                <DebouncedSearch
                  value={get("q")}
                  placeholder="Query, location or search id"
                  onChange={(value) => set({ q: value })}
                />
                <FilterSelect
                  label="Status"
                  value={get("status")}
                  options={STATUS_OPTIONS}
                  onChange={(value) => set({ status: value })}
                  width="w-[150px]"
                />
              </div>
            }
          >
            <DataTable
              columns={[
                {
                  key: "query",
                  header: "Query",
                  render: (row) => (
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink">{str(row.query)}</p>
                      <p className="truncate text-[11px] text-ink-mute">{str(row.location) || "No location"}</p>
                    </div>
                  ),
                },
                {
                  key: "workspace",
                  header: "Workspace",
                  render: (row) => <span className="truncate text-xs">{str(row.workspace_name) || "—"}</span>,
                },
                {
                  key: "user",
                  header: "Customer",
                  render: (row) => (
                    <div className="min-w-0">
                      <p className="truncate text-xs">{str(row.user_name) || "—"}</p>
                      <p className="truncate text-[11px] text-ink-mute">{str(row.user_email)}</p>
                    </div>
                  ),
                },
                { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                {
                  key: "results",
                  header: "Results",
                  numeric: true,
                  render: (row) => `${formatNumber(row.result_count)} / ${formatNumber(row.requested_count)}`,
                },
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
              rows={rows}
              loading={query.loading}
              rowKey={(row) => str(row.id)}
              onRowClick={(row) => setOpenId(str(row.id))}
              minWidth="min-w-[940px]"
              empty={
                <Nothing
                  title={get("q") || get("status") ? "No searches match those filters" : "No searches yet"}
                  description="Searches appear the moment a customer runs one."
                />
              }
            />
            <PagerBar page={page} pageSize={num(query.data?.pageSize) || 25} total={total} onPage={setPage} />
          </Panel>

          <Caveat>
            There is no re-run button: re-running a customer's search would spend their lead quota and their SerpApi
            credits without consent. Use the detail view to diagnose, then ask the customer to re-run, or correct their
            quota from the workspace page.
          </Caveat>
        </div>
      )}

      {openId ? <SearchDetailDrawer id={openId} onClose={() => setOpenId(null)} /> : null}
    </AdminLayout>
  );
}
