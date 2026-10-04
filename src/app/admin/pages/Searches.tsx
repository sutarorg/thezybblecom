/* ------------------------------------------------------------------ */
/* /admin/searches — global search/job operations console.             */
/*                                                                     */
/* Statuses mirror the CHECK constraints on lead_searches and          */
/* lead_search_jobs exactly. There is no "retry" control: the search   */
/* pipeline reserves quota before calling the provider and has no      */
/* idempotent resume path, so a retry button would either double-bill  */
/* the customer's allowance or lie about what it did.                  */
/* ------------------------------------------------------------------ */
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, RotateCw } from "lucide-react";
import { Btn, Card, Skel } from "../../components/ui";
import { useAdminResource } from "../client";
import { useUrlFilters } from "./Users";
import {
  Chip,
  DataTable,
  ErrorPanel,
  FilterBar,
  KeyValue,
  Mono,
  PageHead,
  SearchField,
  Section,
  SelectField,
  StatusBadge,
  TableFooter,
  ago,
  dateTime,
  full,
  type Column,
} from "../ui";

type Row = {
  id: string;
  workspace_id: string;
  user_id: string;
  query: string;
  location: string | null;
  requested_count: number;
  result_count: number;
  status: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  owner: { name: string; email: string } | null;
  workspace_name: string | null;
};

type Response = { rows: Row[]; page: number; pageSize: number; total: number; totalPages: number };

const STATUSES = [
  "queued", "processing", "fetching", "normalizing", "deduplicating",
  "saving", "completed", "partial", "failed", "cancelled",
];

const VIEW_OPTIONS = [
  { value: "", label: "All searches" },
  { value: "failed", label: "Failed & partial" },
  { value: "processing", label: "In flight" },
];

