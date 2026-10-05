/* ------------------------------------------------------------------ */
/* /admin/billing — revenue and subscription operations                */
/*                                                                     */
/* Reads the same subscriptions / payments / invoices / webhook_events */
/* rows the product writes. Two different revenue numbers are shown    */
/* side by side and each is labelled for exactly what it is, because   */
/* "MRR" computed from subscription state alone is the single most     */
/* common way a SaaS dashboard lies to its operator.                   */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { adminPost, AdminRequestError, useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  ActionDialog,
  BarSeries,
  Caveat,
  CopyValue,
  CountChips,
  DataTable,
  DebouncedSearch,
  ErrorState,
  FilterSelect,
  LinkBtn,
  Nothing,
  PagerBar,
  Panel,
  RangeFilter,
  Stat,
  StatGrid,
  StatusBadge,
  formatDateTime,
  formatMoney,
  formatNumber,
  timeAgo,
  useFilters,
} from "../components";
import { arr, bool, counts, num, obj, str, type Row } from "../shape";
import { Btn, useToast } from "../../components/ui";

const KINDS = [
  { id: "payments", label: "Payments" },
  { id: "invoices", label: "Invoices" },
  { id: "subscriptions", label: "Subscriptions" },
] as const;

const STATUS_OPTIONS: Record<string, { value: string; label: string }[]> = {
  payments: [
    { value: "", label: "Any status" },
    { value: "captured", label: "Captured" },
    { value: "failed", label: "Failed" },
    { value: "refunded", label: "Refunded" },
  ],
  invoices: [
    { value: "", label: "Any status" },
    { value: "paid", label: "Paid" },
    { value: "failed", label: "Failed" },
    { value: "upcoming", label: "Upcoming" },
    { value: "refunded", label: "Refunded" },
  ],
  subscriptions: [
    { value: "", label: "Any status" },
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
  ],
};

