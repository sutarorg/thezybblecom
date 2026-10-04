/* ------------------------------------------------------------------ */
/* /admin/billing — revenue and subscription operations.               */
/*                                                                     */
/* Reads the EXISTING billing tables (subscriptions, payments,         */
/* invoices, subscription_events). It does not create a second billing */
/* system and never mutates Razorpay: the only write action is a       */
/* reconciliation that pulls provider state INTO the database.         */
/* ------------------------------------------------------------------ */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCcw, RotateCw } from "lucide-react";
import { Btn, Card, ConfirmDialog, useToast } from "../../components/ui";
import { AdminApiError, adminPost, useAdminResource } from "../client";
import { useUrlFilters } from "./Users";
import {
  Chip,
  DataTable,
  Distribution,
  FilterBar,
  Metric,
  MetricGrid,
  Mono,
  PageHead,
  PeriodPicker,
  PlanBadge,
  SearchField,
  Section,
  SelectField,
  StatusBadge,
  TableFooter,
  ago,
  dateOnly,
  defaultPeriod,
  full,
  money,
  num,
  periodParams,
  type Column,
  type PeriodState,
} from "../ui";

type Owner = { name: string; email: string } | null;
type Paged<T> = { rows: T[]; page: number; pageSize: number; total: number; totalPages: number };

type Summary = {
  period: { from: string; to: string };
  business: {
    paid_active: number; by_status: Record<string, number>; by_plan: Record<string, number>;
    mrr_minor: number; currency: string; payments_count: number; payments_minor: number;
    failed_payments: number; refunds: number; cancellations: number; pending_cancel: number; renewals_30d: number;
  };
  renewals: { id: string; user_id: string; plan_id: string; status: string; current_period_end: string; razorpay_subscription_id: string | null; cancel_at_cycle_end: boolean }[];
  events: { id: number; user_id: string | null; event_type: string; razorpay_event_id: string | null; created_at: string }[];
};

type SubRow = {
  id: string; user_id: string; plan_id: string; status: string; currency: string;
  razorpay_subscription_id: string | null; razorpay_plan_id: string | null;
  current_period_start: string | null; current_period_end: string | null; charge_at: string | null;
  cancel_at_cycle_end: boolean; latest_payment_id: string | null; updated_at: string; owner: Owner;
};
type PaymentRow = {
  id: string; user_id: string | null; razorpay_payment_id: string | null; razorpay_subscription_id: string | null;
  amount_cents: number; currency: string; status: string; method: string | null; created_at: string; owner: Owner;
};
type InvoiceRow = {
  id: string; user_id: string; number: string; description: string; amount_cents: number; currency: string;
  status: string; razorpay_invoice_id: string | null; razorpay_payment_id: string | null; issued_at: string; owner: Owner;
};

const TABS = [
  { key: "summary", label: "Summary" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "payments", label: "Payments" },
  { key: "invoices", label: "Invoices" },
] as const;

const SUBSCRIPTION_STATUSES = [
  "created", "authenticated", "pending", "active", "trialing", "past_due",
  "cancelled", "paused", "halted", "failed", "expired", "completed",
];

