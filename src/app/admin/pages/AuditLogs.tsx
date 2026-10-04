/* ------------------------------------------------------------------ */
/* /admin/audit-logs — the record of every privileged action.          */
/*                                                                     */
/* admin_audit_logs is append-only: no API route and no UI can edit or */
/* delete an entry. Each row carries actor, action, target, a          */
/* before/after snapshot, IP and timestamp.                            */
/* ------------------------------------------------------------------ */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RotateCw } from "lucide-react";
import { Btn, DialogHeader, Drawer } from "../../components/ui";
import { useAdminResource } from "../client";
import { useUrlFilters } from "./Users";
import {
  Chip,
  DataTable,
  FilterBar,
  KeyValue,
  Metric,
  MetricGrid,
  Mono,
  PageHead,
  PeriodPicker,
  Section,
  SelectField,
  TableFooter,
  ago,
  dateTime,
  defaultPeriod,
  full,
  periodParams,
  type Column,
  type PeriodState,
} from "../ui";

type Row = {
  id: string;
  admin_user_id: string | null;
  admin_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

type Response = {
  rows: Row[];
  actions: string[];
  targetTypes: string[];
  admins: string[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const targetHref = (row: Row) => {
  if (!row.target_id) return null;
  if (row.target_type === "user" || row.target_type === "profile") return `/admin/users/${row.target_id}`;
  if (row.target_type === "workspace") return `/admin/workspaces/${row.target_id}`;
  return null;
};

export function AdminAuditLogs() {
  const navigate = useNavigate();
  const { get, set, clearAll } = useUrlFilters();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);
  const [open, setOpen] = useState<Row | null>(null);

  const params = useMemo(
    () => ({
      ...periodParams(period),
      action: get("action"),
      targetType: get("targetType"),
      targetId: get("targetId"),
      adminId: get("adminId"),
      page: get("page") || 1,
      pageSize: 50,
    }),
    [period, get],
  );
  const { data, loading, error, reload } = useAdminResource<Response>("audit-logs", params);

  const columns: Column<Row>[] = [
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.action.replace(/[._]/g, " ")}</p>
          {row.summary ? <p className="truncate text-[11px] text-ink-mute">{row.summary}</p> : null}
        </div>
      ),
    },
    { key: "actor", header: "Admin", render: (row) => <span className="truncate">{row.admin_email ?? "unknown"}</span> },
    {
      key: "target",
      header: "Target",
      hide: "md",
      render: (row) =>
        row.target_id ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-ink-mute">{row.target_type}</span>
            <Mono value={row.target_id} />
          </span>
        ) : (
          <span className="text-ink-mute">{row.target_type}</span>
        ),
    },
    { key: "ip", header: "IP", hide: "lg", render: (row) => <Mono value={row.ip} /> },
    {
      key: "created",
      header: "When",
      align: "right",
      hide: "sm",
      render: (row) => <span className="whitespace-nowrap text-[11.5px] text-ink-mute">{ago(row.created_at)}</span>,
    },
  ];

  const chips = (
    [
      ["action", `Action: ${get("action")}`],
      ["targetType", `Target: ${get("targetType")}`],
      ["targetId", `Target id: ${get("targetId").slice(0, 8)}…`],
      ["adminId", `Admin: ${get("adminId").slice(0, 8)}…`],
    ] as const
  ).filter(([key]) => get(key));

  return (
    <>
      <PageHead
        title="Audit log"
        description="Append-only record of every privileged action taken in this console. Entries cannot be edited or deleted from anywhere in the product."
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            <Btn variant="outline" size="sm" onClick={reload} label="Refresh">
              <RotateCw className="size-3.5" aria-hidden="true" />
            </Btn>
          </>
        }
      />

      <MetricGrid cols={3}>
        <Metric label="Entries in period" value={full(data?.total)} loading={loading} />
        <Metric label="Distinct actions recorded" value={full(data?.actions.length)} loading={loading} />
        <Metric label="Admins who acted" value={full(data?.admins.length)} loading={loading} />
      </MetricGrid>

      <Section className="mt-6" title="Entries">
        <FilterBar>
          <SelectField
            label="Action"
            value={get("action")}
            onChange={(v) => set({ action: v })}
            options={[{ value: "", label: "Any action" }, ...(data?.actions ?? []).map((v) => ({ value: v, label: v.replace(/[._]/g, " ") }))]}
          />
          <SelectField
            label="Target type"
            value={get("targetType")}
            onChange={(v) => set({ targetType: v })}
            options={[{ value: "", label: "Any target" }, ...(data?.targetTypes ?? []).map((v) => ({ value: v, label: v.replace(/_/g, " ") }))]}
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
          onRowClick={(row) => setOpen(row)}
          empty={{
            title: chips.length ? "No entries match those filters" : "No privileged actions recorded yet",
            description: "Role changes, suspensions, plan edits, quota overrides and billing reconciliations are all written here.",
          }}
        />
        {data ? (
          <TableFooter page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => set({ page: p })} />
        ) : null}
      </Section>

      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} label="Audit entry">
        {open ? (
          <div className="thin-scroll flex-1 overflow-y-auto">
            <DialogHeader title={open.action.replace(/[._]/g, " ")} description={dateTime(open.created_at)} onClose={() => setOpen(null)} />
            <div className="space-y-4 px-4 py-4">
              <KeyValue
                items={[
                  { label: "Entry id", value: <Mono value={open.id} /> },
                  { label: "Admin", value: open.admin_email ?? "unknown" },
                  { label: "Admin id", value: <Mono value={open.admin_user_id} /> },
                  { label: "Target type", value: open.target_type },
                  { label: "Target id", value: <Mono value={open.target_id} /> },
                  { label: "Summary", value: open.summary ?? "—" },
                  { label: "IP address", value: <Mono value={open.ip} /> },
                ]}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["Before", open.before],
                    ["After", open.after],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-500">{label}</p>
                    <pre className="thin-scroll max-h-56 overflow-auto rounded bg-neutral-50 p-3 font-mono text-[10.5px] leading-5 text-ink-soft">
                      {value == null ? "—" : JSON.stringify(value, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>

              {open.metadata && Object.keys(open.metadata).length ? (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-500">Metadata</p>
                  <pre className="thin-scroll max-h-40 overflow-auto rounded bg-neutral-50 p-3 font-mono text-[10.5px] leading-5 text-ink-soft">
                    {JSON.stringify(open.metadata, null, 2)}
                  </pre>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-1.5">
                {targetHref(open) ? (
                  <Btn variant="outline" size="sm" onClick={() => navigate(targetHref(open)!)}>
                    Open target
                  </Btn>
                ) : null}
                {open.admin_user_id ? (
                  <Btn variant="ghost" size="sm" onClick={() => set({ adminId: open.admin_user_id })}>
                    Filter by this admin
                  </Btn>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
