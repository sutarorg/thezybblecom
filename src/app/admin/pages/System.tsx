/* ------------------------------------------------------------------ */
/* /admin/system — real health, or nothing                             */
/*                                                                     */
/* Every signal here is either measured (a live database round trip)   */
/* or counted from rows the product wrote. Services Zybble cannot      */
/* probe from this request are reported as "Unknown — not probed"      */
/* rather than given a comforting green tick.                          */
/* ------------------------------------------------------------------ */
import { useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  Caveat,
  DataTable,
  ErrorState,
  FilterSelect,
  Nothing,
  Panel,
  Stat,
  StatGrid,
  StatusBadge,
  formatDateTime,
  formatNumber,
  timeAgo,
  useFilters,
} from "../components";
import { arr, bool, num, obj, str } from "../shape";
import { Badge } from "../../components/ui";

function ConfigRow({ label, present, note }: { label: string; present: boolean; note?: string }) {
  return (
    <li className="flex items-center justify-between gap-2 border-b border-black/[0.04] py-1.5 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-xs text-ink-soft">{label}</p>
        {note ? <p className="truncate text-[10.5px] text-ink-mute">{note}</p> : null}
      </div>
      {present ? <Badge tone="green">Configured</Badge> : <Badge tone="amber">Not configured</Badge>}
    </li>
  );
}

