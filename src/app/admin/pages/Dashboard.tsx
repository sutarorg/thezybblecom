/* ------------------------------------------------------------------ */
/* /admin — operational dashboard                                      */
/*                                                                     */
/* Everything on this page is a count or a sum taken from production   */
/* tables for the selected window. Where a figure would be a guess     */
/* (notably true accrual MRR) the label says exactly what it is.       */
/* ------------------------------------------------------------------ */
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  BarSeries,
  Caveat,
  CountChips,
  DistributionBar,
  ErrorState,
  formatMoney,
  formatNumber,
  Panel,
  RangeFilter,
  Stat,
  StatGrid,
  useFilters,
  type SeriesPoint,
} from "../components";
import { arr, counts, num, obj, str } from "../shape";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  growth: "Growth",
  agency: "Agency",
  scale: "Scale",
};

export function AdminDashboard({ identity }: { identity: AdminIdentity }) {
  const { get, set } = useFilters();
  const range = get("range", "30d");
  const from = get("from");
  const to = get("to");

  const query = useAdminData<Record<string, unknown>>("overview", { range, from, to });
  const metrics = obj(query.data?.metrics);
  const users = obj(metrics.users);
  const billing = obj(metrics.billing);
  const product = obj(metrics.product);
  const operations = obj(metrics.operations);
  const series = arr(query.data?.series);
  const currency = str(billing.currency) || "INR";

  const points = (key: string): SeriesPoint[] =>
    series.map((row) => ({ date: str(row.date), value: num(row[key]) }));

  const alerts = [
    { label: "Failed searches", value: num(operations.failed_searches), to: "/admin/searches?status=failed_only" },
    { label: "Stuck jobs (>30 min)", value: num(operations.jobs_stuck), to: "/admin/system" },
    { label: "Unprocessed webhooks", value: num(operations.unprocessed_webhooks), to: "/admin/webhooks?status=received" },
    { label: "Failed webhooks", value: num(operations.failed_webhooks), to: "/admin/webhooks?status=failed" },
    { label: "Failed payments (7d)", value: num(operations.failed_payments_recent), to: "/admin/billing?status=failed" },
    { label: "Failed AI requests", value: num(operations.failed_ai), to: "/admin/ai" },
    { label: "Failed exports", value: num(operations.failed_exports), to: "/admin/system" },
  ];

  const planCounts = counts(users.by_plan);

  return (
    <AdminLayout
      identity={identity}
      title="Dashboard"
      description="Live operating picture for every Zybble tenant. Counts are taken from production tables for the selected window."
      aside={
        <RangeFilter
          value={range}
          from={from}
          to={to}
          onChange={(patch) => set(patch as Record<string, string | null>)}
        />
      }
    >
      {query.error ? (
        <ErrorState message={query.error} onRetry={query.refresh} />
      ) : (
        <div className="space-y-5">
          {/* Customers ------------------------------------------------ */}
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Customers</h2>
            <StatGrid>
              <Stat label="Total users" value={formatNumber(users.total)} loading={query.initial} />
              <Stat label="New in range" value={formatNumber(users.new)} loading={query.initial} />
              <Stat
                label="Active in range"
                value={formatNumber(users.active)}
                hint="Ran a search, export or AI request, or had a live session"
                loading={query.initial}
              />
              <Stat label="Administrators" value={formatNumber(users.admins)} loading={query.initial} />
            </StatGrid>
          </section>

          {/* Revenue --------------------------------------------------- */}
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Revenue</h2>
            <StatGrid>
              <Stat
                label="Committed MRR"
                value={formatMoney(billing.committed_mrr_minor, currency)}
                hint="Plan price × active and trialing subscriptions"
                tone="brand"
                loading={query.initial}
              />
              <Stat
                label="Collected in range"
                value={formatMoney(billing.collected_minor, currency)}
                hint={`${formatNumber(billing.payments)} payment records`}
                loading={query.initial}
              />
              <Stat
                label="Paid subscriptions"
                value={formatNumber(billing.active_paid_subscriptions)}
                hint={`${formatNumber(billing.upcoming_renewals)} renew in 30 days`}
                loading={query.initial}
              />
              <Stat
                label="Failed payments"
                value={formatNumber(billing.failed_payments)}
                tone={num(billing.failed_payments) > 0 ? "warn" : "default"}
                hint={`${formatNumber(billing.refunded)} refunded · ${formatMoney(billing.refunded_minor, currency)}`}
                loading={query.initial}
              />
            </StatGrid>
            <div className="mt-2.5 grid gap-2.5 lg:grid-cols-3">
              <Panel title="Collected per day" className="lg:col-span-2">
                <BarSeries
                  points={points("collected_minor")}
                  label="revenue"
                  valueFormat={(value) => formatMoney(value, currency)}
                />
              </Panel>
              <Panel title="Subscription states" description="Exact statuses stored on subscriptions">
                <CountChips counts={counts(billing.by_status)} />
                <div className="mt-3 space-y-1 border-t border-black/[0.05] pt-3 text-[11px] text-ink-mute">
                  <p>
                    Cancelling at cycle end:{" "}
                    <span className="font-medium text-ink">{formatNumber(billing.pending_cancellations)}</span>
                  </p>
                  <p>
                    Customers who have ever paid:{" "}
                    <span className="font-medium text-ink">{formatNumber(billing.paying_customers)}</span>
                  </p>
                </div>
              </Panel>
            </div>
            <div className="mt-2.5">
              <Caveat>
                Committed MRR is the recurring value of currently entitling subscriptions, not recognised revenue.
                “Collected” is the sum of captured payments in the window. Accrual MRR, expansion and churn movements
                aren't shown because Zybble doesn't store the proration or discount data they'd need.
              </Caveat>
            </div>
          </section>

          {/* Product --------------------------------------------------- */}
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Product</h2>
            <StatGrid>
              <Stat
                label="Searches in range"
                value={formatNumber(product.searches_range)}
                hint={`${formatNumber(product.searches_today)} today · ${formatNumber(product.searches_week)} this week`}
                loading={query.initial}
              />
              <Stat
                label="Leads discovered"
                value={formatNumber(product.leads_discovered)}
                hint={`${formatNumber(product.leads_total)} stored in total`}
                loading={query.initial}
              />
              <Stat
                label="Active workspaces"
                value={formatNumber(product.workspaces_active)}
                hint={`${formatNumber(product.workspaces_total)} total · ${formatNumber(product.client_workspaces)} client`}
                loading={query.initial}
              />
              <Stat
                label="Exports / AI runs"
                value={`${formatNumber(product.exports)} / ${formatNumber(product.ai_requests)}`}
                loading={query.initial}
              />
            </StatGrid>
            <div className="mt-2.5 grid gap-2.5 lg:grid-cols-3">
              <Panel title="Searches per day" className="lg:col-span-2">
                <BarSeries points={points("searches")} label="searches" />
              </Panel>
              <Panel title="Plan distribution" description="Effective plan, resolved the same way the app resolves it">
                <DistributionBar
                  items={Object.entries(planCounts).map(([plan, value]) => ({
                    label: PLAN_LABELS[plan] ?? plan,
                    value: num(value),
                  }))}
                />
              </Panel>
              <Panel title="Signups per day">
                <BarSeries points={points("signups")} label="signups" />
              </Panel>
              <Panel title="Leads discovered per day" className="lg:col-span-2">
                <BarSeries points={points("leads")} label="leads" />
              </Panel>
            </div>
          </section>

          {/* Operations ------------------------------------------------ */}
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Operations</h2>
            <Panel
              title="Needs attention"
              description="Only real failures are listed. A zero means the database has nothing in that state."
            >
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {alerts.map((alert) => (
                  <li key={alert.label}>
                    <Link
                      to={alert.to}
                      className="flex items-center justify-between gap-2 rounded border border-black/[0.06] px-2.5 py-2 transition-colors hover:border-black/[0.14] hover:bg-black/[0.015]"
                    >
                      <span className="text-xs text-ink-soft">{alert.label}</span>
                      <span className="flex items-center gap-1">
                        <span
                          className={
                            alert.value > 0
                              ? "text-[13px] font-semibold tabular-nums text-amber-700"
                              : "text-[13px] font-semibold tabular-nums text-ink"
                          }
                        >
                          {formatNumber(alert.value)}
                        </span>
                        <ArrowUpRight className="size-3 text-neutral-300" aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-4 border-t border-black/[0.05] pt-3 text-[11px] text-ink-mute">
                <span>
                  Jobs running: <span className="font-medium text-ink">{formatNumber(operations.jobs_running)}</span>
                </span>
                <span>
                  Searches in flight:{" "}
                  <span className="font-medium text-ink">{formatNumber(operations.searches_processing)}</span>
                </span>
                <span>
                  Partial searches:{" "}
                  <span className="font-medium text-ink">{formatNumber(operations.partial_searches)}</span>
                </span>
              </div>
            </Panel>
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