export function AdminBilling({ view }: { view?: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { get, set, clearAll } = useUrlFilters();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [confirmSync, setConfirmSync] = useState<{ userId: string; label: string } | null>(null);
  const tab = (TABS.find((t) => t.key === view)?.key ?? "summary") as (typeof TABS)[number]["key"];

  const params = useMemo(
    () => ({
      ...periodParams(period),
      q: get("q"),
      status: get("status"),
      plan: get("plan"),
      page: get("page") || 1,
      pageSize: 25,
    }),
    [period, get],
  );

  const path = tab === "summary" ? "billing" : `billing/${tab}`;
  const { data, loading, error, reload } = useAdminResource<Summary & Paged<Record<string, unknown>>>(path, params);

  async function sync(userId: string) {
    setSyncing(userId);
    try {
      const result = await adminPost<{ subscription: { status: string }; audited?: boolean }>("billing", {
        action: "sync_subscription",
        userId,
      });
      toast(`Reconciled — the subscription is now "${result.subscription.status}".`, "success");
      reload();
    } catch (e) {
      toast(e instanceof AdminApiError ? e.message : "The reconciliation failed.", "error");
    } finally {
      setSyncing(null);
      setConfirmSync(null);
    }
  }

  const tabNav = (
    <div className="mb-4 flex min-w-0 gap-1 overflow-x-auto no-scrollbar border-b border-black/[0.07]">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => navigate(t.key === "summary" ? "/admin/billing" : `/admin/billing/${t.key}`)}
          aria-current={tab === t.key ? "page" : undefined}
          className={
            tab === t.key
              ? "-mb-px shrink-0 border-b-2 border-ink px-3 py-2 text-[12.5px] font-medium text-ink"
              : "-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-[12.5px] text-ink-mute transition-colors hover:text-ink"
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const head = (
    <PageHead
      title="Billing"
      description="Subscriptions, payments and invoices exactly as the Razorpay webhook recorded them."
      actions={
        <>
          <PeriodPicker value={period} onChange={setPeriod} />
          <Btn variant="outline" size="sm" onClick={reload} label="Refresh">
            <RotateCw className="size-3.5" aria-hidden="true" />
          </Btn>
        </>
      }
    />
  );

  /* ----------------------------- summary ---------------------------- */
  if (tab === "summary") {
    const b = data?.business;
    const currency = b?.currency || "INR";
    return (
      <>
        {head}
        {tabNav}
        <div className="space-y-6">
          <MetricGrid cols={5}>
            <Metric label="Active paid" value={full(b?.paid_active)} loading={loading} />
            <Metric label="MRR" value={money(b?.mrr_minor, currency)} tone="good" loading={loading} />
            <Metric label="Captured" value={money(b?.payments_minor, currency)} hint={`${full(b?.payments_count)} attempts`} loading={loading} />
            <Metric label="Failed payments" value={full(b?.failed_payments)} tone={num(b?.failed_payments) ? "bad" : "neutral"} loading={loading} />
            <Metric label="Refunds" value={full(b?.refunds)} loading={loading} />
          </MetricGrid>
          <MetricGrid cols={3}>
            <Metric label="Cancellations" value={full(b?.cancellations)} loading={loading} />
            <Metric label="Cancelling at cycle end" value={full(b?.pending_cancel)} loading={loading} />
            <Metric label="Renewals next 30d" value={full(b?.renewals_30d)} loading={loading} />
          </MetricGrid>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card className="min-w-0 p-4">
              <Section title="Status breakdown" description="Every subscription row by stored status.">
                <Distribution data={b?.by_status} emptyLabel="No subscriptions yet." renderLabel={(k) => <StatusBadge value={k} />} />
              </Section>
            </Card>
            <Card className="min-w-0 p-4">
              <Section title="Plan distribution" description="Active and trialing subscriptions.">
                <Distribution data={b?.by_plan} emptyLabel="No active subscriptions yet." renderLabel={(k) => <PlanBadge plan={k} />} />
              </Section>
            </Card>
          </div>

          <Section title="Upcoming renewals" description="Active subscriptions charging in the next 30 days.">
            <Card className="min-w-0 overflow-hidden">
              {data?.renewals?.length ? (
                <ul className="divide-y divide-black/[0.05] text-[12px]">
                  {data.renewals.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
                      <button type="button" onClick={() => navigate(`/admin/users/${r.user_id}`)} className="min-w-0 flex-1 truncate text-left text-ink hover:underline">
                        <Mono value={r.razorpay_subscription_id} />
                      </button>
                      <PlanBadge plan={r.plan_id} />
                      <StatusBadge value={r.status} />
                      {r.cancel_at_cycle_end ? <StatusBadge value="cancelled" /> : null}
                      <span className="shrink-0 text-[11px] text-ink-mute">{dateOnly(r.current_period_end)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-mute">
                  {loading ? "Loading…" : "No renewals scheduled in the next 30 days."}
                </p>
              )}
            </Card>
          </Section>

          <Section title="Recent billing events" description="subscription_events rows written by the signed Razorpay webhook.">
            <Card className="min-w-0 overflow-hidden">
              {data?.events?.length ? (
                <ul className="divide-y divide-black/[0.05] text-[12px]">
                  {data.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{e.event_type}</span>
                      <Mono value={e.razorpay_event_id} />
                      {e.user_id ? (
                        <button type="button" onClick={() => navigate(`/admin/users/${e.user_id}`)} className="shrink-0 text-[11px] text-brand-700 hover:underline">
                          customer
                        </button>
                      ) : null}
                      <span className="shrink-0 text-[11px] text-neutral-400">{ago(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-mute">
                  {loading ? "Loading…" : "No billing events recorded yet."}
                </p>
              )}
            </Card>
          </Section>
        </div>
      </>
    );
  }

  /* ---------------------------- list tabs --------------------------- */
  const chips = ([["q", `Search: ${get("q")}`], ["status", `Status: ${get("status")}`], ["plan", `Plan: ${get("plan")}`]] as const).filter(
    ([key]) => get(key),
  );

  const subColumns: Column<SubRow>[] = [
    {
      key: "customer",
      header: "Customer",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.owner?.name || row.owner?.email || "Unknown"}</p>
          <p className="truncate text-[11px] text-ink-mute">{row.owner?.email}</p>
        </div>
      ),
    },
    { key: "plan", header: "Plan", render: (row) => <PlanBadge plan={row.plan_id} /> },
    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
    { key: "rzp", header: "Razorpay subscription", hide: "md", render: (row) => <Mono value={row.razorpay_subscription_id} /> },
    { key: "period", header: "Period end", hide: "lg", render: (row) => <span className="text-[11.5px]">{dateOnly(row.current_period_end)}</span> },
    { key: "charge", header: "Next charge", hide: "lg", render: (row) => <span className="text-[11.5px]">{dateOnly(row.charge_at)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Btn
          variant="outline"
          size="sm"
          disabled={!row.razorpay_subscription_id || syncing === row.user_id}
          onClick={(e) => {
            e.stopPropagation();
            setConfirmSync({ userId: row.user_id, label: row.razorpay_subscription_id ?? row.id });
          }}
        >
          <RefreshCcw className="size-3.5" aria-hidden="true" />
          {syncing === row.user_id ? "Syncing…" : "Sync"}
        </Btn>
      ),
    },
  ];

  const paymentColumns: Column<PaymentRow>[] = [
    {
      key: "customer",
      header: "Customer",
      render: (row) => <span className="truncate text-ink">{row.owner?.email || row.owner?.name || "—"}</span>,
    },
    { key: "amount", header: "Amount", align: "right", render: (row) => money(row.amount_cents, row.currency) },
    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
    { key: "method", header: "Method", hide: "md", render: (row) => row.method ?? "—" },
    { key: "rzp", header: "Razorpay payment", hide: "md", render: (row) => <Mono value={row.razorpay_payment_id} /> },
    { key: "created", header: "When", align: "right", hide: "sm", render: (row) => <span className="whitespace-nowrap text-[11.5px] text-ink-mute">{ago(row.created_at)}</span> },
  ];

  const invoiceColumns: Column<InvoiceRow>[] = [
    { key: "number", header: "Invoice", render: (row) => <span className="font-medium text-ink">{row.number}</span> },
    { key: "customer", header: "Customer", hide: "sm", render: (row) => <span className="truncate">{row.owner?.email || "—"}</span> },
    { key: "amount", header: "Amount", align: "right", render: (row) => money(row.amount_cents, row.currency) },
    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
    { key: "rzp", header: "Razorpay invoice", hide: "lg", render: (row) => <Mono value={row.razorpay_invoice_id} /> },
    { key: "issued", header: "Issued", align: "right", hide: "sm", render: (row) => <span className="whitespace-nowrap text-[11.5px] text-ink-mute">{dateOnly(row.issued_at)}</span> },
  ];

  const statusOptions =
    tab === "subscriptions"
      ? [{ value: "", label: "Any status" }, ...SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))]
      : tab === "invoices"
        ? [{ value: "", label: "Any status" }, ...["paid", "failed", "upcoming", "refunded"].map((s) => ({ value: s, label: s }))]
        : [{ value: "", label: "Any status" }, ...["captured", "failed", "refunded", "authorized"].map((s) => ({ value: s, label: s }))];

  const rows = (data?.rows ?? []) as unknown[];

  return (
    <>
      {head}
      {tabNav}
      <FilterBar>
        <SearchField
          value={get("q")}
          onChange={(v) => set({ q: v })}
          placeholder={tab === "subscriptions" ? "Razorpay subscription or plan id" : tab === "payments" ? "Razorpay payment or subscription id" : "Invoice number or Razorpay id"}
        />
        <SelectField label="Status" value={get("status")} onChange={(v) => set({ status: v })} options={statusOptions} />
        {tab === "subscriptions" ? (
          <SelectField
            label="Plan"
            value={get("plan")}
            onChange={(v) => set({ plan: v })}
            options={[{ value: "", label: "All plans" }, ...["free", "growth", "agency", "scale"].map((p) => ({ value: p, label: p }))]}
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

      {tab === "subscriptions" ? (
        <DataTable
          columns={subColumns}
          rows={rows as SubRow[]}
          loading={loading}
          error={error}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/admin/users/${r.user_id}`)}
          empty={{ title: "No subscriptions match", description: "Subscriptions appear once a customer completes checkout." }}
        />
      ) : tab === "payments" ? (
        <DataTable
          columns={paymentColumns}
          rows={rows as PaymentRow[]}
          loading={loading}
          error={error}
          rowKey={(r) => r.id}
          onRowClick={(r) => (r.user_id ? navigate(`/admin/users/${r.user_id}`) : undefined)}
          empty={{ title: "No payments in this period", description: "Payments are written by the signed Razorpay webhook." }}
        />
      ) : (
        <DataTable
          columns={invoiceColumns}
          rows={rows as InvoiceRow[]}
          loading={loading}
          error={error}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/admin/users/${r.user_id}`)}
          empty={{ title: "No invoices in this period" }}
        />
      )}

      {data ? (
        <TableFooter page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => set({ page: p })} />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmSync)}
        onClose={() => setConfirmSync(null)}
        onConfirm={() => confirmSync && sync(confirmSync.userId)}
        title="Reconcile with Razorpay?"
        description={`Zybble will read ${confirmSync?.label ?? "this subscription"} from Razorpay and write the provider's status, period and next charge date into the database. Nothing is changed AT Razorpay. If the provider reports the subscription as cancelled, expired or failed, the customer drops to the Free plan immediately.`}
        confirmLabel="Reconcile"
      />
    </>
  );
}
