/* ------------------------------------------------------------------ */
/* /admin/ai — AI request monitoring.                                  */
/*                                                                     */
/* The ai_requests table stores kind, status, model, tokens and error. */
/* It does NOT store cost or latency, so this page reports neither —   */
/* a spend figure would have to be invented from a price list the      */
/* database has never seen.                                            */
/* ------------------------------------------------------------------ */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RotateCw } from "lucide-react";
import { Btn, Card, DialogHeader, Drawer } from "../../components/ui";
import { useAdminResource } from "../client";
import { useUrlFilters } from "./Users";
import {
  BarSeries,
  Chip,
  DataTable,
  Distribution,
  FilterBar,
  KeyValue,
  Metric,
  MetricGrid,
  Mono,
  PageHead,
  PeriodPicker,
  Section,
  SelectField,
  StatusBadge,
  TableFooter,
  Unavailable,
  ago,
  compact,
  dateTime,
  defaultPeriod,
  full,
  num,
  periodParams,
  type Column,
  type PeriodState,
} from "../ui";

type Row = {
  id: string;
  workspace_id: string;
  user_id: string;
  kind: string;
  status: string;
  model: string | null;
  tokens: number | null;
  error: string | null;
  created_at: string;
  owner: { name: string; email: string } | null;
  workspace_name: string | null;
};

