/* ------------------------------------------------------------------ */
/* /admin/webhooks — provider webhook delivery log.                    */
/*                                                                     */
/* webhook_events is written by the razorpay-webhook edge function     */
/* after HMAC verification. There is no replay button here: replay     */
/* would require re-posting a payload Zybble cannot re-sign, and a     */
/* button that only flipped `status` would be a lie. Recovery is       */
/* "Resend" from the Razorpay dashboard, plus the per-customer         */
/* reconcile action on /admin/billing.                                 */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import { Btn, Card, DialogHeader, Drawer } from "../../components/ui";
import { adminGet, useAdminResource } from "../client";
import { useUrlFilters } from "./Users";
import {
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
  SearchField,
  Section,
  SelectField,
  StatusBadge,
  TableFooter,
  ago,
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
  provider: string;
  event_id: string;
  event_type: string;
  status: string;
  error: string | null;
  attempts: number;
  received_at: string;
  processed_at: string | null;
};

type Response = {
  summary: {
    total: number;
    received: number;
    processed: number;
    failed: number;
    by_type: Record<string, number>;
    by_provider: Record<string, number>;
    last_received_at: string | null;
    last_processed_at: string | null;
    top_errors: { error: string; count: number }[];
  };
  rows: Row[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const STATUSES = ["received", "processed", "failed"];

export function AdminWebhooks() {
  const { get, set, clearAll } = useUrlFilters();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);
  const [open, setOpen] = useState<Row | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  // The list query never transfers payloads. One detail request is made only
  // when an operator actually opens a delivery.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPayload(null);
    setPayloadError(null);
    adminGet<{ event: { payload: unknown } }>(`webhooks/${open.id}`)
      .then((r) => !cancelled && setPayload(r.event?.payload ?? null))
      .catch((e: unknown) => !cancelled && setPayloadError(e instanceof Error ? e.message : "The payload couldn't be loaded."));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const params = useMemo(
    () => ({
      ...periodParams(period),
      status: get("status"),
      provider: get("provider"),
      type: get("eventType"),
      q: get("q"),
      page: get("page") || 1,
      pageSize: 25,
    }),
    [period, get],
  );
  const { data, loading, error, reload } = useAdminResource<Response>("webhooks", params);
  const s = data?.summary;

  const columns: Column<Row>[] = [
    { key: "event_type", header: "Event", render: (row) => <span className="truncate font-medium text-ink">{row.event_type}</span> },
    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
    { key: "provider", header: "Provider", hide: "md", render: (row) => row.provider },
    { key: "event_id", header: "Provider event id", hide: "lg", render: (row) => <Mono value={row.event_id} /> },
    { key: "attempts", header: "Attempts", align: "right", hide: "md", render: (row) => full(row.attempts) },
    {
      key: "error",
      header: "Error",
      hide: "lg",
      render: (row) => (row.error ? <span className="truncate text-red-600" title={row.error}>{row.error}</span> : <span className="text-neutral-300">—</span>),
    },
    { key: "received_at", header: "Received", align: "right", hide: "sm", render: (row) => <span className="whitespace-nowrap text-[11.5px] text-ink-mute">{ago(row.received_at)}</span> },
  ];

  const chips = (
    [
      ["q", `Search: ${get("q")}`],
      ["status", `Status: ${get("status")}`],
      ["provider", `Provider: ${get("provider")}`],
      ["eventType", `Type: ${get("eventType")}`],
    ] as const
  ).filter(([key]) => get(key));

  return (
    <>
      <PageHead
        title="Webhooks"
        description="Provider deliveries recorded after signature verification. Only verified events reach this table."
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
        <MetricGrid cols={4}>
          <Metric label="Deliveries" value={full(s?.total)} loading={loading} />
          <Metric label="Processed" value={full(s?.processed)} tone="good" loading={loading} />
          <Metric label="Failed" value={full(s?.failed)} tone={num(s?.failed) ? "bad" : "neutral"} loading={loading} />
          <Metric
            label="Awaiting processing"
            value={full(s?.received)}
            tone={num(s?.received) ? "warn" : "neutral"}
            hint={s?.last_received_at ? `last delivery ${ago(s.last_received_at)}` : undefined}
            loading={loading}
          />
        </MetricGrid>

        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          <Card className="min-w-0 p-4">
            <Section title="By event type">
              <Distribution data={s?.by_type} total={num(s?.total)} emptyLabel="No deliveries in this period." />
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="By provider">
              <Distribution data={s?.by_provider} total={num(s?.total)} emptyLabel="No deliveries in this period." />
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="Top errors">
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
                <p className="text-[11.5px] text-ink-mute">No webhook errors in this period.</p>
              )}
            </Section>
          </Card>
        </div>

        <Card className="min-w-0 border-l-2 border-l-black/[0.12] p-4">
          <Section title="Recovering a failed delivery">
            <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-5 text-ink-soft">
              <li>Open the delivery below and read the stored error and payload.</li>
              <li>
                If the fault was transient, use <span className="font-medium text-ink">Resend</span> in the Razorpay dashboard
                (Settings → Webhooks → Deliveries). Razorpay re-signs the payload, so the edge function accepts it.
              </li>
              <li>
                If only one customer is affected, use <span className="font-medium text-ink">Sync</span> on
                /admin/billing → Subscriptions, which reads that subscription back from Razorpay and corrects the database.
              </li>
            </ol>
            <p className="mt-2 text-[11.5px] text-ink-mute">
              Zybble deliberately has no replay button: it cannot forge a valid provider signature, and a button that only
              marked the row processed would hide a real failure.
            </p>
          </Section>
        </Card>

        <Section title="Deliveries">
          <FilterBar>
            <SearchField value={get("q")} onChange={(v) => set({ q: v })} placeholder="Event id or event type" />
            <SelectField label="Status" value={get("status")} onChange={(v) => set({ status: v })} options={[{ value: "", label: "Any status" }, ...STATUSES.map((v) => ({ value: v, label: v }))]} />
            <SelectField
              label="Type"
              value={get("eventType")}
              onChange={(v) => set({ eventType: v })}
              options={[{ value: "", label: "Any event" }, ...Object.keys(s?.by_type ?? {}).map((v) => ({ value: v, label: v }))]}
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
            empty={{ title: "No webhook deliveries match", description: "Razorpay posts here after each billing event." }}
          />
          {data ? (
            <TableFooter page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => set({ page: p })} />
          ) : null}
        </Section>
      </div>

      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} label="Webhook delivery">
        {open ? (
          <div className="thin-scroll flex-1 space-y-4 overflow-y-auto">
            <DialogHeader title={open.event_type} description={open.provider} onClose={() => setOpen(null)} />
            <div className="space-y-4 px-4 pb-4">
              <KeyValue
                items={[
                  { label: "Status", value: <StatusBadge value={open.status} /> },
                  { label: "Provider event id", value: <Mono value={open.event_id} /> },
                  { label: "Attempts", value: full(open.attempts) },
                  { label: "Received", value: dateTime(open.received_at) },
                  { label: "Processed", value: open.processed_at ? dateTime(open.processed_at) : "Not processed" },
                ]}
              />
              {open.error ? (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-red-700">Error</p>
                  <p className="mt-1 break-words text-[12px] leading-5 text-red-700">{open.error}</p>
                </div>
              ) : null}
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-500">Payload</p>
                <pre className="thin-scroll max-h-80 overflow-auto rounded bg-neutral-50 p-3 font-mono text-[10.5px] leading-5 text-ink-soft">
                  {payloadError ?? (payload == null ? "Loading…" : JSON.stringify(payload, null, 2))}
                </pre>
                <p className="mt-1 text-[11px] text-ink-mute">Signature, secret and token fields are redacted server-side.</p>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
