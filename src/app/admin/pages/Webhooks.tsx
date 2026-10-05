/* ------------------------------------------------------------------ */
/* /admin/webhooks — provider event operations                         */
/*                                                                     */
/* There is deliberately no "retry" button. The billing webhook       */
/* verifies Paddle's HMAC over the ORIGINAL raw body, and              */
/* webhook_events stores the parsed payload without the signature, so  */
/* a replay from here could never be authenticated — it would be a     */
/* fake button. What is offered instead is the genuinely safe action:  */
/* re-read the subscription from Paddle and reconcile it.              */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, X } from "lucide-react";
import { adminPost, AdminRequestError, useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  ActionDialog,
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
  formatMoney,
  formatNumber,
  timeAgo,
  useFilters,
} from "../components";
import { arr, bool, counts, num, obj, str, strings, type Row } from "../shape";
import { Badge, Btn, Drawer, IconBtn, useToast } from "../../components/ui";

function WebhookDrawer({
  id,
  onClose,
  onReconcile,
}: {
  id: string;
  onClose: () => void;
  onReconcile: (userId: string, subscriptionId: string) => void;
}) {
  const query = useAdminData<Row>(`webhooks/${id}`);
  const event = obj(query.data?.event);
  const subscription = obj(query.data?.subscription);
  const payment = obj(query.data?.payment);
  const customer = obj(query.data?.customer);

  return (
    <Drawer open onClose={onClose} label="Webhook event">
      <div className="flex items-start justify-between gap-3 border-b border-black/[0.05] px-4 py-3.5">
        <div className="min-w-0">
          <p className="font-display truncate text-sm font-semibold tracking-[-0.01em] text-ink">
            {str(event.event_type) || "Webhook event"}
          </p>
          <p className="truncate text-[11px] text-ink-mute">{str(event.event_id)}</p>
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
                { label: "Status", value: <StatusBadge value={event.status} /> },
                { label: "Provider", value: str(event.provider) },
                { label: "Attempts", value: formatNumber(event.attempts) },
                { label: "Received", value: formatDateTime(event.received_at) },
                { label: "Processed", value: formatDateTime(event.processed_at) },
                {
                  label: "Provider subscription",
                  value: <CopyValue value={str(event.subscription_id)} label="subscription id" />,
                },
                { label: "Provider payment", value: <CopyValue value={str(event.payment_id)} label="payment id" /> },
                {
                  label: "Payload amount",
                  value: event.amount_minor ? formatMoney(event.amount_minor, "INR") : "—",
                },
              ]}
            />

            {str(event.error) ? (
              <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-4 text-red-700">
                {str(event.error)}
              </p>
            ) : null}

            <div className="rounded border border-black/[0.06] px-2.5 py-2">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-400">
                Local records for these ids
              </p>
              {Object.keys(subscription).length ? (
                <p className="text-[11px] text-ink-soft">
                  Subscription: <StatusBadge value={subscription.status} /> on plan {str(subscription.plan_id)}, period
                  ends {formatDateTime(subscription.current_period_end)}
                </p>
              ) : (
                <p className="text-[11px] text-ink-mute">
                  No local subscription row matches the subscription id in this event.
                </p>
              )}
              {Object.keys(payment).length ? (
                <p className="mt-1 text-[11px] text-ink-soft">
                  Payment: <StatusBadge value={payment.status} />{" "}
                  {formatMoney(payment.amount_cents, str(payment.currency) || "INR")}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-ink-mute">No local payment row matches the payment id.</p>
              )}
              {customer.id ? (
                <p className="mt-1 text-[11px]">
                  Customer:{" "}
                  <Link to={`/admin/users/${str(customer.id)}`} className="text-ink hover:underline">
                    {str(customer.name) || str(customer.email)}
                  </Link>
                </p>
              ) : null}
            </div>

            {customer.id && str(event.subscription_id) ? (
              <Btn
                variant="outline"
                size="sm"
                onClick={() => onReconcile(str(customer.id), str(event.subscription_id))}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Reconcile this subscription with Paddle
              </Btn>
            ) : null}

            <Caveat>
              The raw provider payload isn't shown — Paddle payloads carry customer contact details, and everything
              operationally useful (ids, statuses, amount) is extracted above.
            </Caveat>
          </>
        )}
      </div>
    </Drawer>
  );
}