export function AdminSearches() {
  const navigate = useNavigate();
  const { get, set, clearAll } = useUrlFilters();

  const params = useMemo(
    () => ({
      period: "90d",
      view: get("view"),
      status: get("view") ? "" : get("status"),
      workspaceId: get("workspaceId"),
      userId: get("userId"),
      q: get("q"),
      page: get("page") || 1,
      pageSize: 25,
    }),
    [get],
  );
  const { data, loading, error } = useAdminResource<Response>("searches", params);

  const columns: Column<Row>[] = [
    {
      key: "query",
      header: "Query",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.query}</p>
          <p className="truncate text-[11px] text-ink-mute">{row.location || "No location"}</p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
    {
      key: "results",
      header: "Results",
      align: "right",
      render: (row) => (
        <span className={row.result_count < row.requested_count ? "text-amber-600" : undefined}>
          {full(row.result_count)}/{full(row.requested_count)}
        </span>
      ),
    },
    {
      key: "workspace",
      header: "Workspace",
      hide: "md",
      render: (row) => <span className="truncate">{row.workspace_name ?? "—"}</span>,
    },
    { key: "owner", header: "User", hide: "lg", render: (row) => <span className="truncate">{row.owner?.email ?? "—"}</span> },
    {
      key: "error",
      header: "Failure",
      hide: "lg",
      render: (row) => (row.error ? <span className="truncate text-red-600" title={row.error}>{row.error}</span> : <span className="text-neutral-300">—</span>),
    },
    {
      key: "created_at",
      header: "Started",
      align: "right",
      hide: "sm",
      render: (row) => <span className="whitespace-nowrap text-[11.5px] text-ink-mute">{ago(row.created_at)}</span>,
    },
  ];

  const chips = (
    [
      ["q", `Search: ${get("q")}`],
      ["view", `View: ${get("view")}`],
      ["status", `Status: ${get("status")}`],
      ["workspaceId", `Workspace: ${get("workspaceId").slice(0, 8)}…`],
      ["userId", `User: ${get("userId").slice(0, 8)}…`],
    ] as const
  ).filter(([key]) => get(key));

  return (
    <>
      <PageHead
        title="Search operations"
        description="Every search run in the last 90 days, with its pipeline status and failure reason."
      />

      <FilterBar>
        <SearchField value={get("q")} onChange={(v) => set({ q: v })} placeholder="Query text or location" />
        <SelectField label="View" value={get("view")} onChange={(v) => set({ view: v, status: null })} options={VIEW_OPTIONS} />
        {!get("view") ? (
          <SelectField
            label="Status"
            value={get("status")}
            onChange={(v) => set({ status: v })}
            options={[{ value: "", label: "Any status" }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        ) : null}
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
        onRowClick={(row) => navigate(`/admin/searches/${row.id}`)}
        empty={{ title: chips.length ? "No searches match those filters" : "No searches in the last 90 days" }}
      />

      {data ? (
        <TableFooter page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => set({ page: p })} />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* /admin/searches/:id                                                 */
/* ------------------------------------------------------------------ */
type Detail = {
  search: Record<string, unknown>;
  jobs: Record<string, unknown>[];
  leadCount: number;
  owner: { name: string; email: string } | null;
  workspace: { id: string; name: string } | null;
};

export function AdminSearchDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAdminResource<Detail>(`searches/${id}`);

  const back = (
    <Btn variant="outline" size="sm" onClick={() => navigate("/admin/searches")}>
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      All searches
    </Btn>
  );

  if (error) {
    return (
      <>
        <PageHead title="Search" actions={back} />
        <ErrorPanel message={error} onRetry={reload} />
      </>
    );
  }

  const s = data?.search;
  const interpretation = s?.interpretation as Record<string, unknown> | null | undefined;
  const filters = s?.filters as Record<string, unknown> | null | undefined;

  return (
    <>
      <PageHead
        title={loading ? "Loading search…" : String(s?.query ?? "Search")}
        description={data?.workspace ? `${data.workspace.name} · ${data.owner?.email ?? "unknown user"}` : undefined}
        actions={
          <>
            {back}
            <Btn variant="outline" size="sm" onClick={reload} label="Refresh">
              <RotateCw className="size-3.5" aria-hidden="true" />
            </Btn>
          </>
        }
      />

      {loading ? (
        <Skel className="h-64 w-full rounded-lg" />
      ) : !s ? (
        <ErrorPanel message="That search no longer exists." onRetry={() => navigate("/admin/searches")} />
      ) : (
        <div className="space-y-4">
          <Card className="min-w-0 p-4">
            <Section title="Search">
              <KeyValue
                items={[
                  { label: "Search id", value: <Mono value={String(s.id)} /> },
                  { label: "Status", value: <StatusBadge value={String(s.status)} /> },
                  { label: "Query", value: String(s.query) },
                  { label: "Location", value: String(s.location ?? "—") },
                  { label: "Requested", value: full(s.requested_count) },
                  { label: "Returned", value: full(s.result_count) },
                  { label: "Leads stored", value: full(data?.leadCount) },
                  { label: "Started", value: dateTime(String(s.created_at)) },
                  { label: "Completed", value: s.completed_at ? dateTime(String(s.completed_at)) : "—" },
                  {
                    label: "Workspace",
                    value: data?.workspace ? (
                      <button type="button" className="text-brand-700 hover:underline" onClick={() => navigate(`/admin/workspaces/${data.workspace!.id}`)}>
                        {data.workspace.name}
                      </button>
                    ) : (
                      "—"
                    ),
                  },
                  {
                    label: "User",
                    value: (
                      <button type="button" className="text-brand-700 hover:underline" onClick={() => navigate(`/admin/users/${String(s.user_id)}`)}>
                        {data?.owner?.email ?? String(s.user_id)}
                      </button>
                    ),
                  },
                ]}
              />
              {s.error ? (
                <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-red-700">Failure</p>
                  <p className="mt-1 break-words text-[12px] leading-5 text-red-700">{String(s.error)}</p>
                </div>
              ) : null}
            </Section>
          </Card>

          <Card className="min-w-0 p-4">
            <Section title="Jobs" description="Pipeline stages recorded for this search.">
              {data?.jobs?.length ? (
                <ul className="divide-y divide-black/[0.05] text-[12px]">
                  {data.jobs.map((j) => (
                    <li key={String(j.id)} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <StatusBadge value={String(j.status)} />
                      <span className="text-ink-soft">stage: {String(j.current_stage ?? "—")}</span>
                      <span className="tabular-nums text-ink-mute">
                        {full(j.processed_count)}/{full(j.requested_count)}
                      </span>
                      <span className="ml-auto text-[11px] text-neutral-400">
                        {j.started_at ? dateTime(String(j.started_at)) : "not started"}
                        {j.completed_at ? ` → ${dateTime(String(j.completed_at))}` : ""}
                      </span>
                      {j.error ? <span className="w-full break-words text-[11px] text-red-600">{String(j.error)}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-[11.5px] text-ink-mute">No job rows — this search ran synchronously.</p>
              )}
            </Section>
          </Card>

          {interpretation || (filters && Object.keys(filters).length) ? (
            <Card className="min-w-0 p-4">
              <Section title="Request detail" description="AI interpretation and filters recorded with the search.">
                <pre className="thin-scroll max-h-64 overflow-auto rounded bg-neutral-50 p-3 font-mono text-[10.5px] leading-5 text-ink-soft">
                  {JSON.stringify({ interpretation, filters }, null, 2)}
                </pre>
              </Section>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