export function AdminSystem({ identity }: { identity: AdminIdentity }) {
  const { get, set } = useFilters();
  const hours = get("hours", "24");

  const query = useAdminData<Record<string, unknown>>("system", { hours });

  const database = obj(query.data?.database);
  const health = obj(query.data?.health);
  const searches = obj(health.searches);
  const exportsHealth = obj(health.exports);
  const ai = obj(health.ai);
  const billing = obj(health.billing);
  const webhooks = obj(health.webhooks);
  const configuration = obj(query.data?.configuration);
  const razorpayPlans = obj(configuration.razorpayPlans);

  const status = str(database.status) || "unknown";

  return (
    <AdminLayout
      identity={identity}
      title="System"
      description="Measured health of the pieces this request can actually observe."
      aside={
        <FilterSelect
          label="Window"
          value={hours}
          width="w-[150px]"
          options={[
            { value: "1", label: "Last hour" },
            { value: "24", label: "Last 24 hours" },
            { value: "168", label: "Last 7 days" },
            { value: "720", label: "Last 30 days" },
          ]}
          onChange={(value) => set({ hours: value })}
        />
      }
    >
      {query.error ? (
        <ErrorState message={query.error} onRetry={query.refresh} />
      ) : (
        <div className="space-y-2.5">
          <StatGrid>
            <Stat
              label="Database"
              value={<StatusBadge value={status} />}
              hint={`${formatNumber(database.latencyMs)} ms round trip · checked ${timeAgo(database.checkedAt)}`}
              loading={query.initial}
            />
            <Stat
              label="Stuck searches"
              value={formatNumber(searches.stuck)}
              tone={num(searches.stuck) > 0 ? "danger" : "default"}
              hint="In a working state for over 30 minutes"
              loading={query.initial}
            />
            <Stat
              label="Unprocessed webhooks"
              value={formatNumber(webhooks.unprocessed)}
              tone={num(webhooks.unprocessed) > 0 ? "warn" : "default"}
              loading={query.initial}
            />
            <Stat
              label="Subscriptions needing attention"
              value={formatNumber(billing.past_due_subscriptions)}
              tone={num(billing.past_due_subscriptions) > 0 ? "warn" : "default"}
              hint="past_due, halted or pending"
              loading={query.initial}
            />
          </StatGrid>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Pipeline" description={`Counted since ${formatDateTime(query.data?.since)}`}>
              <ul className="space-y-1.5 text-xs">
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">Searches</span>
                  <span className="tabular-nums text-ink">
                    {formatNumber(searches.total)} total · {formatNumber(searches.failed)} failed ·{" "}
                    {formatNumber(searches.partial)} partial
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">In flight now</span>
                  <span className="tabular-nums text-ink">{formatNumber(searches.processing)}</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">Exports</span>
                  <span className="tabular-nums text-ink">
                    {formatNumber(exportsHealth.total)} total · {formatNumber(exportsHealth.failed)} failed
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">AI requests</span>
                  <span className="tabular-nums text-ink">
                    {formatNumber(ai.total)} total · {formatNumber(ai.failed)} failed
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">Payments</span>
                  <span className="tabular-nums text-ink">
                    {formatNumber(billing.payments)} total · {formatNumber(billing.failed_payments)} failed
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-ink-soft">Last activity</span>
                  <span className="text-ink">
                    search {timeAgo(searches.last_at)} · payment {timeAgo(billing.last_payment_at)}
                  </span>
                </li>
              </ul>
            </Panel>

            <Panel
              title="Server configuration"
              description="Whether the server has each credential — values are never sent to the browser"
            >
              <ul>
                <ConfigRow label="Supabase service key" present={bool(configuration.supabaseServiceKey)} note="Proven by this request succeeding" />
                <ConfigRow label="SerpApi" present={bool(configuration.serpApi)} note="Lead discovery" />
                <ConfigRow label="OpenRouter" present={bool(configuration.openRouter)} note="AI features" />
                <ConfigRow label="Resend" present={bool(configuration.resend)} note="Invitation email" />
                <ConfigRow label="Razorpay API" present={bool(configuration.razorpay)} note="Checkout and reconciliation" />
                <ConfigRow label="Razorpay webhook secret" present={bool(configuration.razorpayWebhookSecret)} />
                <ConfigRow label="Razorpay plan: growth" present={bool(razorpayPlans.growth)} />
                <ConfigRow label="Razorpay plan: agency" present={bool(razorpayPlans.agency)} />
                <ConfigRow label="Razorpay plan: scale" present={bool(razorpayPlans.scale)} />
                <ConfigRow label="APP_URL" present={bool(configuration.appUrl)} note="Used in invitation links" />
              </ul>
            </Panel>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Recent search failures">
              <DataTable
                columns={[
                  { key: "when", header: "When", render: (row) => formatDateTime(row.created_at) },
                  {
                    key: "error",
                    header: "Error",
                    render: (row) => (
                      <span className="text-[11px] text-red-600" title={str(row.error)}>
                        {str(row.error) || "No message recorded"}
                      </span>
                    ),
                  },
                ]}
                rows={arr(searches.recent_errors)}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[420px]"
                empty={<Nothing title="No search failures" description="Nothing failed in this window." />}
              />
            </Panel>
            <Panel title="Recent webhook failures">
              <DataTable
                columns={[
                  { key: "when", header: "When", render: (row) => formatDateTime(row.received_at) },
                  { key: "type", header: "Event", render: (row) => str(row.event_type) },
                  {
                    key: "error",
                    header: "Error",
                    render: (row) => (
                      <span className="text-[11px] text-red-600" title={str(row.error)}>
                        {str(row.error) || "No message recorded"}
                      </span>
                    ),
                  },
                ]}
                rows={arr(webhooks.recent_errors)}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[480px]"
                empty={<Nothing title="No webhook failures" description="Every event in this window was processed." />}
              />
            </Panel>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Recent AI failures">
              <DataTable
                columns={[
                  { key: "when", header: "When", render: (row) => formatDateTime(row.created_at) },
                  { key: "kind", header: "Kind", render: (row) => str(row.kind) },
                  {
                    key: "error",
                    header: "Error",
                    render: (row) => (
                      <span className="text-[11px] text-red-600" title={str(row.error)}>
                        {str(row.error) || "No message recorded"}
                      </span>
                    ),
                  },
                ]}
                rows={arr(ai.recent_errors)}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[480px]"
                empty={<Nothing title="No AI failures" />}
              />
            </Panel>
            <Panel title="Recent export failures">
              <DataTable
                columns={[
                  { key: "when", header: "When", render: (row) => formatDateTime(row.created_at) },
                  {
                    key: "error",
                    header: "Error",
                    render: (row) => (
                      <span className="text-[11px] text-red-600" title={str(row.error)}>
                        {str(row.error) || "No message recorded"}
                      </span>
                    ),
                  },
                ]}
                rows={arr(exportsHealth.recent_errors)}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[420px]"
                empty={<Nothing title="No export failures" />}
              />
            </Panel>
          </div>

          <Caveat>
            Only two things are measured live here: the database round trip (healthy under 1.5 s, degraded above it,
            failing if the query errors) and whether each server credential exists. SerpApi, OpenRouter, Resend and
            Razorpay are <strong>not</strong> pinged — doing so on every page load would cost money and rate limit, so
            their real condition is inferred from the failure counts above rather than claimed with a green tick.
          </Caveat>
        </div>
      )}
    </AdminLayout>
  );
}