export function AdminWebhooks({ identity }: { identity: AdminIdentity }) {
  const toast = useToast();
  const { get, set, page, setPage } = useFilters();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reconcileUser, setReconcileUser] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const range = get("range");

  const query = useAdminData<Row>("webhooks", {
    q: get("q"),
    status: get("status"),
    eventType: get("eventType"),
    range: range || undefined,
    from: get("from"),
    to: get("to"),
    page,
    pageSize: 25,
  });

  const rows = arr(query.data?.rows);
  const total = num(query.data?.total);
  const provider = obj(query.data?.provider);

  async function reconcile(reason: string) {
    if (!reconcileUser) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await adminPost<{ providerStatus: string; status: string }>("billing/sync", {
        userId: reconcileUser,
        reason,
      });
      toast(`Paddle reports “${result.providerStatus || "unknown"}” — saved as ${result.status}.`, "success");
      setReconcileUser(null);
      query.refresh();
    } catch (caught) {
      setActionError(
        caught instanceof AdminRequestError ? caught.message : "The reconciliation couldn't complete. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout
      identity={identity}
      title="Webhooks"
      description="Provider events as received, with the local rows they were supposed to produce."
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
          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel title="Delivery status" className="lg:col-span-2">
              <CountChips counts={counts(query.data?.by_status)} />
              <p className="mt-2 text-[11px] text-ink-mute">
                Last event received {timeAgo(query.data?.last_received_at)}.
              </p>
            </Panel>
            <Panel title="Provider configuration">
              <ul className="space-y-1.5 text-xs">
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">Paddle API credentials</span>
                  {bool(provider.paddleConfigured) ? (
                    <Badge tone="green">Configured</Badge>
                  ) : (
                    <Badge tone="red">Missing</Badge>
                  )}
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">Webhook signing secret</span>
                  {bool(provider.webhookSecretConfigured) ? (
                    <Badge tone="green">Configured</Badge>
                  ) : (
                    <Badge tone="red">Missing</Badge>
                  )}
                </li>
              </ul>
            </Panel>
          </div>

          <Panel
            title={`${formatNumber(total)} events`}
            aside={
              <div className="flex flex-wrap items-center gap-1.5">
                <DebouncedSearch
                  value={get("q")}
                  placeholder="Event id or provider id"
                  onChange={(value) => set({ q: value })}
                />
                <FilterSelect
                  label="Status"
                  value={get("status")}
                  width="w-[135px]"
                  options={[
                    { value: "", label: "Any status" },
                    { value: "received", label: "Received" },
                    { value: "processed", label: "Processed" },
                    { value: "failed", label: "Failed" },
                  ]}
                  onChange={(value) => set({ status: value })}
                />
                <FilterSelect
                  label="Event type"
                  value={get("eventType")}
                  width="w-[185px]"
                  options={[
                    { value: "", label: "All event types" },
                    ...strings(query.data?.event_types).map((type) => ({ value: type, label: type })),
                  ]}
                  onChange={(value) => set({ eventType: value })}
                />
              </div>
            }
          >
            <DataTable
              columns={[
                { key: "type", header: "Event", render: (row) => str(row.event_type) },
                { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                { key: "attempts", header: "Attempts", numeric: true, render: (row) => formatNumber(row.attempts) },
                {
                  key: "subscription",
                  header: "Subscription id",
                  render: (row) => <CopyValue value={str(row.subscription_id)} label="subscription id" />,
                },
                {
                  key: "payment",
                  header: "Payment id",
                  render: (row) => <CopyValue value={str(row.payment_id)} label="payment id" />,
                },
                { key: "received", header: "Received", render: (row) => formatDateTime(row.received_at) },
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
              ]}
              rows={rows}
              loading={query.loading}
              rowKey={(row) => str(row.id)}
              onRowClick={(row) => setOpenId(str(row.id))}
              minWidth="min-w-[940px]"
              empty={
                <Nothing
                  title="No webhook events"
                  description="Paddle hasn't delivered an event matching these filters."
                />
              }
            />
            <PagerBar page={page} pageSize={num(query.data?.pageSize) || 25} total={total} onPage={setPage} />
          </Panel>

          <Caveat>
            Events can't be replayed from here. Paddle's signature is computed over the original request body, which
            isn't stored, so a replay could not be verified and would risk applying an unauthenticated change. When an
            event failed, open it and reconcile the subscription directly with the provider instead — that reads the
            truth from Paddle rather than trusting a stored payload.
          </Caveat>
        </div>
      )}

      {openId ? (
        <WebhookDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onReconcile={(userId) => {
            setOpenId(null);
            setActionError(null);
            setReconcileUser(userId);
          }}
        />
      ) : null}

      <ActionDialog
        open={reconcileUser !== null}
        onClose={() => setReconcileUser(null)}
        onConfirm={reconcile}
        busy={busy}
        error={actionError}
        title="Reconcile subscription with Paddle"
        description="Reads the subscription from Paddle and stores the provider's status and period. Nothing is charged or cancelled."
        confirmLabel="Reconcile now"
      />
    </AdminLayout>
  );
}