type Response = {
  summary: {
    total: number;
    completed: number;
    failed: number;
    processing: number;
    tokens_sum: number;
    tokens_rows: number;
    by_kind: Record<string, number>;
    by_model: Record<string, number>;
    daily: { day: string; total: number; failed: number }[];
    top_errors: { error: string; count: number }[];
    top_workspaces: { id: string; name: string; count: number }[];
  };
  rows: Row[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const KINDS = ["interpret", "analyze", "suggest", "summary"];
const STATUSES = ["processing", "completed", "failed"];

export function AdminAi() {
  const navigate = useNavigate();
  const { get, set, clearAll } = useUrlFilters();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);
  const [open, setOpen] = useState<Row | null>(null);

  const params = useMemo(
    () => ({
      ...periodParams(period),
      kind: get("kind"),
      status: get("status"),
      page: get("page") || 1,
      pageSize: 25,
    }),
    [period, get],
  );
  const { data, loading, error, reload } = useAdminResource<Response>("ai", params);
  const s = data?.summary;
  const failureRate = num(s?.total) > 0 ? `${Math.round((num(s?.failed) / num(s?.total)) * 100)}%` : "0%";

  const columns: Column<Row>[] = [
    { key: "kind", header: "Kind", render: (row) => <span className="font-medium text-ink">{row.kind}</span> },
    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
    { key: "model", header: "Model", hide: "md", render: (row) => <Mono value={row.model} /> },
    { key: "tokens", header: "Tokens", align: "right", hide: "sm", render: (row) => (row.tokens == null ? <span className="text-neutral-300">—</span> : full(row.tokens)) },
    { key: "workspace", header: "Workspace", hide: "lg", render: (row) => <span className="truncate">{row.workspace_name ?? "—"}</span> },
    { key: "user", header: "User", hide: "lg", render: (row) => <span className="truncate">{row.owner?.email ?? "—"}</span> },
    { key: "created", header: "When", align: "right", hide: "sm", render: (row) => <span className="whitespace-nowrap text-[11.5px] text-ink-mute">{ago(row.created_at)}</span> },
  ];

  const chips = (
    [
      ["kind", `Kind: ${get("kind")}`],
      ["status", `Status: ${get("status")}`],
    ] as const
  ).filter(([key]) => get(key));

  return (
    <>
      <PageHead
        title="AI monitoring"
        description="Every ai_requests row — interpretation, analysis, suggestions and summaries."
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
          <Metric label="Requests" value={full(s?.total)} loading={loading} />
          <Metric label="Completed" value={full(s?.completed)} tone="good" loading={loading} />
          <Metric label="Failed" value={full(s?.failed)} hint={`${failureRate} failure rate`} tone={num(s?.failed) ? "bad" : "neutral"} loading={loading} />
          <Metric label="In flight" value={full(s?.processing)} tone={num(s?.processing) ? "warn" : "neutral"} loading={loading} />
          <Metric
            label="Tokens"
            value={compact(s?.tokens_sum)}
            hint={`reported by ${full(s?.tokens_rows)} of ${full(s?.total)} requests`}
            loading={loading}
          />
        </MetricGrid>

        <Card className="min-w-0 p-4">
          <Section title="Cost">
            <Unavailable
              label="AI spend is not tracked"
              reason="ai_requests records the model and token count but no price, and OpenRouter pricing is not stored anywhere in this database. A rupee figure here would be invented, so none is shown. Spend is available in the OpenRouter dashboard."
            />
          </Section>
        </Card>

        <Card className="min-w-0 p-4">
          <Section title="Volume" description="Completed vs failed requests per day.">
            {loading ? (
              <div className="h-[120px] animate-pulse rounded bg-black/[0.04]" />
            ) : (
              <BarSeries
                points={(s?.daily ?? []) as unknown as Record<string, string | number>[]}
                keys={[
                  { key: "total", label: "Requests", className: "bg-brand-600" },
                  { key: "failed", label: "Failed", className: "bg-red-500" },
                ]}
              />
            )}
          </Section>
        </Card>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <Card className="min-w-0 p-4">
            <Section title="By kind">
              <Distribution data={s?.by_kind} total={num(s?.total)} emptyLabel="No AI requests in this period." />
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="By model">
              <Distribution data={s?.by_model} total={num(s?.total)} emptyLabel="No AI requests in this period." />
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="Top failures" description="Grouped by error text.">
              {s?.top_errors?.length ? (
                <ul className="space-y-1.5 text-[12px]">
                  {s.top_errors.map((e) => (
                    <li key={e.error} className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 break-words text-ink-soft">{e.error}</span>
                      <span className="shrink-0 tabular-nums text-ink">{full(e.count)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11.5px] text-ink-mute">No AI failures in this period.</p>
              )}
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="Heaviest workspaces">
              <Distribution
                data={Object.fromEntries((s?.top_workspaces ?? []).map((w) => [w.name, w.count]))}
                total={num(s?.total)}
                emptyLabel="No AI requests in this period."
              />
            </Section>
          </Card>
        </div>

        <Section title="Requests">
          <FilterBar>
            <SelectField label="Kind" value={get("kind")} onChange={(v) => set({ kind: v })} options={[{ value: "", label: "Any kind" }, ...KINDS.map((k) => ({ value: k, label: k }))]} />
            <SelectField label="Status" value={get("status")} onChange={(v) => set({ status: v })} options={[{ value: "", label: "Any status" }, ...STATUSES.map((k) => ({ value: k, label: k }))]} />
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
            onRowClick={(row) => setOpen(row)}
            empty={{ title: "No AI requests match", description: "AI features are limited to plans with has_ai enabled." }}
          />
          {data ? (
            <TableFooter page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => set({ page: p })} />
          ) : null}
        </Section>
      </div>

      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} label="AI request">
        {open ? (
          <div className="thin-scroll flex-1 space-y-4 overflow-y-auto p-4">
            <DialogHeader title="AI request" description={open.kind} onClose={() => setOpen(null)} />
            <KeyValue
              items={[
                { label: "Request id", value: <Mono value={open.id} /> },
                { label: "Kind", value: open.kind },
                { label: "Status", value: <StatusBadge value={open.status} /> },
                { label: "Model", value: <Mono value={open.model} /> },
                { label: "Tokens", value: open.tokens == null ? "Not reported" : full(open.tokens) },
                { label: "Created", value: dateTime(open.created_at) },
                { label: "Workspace", value: open.workspace_name ?? "—" },
                { label: "User", value: open.owner?.email ?? "—" },
              ]}
            />
            {open.error ? (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-red-700">Error</p>
                <p className="mt-1 break-words text-[12px] leading-5 text-red-700">{open.error}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Btn variant="outline" size="sm" onClick={() => navigate(`/admin/workspaces/${open.workspace_id}`)}>
                Open workspace
              </Btn>
              <Btn variant="outline" size="sm" onClick={() => navigate(`/admin/users/${open.user_id}`)}>
                Open customer
              </Btn>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
