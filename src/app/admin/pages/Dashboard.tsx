/* ------------------------------------------------------------------ */
/* /admin — operational dashboard.                                     */
/*                                                                     */
/* Every number on this page is a count produced by                    */
/* admin_overview_metrics() against production tables. Nothing is      */
/* estimated, interpolated, or hardcoded; when the database has no     */
/* rows the page shows zeroes and empty charts, which is the truth.    */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RotateCw } from "lucide-react";
import { Btn, Card } from "../../components/ui";
import { useAdminResource } from "../client";
import {
  BarSeries,
  Distribution,
  ErrorPanel,
  Metric,
  MetricGrid,
  PageHead,
  PeriodPicker,
  Section,
  StatusBadge,
  Unavailable,
  compact,
  dateTime,
  defaultPeriod,
  full,
  money,
  num,
  periodParams,
  type PeriodState,
} from "../ui";

type Overview = {
  period: { from: string; to: string; key: string };
  metrics: {
    customers: {
      total: number; new: number; active: number; suspended: number; admins: number;
      by_plan: Record<string, number>;
    };
    business: {
      paid_active: number; by_status: Record<string, number>; by_plan: Record<string, number>;
      mrr_minor: number; currency: string; payments_count: number; payments_minor: number;
      failed_payments: number; refunds: number; cancellations: number; pending_cancel: number;
      renewals_30d: number;
    };
    product: {
      searches_today: number; searches_7d: number; searches_30d: number; searches_period: number;
      leads_total: number; leads_period: number; lists_total: number; exports_period: number;
      workspaces: number; client_workspaces: number; active_workspaces: number;
    };
    operations: {
      failed_searches: number; partial_searches: number; running_jobs: number; failed_exports: number;
      ai_requests: number; failed_ai: number; webhooks: number; failed_webhooks: number;
      unprocessed_webhooks: number; exhausted_workspaces: number;
    };
  };
  series: Record<string, string | number>[];
};

const PLAN_ORDER = ["free", "growth", "agency", "scale"];