export function AdminBilling({ identity }: { identity: AdminIdentity }) {
  const toast = useToast();
  const { get, set, page, setPage } = useFilters();
  const range = get("range", "30d");
  const kind = get("kind", "payments");

  const query = useAdminData<Row>("billing", {
    range,
    from: get("from"),
    to: get("to"),
    kind,
    status: get("status"),
    plan: get("plan"),
    q: get("q"),
    page,
    pageSize: 25,
  });

  const summary = obj(query.data?.summary);
  const subscriptions = obj(summary.subscriptions);
  const revenue = obj(summary.revenue);
  const payments = obj(summary.payments);
  const invoices = obj(summary.invoices);
  const records = obj(query.data?.records);
  const rows = arr(records.rows);
  const total = num(records.total);
  const currency = str(revenue.currency) || "USD";
  const paddleConfigured = bool(obj(query.data?.provider).paddleConfigured);

  const [syncTarget, setSyncTarget] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function reconcile(reason: string) {
    if (!syncTarget) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await adminPost<{ providerStatus: string; status: string }>("billing/sync", {
        userId: str(syncTarget.user_id),
        reason,
      });
      toast(`Paddle reports “${result.providerStatus || "unknown"}” — saved as ${result.status}.`, "success");
      setSyncTarget(null);
      query.refresh();
    } catch (caught) {
      setActionError(
        caught instanceof AdminRequestError ? caught.message : "The reconciliation couldn't complete. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const customerCell = (row: Row) => (
    <Link to={`/admin/users/${str(row.user_id)}`} className="min-w-0 hover:underline">
      <p className="truncate text-xs font-medium text-ink">{str(row.user_name) || "Unnamed"}</p>
      <p className="truncate text-[11px] text-ink-mute">{str(row.user_email)}</p>
    </Link>
  );

  const columns =
    kind === "invoices"
      ? [
          { key: "number", header: "Invoice", render: (row: Row) => str(row.number) || "—" },
          { key: "customer", header: "Customer", render: customerCell },
          { key: "status", header: "Status", render: (row: Row) => <StatusBadge value={row.status} /> },
          {
            key: "amount",
            header: "Amount",
            numeric: true,
            render: (row: Row) => formatMoney(row.amount_cents, str(row.currency) || currency),
          },
          { key: "at", header: "Issued", render: (row: Row) => formatDateTime(row.at) },
          {
            key: "provider",
            header: "Paddle id",
            render: (row: Row) => <CopyValue value={str(row.provider_id)} label="invoice id" />,
          },
        ]
      : kind === "subscriptions"
        ? [
            { key: "customer", header: "Customer", render: customerCell },
            { key: "plan", header: "Plan", render: (row: Row) => <StatusBadge value={row.plan_id} /> },
            { key: "status", header: "Status", render: (row: Row) => <StatusBadge value={row.status} /> },
            {
              key: "amount",
              header: "Plan price",
              numeric: true,
              render: (row: Row) => formatMoney(row.amount_cents, str(row.currency) || currency),
            },
            { key: "at", header: "Updated", render: (row: Row) => timeAgo(row.at) },
            {
              key: "provider",
              header: "Paddle id",
              render: (row: Row) => <CopyValue value={str(row.provider_id)} label="subscription id" />,
            },
            {
              key: "provider_kind",
              header: "Provider",
              render: (row: Row) =>
                str(row.billing_provider) ? <StatusBadge value={str(row.billing_provider)} /> : "—",
            },
            {
              key: "actions",
              header: "",
              render: (row: Row) =>
                str(row.provider_id) && str(row.billing_provider) === "paddle" && paddleConfigured ? (
                  <Btn variant="outline" size="sm" onClick={() => setSyncTarget(row)}>
                    <RefreshCw className="size-3" aria-hidden="true" />
                    Reconcile
                  </Btn>
                ) : null,
            },
          ]
        : [
            { key: "customer", header: "Customer", render: customerCell },
            { key: "status", header: "Status", render: (row: Row) => <StatusBadge value={row.status} /> },
            {
              key: "amount",
              header: "Amount",
              numeric: true,
              render: (row: Row) => formatMoney(row.amount_cents, str(row.currency) || currency),
            },
            { key: "method", header: "Method", render: (row: Row) => str(row.method) || "—" },
            { key: "at", header: "When", render: (row: Row) => formatDateTime(row.at) },
            {
              key: "provider",
              header: "Paddle id",
              render: (row: Row) => <CopyValue value={str(row.provider_id)} label="payment id" />,
            },
            {
              key: "txn",
              header: "Transaction",
              render: (row: Row) =>
                str(row.provider_transaction_id) ? (
                  <CopyValue value={str(row.provider_transaction_id)} label="transaction id" />
                ) : (
                  "—"
                ),
            },
          ];

  return (
    <AdminLayout
      identity={identity}
      title="Billing"
      description="Subscriptions, payments and invoices exactly as Paddle and the database recorded them."
      aside={<RangeFilter value={range} from={get("from")} to={get("to")} onChange={(patch) => set(patch as Record<string, string | null>)} />}
    >
      {query.error ? (
        <ErrorState message={query.error} onRetry={query.refresh} />
      ) : (
        <div className="space-y-2.5">
          <StatGrid>
            <Stat
              label="Committed MRR"
              value={formatMoney(revenue.committed_mrr_minor, currency)}
              hint={`${formatNumber(subscriptions.entitling)} entitling subscriptions × plan price`}
              tone="brand"
              loading={query.initial}
            />
            <Stat
              label="Collected in range"
              value={formatMoney(revenue.collected_minor, currency)}
              hint={`Lifetime ${formatMoney(revenue.collected_lifetime_minor, currency)}`}
              loading={query.initial}
            />
            <Stat
              label="Refunded in range"
              value={formatMoney(revenue.refunded_minor, currency)}
              tone={num(revenue.refunded_minor) > 0 ? "warn" : "default"}
              loading={query.initial}
            />
            <Stat
              label="Paid subscriptions"
              value={formatNumber(subscriptions.paid_active)}
              hint={`${formatNumber(subscriptions.cancel_at_cycle_end)} cancelling at cycle end`}
              loading={query.initial}
            />
          </StatGrid>

          <Caveat>
            Committed MRR = plan price × subscriptions in <strong>active</strong> or <strong>trialing</strong> state.
            Collected = captured payments in the window. They are different measures on purpose; neither is an accrual
            MRR, which Zybble can't derive because discounts and prorations aren't stored.
            {paddleConfigured ? "" : " Paddle credentials aren't configured on this deployment, so reconciliation is unavailable."}
          </Caveat>

          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel title="Collected per day" className="lg:col-span-2">
              <BarSeries
                points={arr(revenue.by_day).map((row) => ({
                  date: str(row.date),
                  value: num(row.collected_minor),
                }))}
                label="revenue"
                valueFormat={(value) => formatMoney(value, currency)}
              />
            </Panel>
            <Panel title="States" description="Counts by the exact stored status">
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-[11px] text-ink-mute">Subscriptions</p>
                  <CountChips counts={counts(subscriptions.by_status)} />
                </div>
                <div>
                  <p className="mb-1 text-[11px] text-ink-mute">
                    Payments in range ({formatNumber(payments.in_range)})
                  </p>
                  <CountChips counts={counts(payments.by_status)} />
                </div>
                <div>
                  <p className="mb-1 text-[11px] text-ink-mute">
                    Invoices in range ({formatNumber(invoices.in_range)})
                  </p>
                  <CountChips counts={counts(invoices.by_status)} />
                </div>
              </div>
            </Panel>
          </div>

          <Panel
            title="Records"
            description={
              get("q")
                ? "Searching by provider id or customer looks across all time, not just the selected range."
                : "Filtered and paginated in Postgres."
            }
            aside={
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="inline-flex rounded border border-black/[0.09] bg-white p-0.5">
                  {KINDS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={kind === option.id}
                      onClick={() => set({ kind: option.id, status: null })}
                      className={
                        kind === option.id
                          ? "h-6 rounded bg-ink px-2 text-[11px] font-medium text-white"
                          : "h-6 rounded px-2 text-[11px] font-medium text-ink-soft transition-colors hover:bg-black/[0.04]"
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <DebouncedSearch
                  value={get("q")}
                  placeholder="Provider id, email or name"
                  onChange={(value) => set({ q: value })}
                />
                <FilterSelect
                  label="Status"
                  value={get("status")}
                  options={STATUS_OPTIONS[kind] ?? STATUS_OPTIONS.payments}
                  onChange={(value) => set({ status: value })}
                  width="w-[140px]"
                />
                {kind === "subscriptions" ? (
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
                ) : null}
              </div>
            }
          >
            <DataTable
              columns={columns}
              rows={rows}
              loading={query.loading}
              rowKey={(row, index) => `${str(row.id)}-${index}`}
              minWidth="min-w-[860px]"
              empty={
                <Nothing
                  title={`No ${kind} found`}
                  description={
                    get("q") || get("status")
                      ? "Try a different filter, or widen the date range."
                      : "Records appear here as soon as the first payment is processed."
                  }
                />
              }
            />
            <PagerBar page={page} pageSize={num(records.pageSize) || 25} total={total} onPage={setPage} />
          </Panel>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Renewing in the next 30 days" description="Active and trialing subscriptions">
              <DataTable
                columns={[
                  { key: "customer", header: "Customer", render: customerCell },
                  { key: "plan", header: "Plan", render: (row) => <StatusBadge value={row.plan_id} /> },
                  { key: "renews", header: "Renews", render: (row) => formatDateTime(row.renews_at) },
                  {
                    key: "cancelling",
                    header: "Cancelling",
                    render: (row) => (bool(row.cancel_at_cycle_end) ? "At cycle end" : "No"),
                  },
                ]}
                rows={arr(summary.upcoming_renewals)}
                rowKey={(row) => str(row.user_id)}
                minWidth="min-w-[520px]"
                empty={<Nothing title="No renewals due" description="Nothing renews in the next 30 days." />}
              />
            </Panel>

            <Panel
              title="Recent provider events"
              description="Latest webhook_events rows"
              aside={
                <LinkBtn to="/admin/webhooks" variant="ghost">
                  Open webhooks
                </LinkBtn>
              }
            >
              <DataTable
                columns={[
                  { key: "type", header: "Event", render: (row) => str(row.event_type) },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  { key: "at", header: "Received", render: (row) => timeAgo(row.received_at) },
                  {
                    key: "error",
                    header: "Error",
                    render: (row) =>
                      str(row.error) ? (
                        <span className="text-[11px] text-red-600" title={str(row.error)}>
                          {str(row.error).slice(0, 40)}
                        </span>
                      ) : (
                        "—"
                      ),
                  },
                ]}
                rows={arr(summary.recent_webhooks)}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[520px]"
                empty={<Nothing title="No webhook events" description="Paddle hasn't delivered an event yet." />}
              />
            </Panel>
          </div>
        </div>
      )}

      <ActionDialog
        open={syncTarget !== null}
        onClose={() => setSyncTarget(null)}
        onConfirm={reconcile}
        busy={busy}
        error={actionError}
        title="Reconcile subscription with Paddle"
        description={
          syncTarget
            ? `Reads ${str(syncTarget.provider_id)} from Paddle and stores the provider's status and period. Nothing is charged, cancelled or created.`
            : undefined
        }
        confirmLabel="Reconcile now"
      />
    </AdminLayout>
  );
}