export function AdminDashboard() {
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAdminResource<Overview>("overview", periodParams(period));

  if (error) return <ErrorPanel message={error} onRetry={reload} />;

  const m = data?.metrics;
  const customers = m?.customers;
  const business = m?.business;
  const product = m?.product;
  const ops = m?.operations;
  const currency = business?.currency || "INR";

  return (
    <>
      <PageHead
        title="Operations overview"
        description="Live counts from the production database for the selected period."
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
        <Section title="Customers" description="Accounts and their effective entitlements.">
          <MetricGrid cols={5}>
            <Metric label="Total users" value={full(customers?.total)} loading={loading} onClick={() => navigate("/admin/users")} />
            <Metric label="New this period" value={full(customers?.new)} loading={loading} />
            <Metric
              label="Active this period"
              value={full(customers?.active)}
              hint="Ran a search, export or AI request"
              loading={loading}
            />
            <Metric
              label="Suspended"
              value={full(customers?.suspended)}
              tone={num(customers?.suspended) > 0 ? "warn" : "neutral"}
              loading={loading}
              onClick={() => navigate("/admin/users?status=suspended")}
            />
            <Metric label="Admins" value={full(customers?.admins)} loading={loading} onClick={() => navigate("/admin/settings")} />
          </MetricGrid>
          <MetricGrid cols={4}>
            {PLAN_ORDER.map((plan) => (
              <Metric
                key={plan}
                label={`${plan[0]!.toUpperCase()}${plan.slice(1)} users`}
                value={full(customers?.by_plan?.[plan] ?? 0)}
                loading={loading}
                onClick={() => navigate(`/admin/users?plan=${plan}`)}
              />
            ))}
          </MetricGrid>
        </Section>

        <Section title="Revenue" description="Derived from the subscriptions, payments and invoices tables.">
          <MetricGrid cols={5}>
            <Metric
              label="Active paid subs"
              value={full(business?.paid_active)}
              loading={loading}
              onClick={() => navigate("/admin/billing")}
            />
            <Metric
              label="MRR"
              value={money(business?.mrr_minor, currency)}
              hint="Σ plan price of active + trialing subscriptions"
              tone="good"
              loading={loading}
            />
            <Metric
              label="Captured this period"
              value={money(business?.payments_minor, currency)}
              hint={`${full(business?.payments_count)} payment attempt(s)`}
              loading={loading}
            />
            <Metric
              label="Failed payments"
              value={full(business?.failed_payments)}
              tone={num(business?.failed_payments) > 0 ? "bad" : "neutral"}
              loading={loading}
              onClick={() => navigate("/admin/billing/payments?status=failed")}
            />
            <Metric label="Refunds" value={full(business?.refunds)} loading={loading} />
          </MetricGrid>
          <MetricGrid cols={4}>
            <Metric label="Cancellations" value={full(business?.cancellations)} loading={loading} />
            <Metric label="Cancelling at cycle end" value={full(business?.pending_cancel)} loading={loading} />
            <Metric label="Renewals next 30 days" value={full(business?.renewals_30d)} loading={loading} />
            {/* ARR is deliberately omitted: every plan in `plans` is billed
                monthly, so an annualised figure would be an extrapolation
                rather than a measurement. */}
            <Unavailable
              label="ARR"
              reason="Only monthly plans exist, so ARR would be an extrapolation rather than recorded revenue."
            />
          </MetricGrid>
        </Section>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Card className="min-w-0 p-4">
            <Section title="Signups" description="New profiles per day in the selected period.">
              {loading ? (
                <div className="h-[120px] animate-pulse rounded bg-black/[0.04]" />
              ) : (
                <BarSeries
                  points={data?.series ?? []}
                  keys={[{ key: "signups", label: "Signups", className: "bg-brand-600" }]}
                  emptyLabel="No signups in this period."
                />
              )}
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="Search volume" description="Searches started per day, with failures overlaid.">
              {loading ? (
                <div className="h-[120px] animate-pulse rounded bg-black/[0.04]" />
              ) : (
                <BarSeries
                  points={data?.series ?? []}
                  keys={[
                    { key: "searches", label: "Searches", className: "bg-ink/70" },
                    { key: "failedSearches", label: "Failed", className: "bg-red-500" },
                  ]}
                  emptyLabel="No searches in this period."
                />
              )}
            </Section>
          </Card>
        </div>

        <Section title="Product" description="What customers are actually doing.">
          <MetricGrid cols={5}>
            <Metric label="Searches today" value={full(product?.searches_today)} loading={loading} />
            <Metric label="Searches 7d" value={full(product?.searches_7d)} loading={loading} />
            <Metric label="Searches 30d" value={full(product?.searches_30d)} loading={loading} />
            <Metric label="Leads discovered" value={compact(product?.leads_total)} hint={`${full(product?.leads_period)} this period`} loading={loading} onClick={() => navigate("/admin/leads")} />
            <Metric label="Exports this period" value={full(product?.exports_period)} loading={loading} />
          </MetricGrid>
          <MetricGrid cols={4}>
            <Metric label="Workspaces" value={full(product?.workspaces)} loading={loading} onClick={() => navigate("/admin/workspaces")} />
            <Metric label="Client workspaces" value={full(product?.client_workspaces)} loading={loading} onClick={() => navigate("/admin/workspaces?client=client")} />
            <Metric label="Active workspaces" value={full(product?.active_workspaces)} hint="Ran ≥1 search this period" loading={loading} />
            <Metric label="Saved lists" value={full(product?.lists_total)} loading={loading} />
          </MetricGrid>
        </Section>

        <Section title="Operations" description="Failures and in-flight work. Anything non-zero here deserves a look.">
          <MetricGrid cols={5}>
            <Metric
              label="Failed searches"
              value={full(ops?.failed_searches)}
              tone={num(ops?.failed_searches) > 0 ? "bad" : "good"}
              loading={loading}
              onClick={() => navigate("/admin/searches?view=failed")}
            />
            <Metric label="Partial searches" value={full(ops?.partial_searches)} tone={num(ops?.partial_searches) > 0 ? "warn" : "neutral"} loading={loading} />
            <Metric
              label="Jobs running"
              value={full(ops?.running_jobs)}
              loading={loading}
              onClick={() => navigate("/admin/searches?view=processing")}
            />
            <Metric label="Failed exports" value={full(ops?.failed_exports)} tone={num(ops?.failed_exports) > 0 ? "bad" : "good"} loading={loading} />
            <Metric
              label="Failed AI requests"
              value={full(ops?.failed_ai)}
              hint={`of ${full(ops?.ai_requests)} total`}
              tone={num(ops?.failed_ai) > 0 ? "bad" : "good"}
              loading={loading}
              onClick={() => navigate("/admin/ai?status=failed")}
            />
          </MetricGrid>
          <MetricGrid cols={4}>
            <Metric
              label="Failed webhooks"
              value={full(ops?.failed_webhooks)}
              hint={`of ${full(ops?.webhooks)} received`}
              tone={num(ops?.failed_webhooks) > 0 ? "bad" : "good"}
              loading={loading}
              onClick={() => navigate("/admin/webhooks?status=failed")}
            />
            <Metric
              label="Unprocessed webhooks"
              value={full(ops?.unprocessed_webhooks)}
              tone={num(ops?.unprocessed_webhooks) > 0 ? "warn" : "good"}
              loading={loading}
            />
            <Metric
              label="Workspaces at quota"
              value={full(ops?.exhausted_workspaces)}
              tone={num(ops?.exhausted_workspaces) > 0 ? "warn" : "neutral"}
              loading={loading}
              onClick={() => navigate("/admin/usage?view=exhausted")}
            />
            <Metric label="Recent payment failures" value={full(business?.failed_payments)} tone={num(business?.failed_payments) > 0 ? "bad" : "good"} loading={loading} />
          </MetricGrid>
        </Section>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Card className="min-w-0 p-4">
            <Section title="Subscription status" description="Every subscription row by its stored status.">
              <Distribution
                data={business?.by_status}
                emptyLabel="No subscriptions recorded yet."
                renderLabel={(key) => <StatusBadge value={key} />}
              />
            </Section>
          </Card>
          <Card className="min-w-0 p-4">
            <Section title="Paying plan distribution" description="Active and trialing subscriptions by plan.">
              <Distribution data={business?.by_plan} emptyLabel="No active subscriptions yet." />
            </Section>
          </Card>
        </div>

        {data ? (
          <p className="text-[11px] text-neutral-400">
            Window: {dateTime(data.period.from)} → {dateTime(data.period.to)}
          </p>
        ) : null}
      </div>
    </>
  );
}
