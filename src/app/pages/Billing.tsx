/* ------------------------------------------------------------------ */
/* Zybble app — Billing (Paddle Billing; entitlement comes from the    */
/* server only).                                                       */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import {
  Badge,
  Btn,
  Card,
  ConfirmDialog,
  EmptyState,
  MetaText,
  SectionTitle,
  formatDate,
  useToast,
} from "../components/ui";
import { BillingInvoicesSkeleton, BillingSummarySkeleton } from "../components/skeletons";
import { PLANS } from "../../lib/site";
import { nextPlan, planFromId } from "../data/plans";
import { useAppSeo } from "../hooks";
import {
  cancelSubscription,
  completeCheckout,
  getBilling,
  getUsage,
  startCheckout,
  syncBilling,
  upgradePlan,
  type BillingState,
  type UsageData,
} from "../services/api";
import { openPaddleCheckout } from "../services/paddle";
import { formatDollars, formatMoney, LIST_CURRENCY } from "../lib/money";
import { useWorkspaceContext } from "../services/hooks";

/** Usage-bar states: normal, warning (≥80%), critical (≥90%), blocked (100%). */
function usageTone(pct: number) {
  if (pct >= 100) return { bar: "bg-red-500", text: "text-red-600" };
  if (pct >= 90) return { bar: "bg-orange-500", text: "text-orange-600" };
  if (pct >= 80) return { bar: "bg-amber-500", text: "text-amber-600" };
  return { bar: "bg-brand-600", text: "text-ink" };
}

export function BillingPage() {
  useAppSeo("Billing — Zybble", "Your plan, usage, and invoices.", "/billing");
  const toast = useToast();
  const { workspace, planId, loading: ctxLoading, refresh } = useWorkspaceContext();

  const [billing, setBilling] = useState<BillingState | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(() => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    setSyncWarning(null);
    syncBilling()
      .then((sync) => {
        // A failed refresh must never block the page — the tables below still
        // reflect the last known-good state — but it also must not be hidden:
        // surface a soft, non-blocking notice instead of silently presenting
        // potentially stale data as if it were just confirmed.
        if (!sync.ok && sync.error) setSyncWarning(sync.error);
        return Promise.all([getBilling(workspace.id), getUsage(workspace.id, planId)]);
      })
      .then(([b, u]) => {
        setBilling(b);
        setUsage(u);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace, planId]);

  useEffect(() => {
    if (!ctxLoading && !workspace) setLoading(false);
    load();
  }, [load, ctxLoading, workspace]);

  const busy = loading || ctxLoading;
  const currentPlanId = billing?.planId ?? planId;
  const plan = planFromId(currentPlanId);
  const target = nextPlan(currentPlanId);
  const usageAllowance = usage?.allowance ?? plan.leadAllowance;
  const usageUsed = usage?.used ?? 0;
  const pct = usageAllowance > 0 ? Math.round((usageUsed / usageAllowance) * 100) : 0;
  const tone = usageTone(pct);
  /* An existing Paddle subscription upgrades in place; a Free user opens a
     first checkout. past_due can't upgrade until the payment recovers. */
  const hasActiveSubscription =
    billing?.status === "active" || billing?.status === "trialing";

  /**
   * Upgrade — exactly one plan at a time, via Paddle.
   *
   * FIRST subscription (Free → Growth):
   *   1. the server validates the ladder and returns the PUBLIC price id, a
   *      server-generated checkout token and its Paddle environment;
   *   2. Paddle Checkout opens as an overlay on this page (Paddle.js with the
   *      public client-side token — no server credential is in the browser);
   *   3. on completion the browser hands the transaction id back to the
   *      SERVER, which re-reads it from Paddle and applies the entitlement.
   *
   * Upgrade (Growth → Agency → Scale):
   *   the server PATCHes the EXISTING Paddle subscription to the next plan's
   *   price — prorated immediately, and refused entirely when the payment
   *   fails, so a failed charge never changes the plan.
   *
   * Dismissal and failure leave the current plan untouched and simply allow a
   * retry — nothing is ever granted from a browser callback alone.
   */
  const onUpgrade = async () => {
    if (!target) return;
    setSwitching(target);

    if (hasActiveSubscription) {
      const upgraded = await upgradePlan(target);
      setSwitching(null);
      if (upgraded.error) {
        toast(upgraded.error, "error");
        load();
        return;
      }
      toast(`Upgrade confirmed — you're on the ${planFromId(upgraded.planId ?? target).label} plan. The difference is prorated on this cycle's bill.`);
      refresh();
      load();
      return;
    }

    const { intent, error: checkoutError } = await startCheckout(target);
    if (checkoutError || !intent) {
      setSwitching(null);
      toast(checkoutError ?? "Checkout couldn't start right now.", "error");
      return;
    }

    const outcome = await openPaddleCheckout({
      priceId: intent.priceId,
      customerEmail: intent.customerEmail,
      checkoutToken: intent.checkoutToken,
      environment: intent.environment,
    });

    if (outcome.status === "closed") {
      setSwitching(null);
      toast("Checkout closed — your plan hasn't changed. You can try again anytime.", "info");
      return;
    }
    if (outcome.status === "error") {
      setSwitching(null);
      toast(outcome.message, "error");
      return;
    }

    /* Completed ≠ granted: the server verifies with Paddle before any plan
       change is stored. */
    const verified = await completeCheckout(outcome.transactionId);
    setSwitching(null);
    if (verified.error) {
      toast(verified.error, "error");
      load();
      return;
    }
    toast(`Payment confirmed — you're on the ${planFromId(verified.planId ?? target).label} plan.`);
    // Plan, seats, allowances and client-workspace entitlement all follow the
    // refreshed server state; no sign-out/sign-in required.
    refresh();
    load();
  };

  return (
    <AppLayout title="Billing" description="Your subscription, usage, and payment history." wide>
      {error ? (
        <Card className="mb-3 flex items-start gap-3 p-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-red-50 text-red-600">
            <TriangleAlert className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[13px] font-medium text-ink">We couldn't load your billing details</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-mute">{error}</p>
            <Btn variant="outline" size="sm" className="mt-3" onClick={load}>
              Try again
            </Btn>
          </div>
        </Card>
      ) : null}

      {!error && syncWarning ? (
        <Card className="mb-3 flex items-start gap-3 border-amber-200 bg-amber-50/60 p-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-amber-100 text-amber-700">
            <TriangleAlert className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[13px] font-medium text-ink">Showing your last known billing status</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-mute">{syncWarning}</p>
            <Btn variant="outline" size="sm" className="mt-3" onClick={load}>
              Try again
            </Btn>
          </div>
        </Card>
      ) : null}

      {busy ? (
        <BillingSummarySkeleton />
      ) : (
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-lg bg-brand-600 text-white">
                    <CreditCard className="size-4.5" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold tracking-[-0.02em] text-ink">
                        {plan.label} plan
                      </h2>
                      <Badge tone={billing?.status === "active" ? "green" : billing?.status === "past_due" ? "red" : "amber"}>
                        {billing?.status === "active" ? (
                          <CheckCircle2 className="size-2.5" aria-hidden="true" />
                        ) : null}
                        {billing?.status ?? "active"}
                      </Badge>
                      {billing?.cancelAtCycleEnd ? (
                        <Badge tone="amber">
                          <Clock className="size-2.5" aria-hidden="true" />
                          Cancels {billing.renewalDate ?? "at period end"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-mute">
                      {plan.id === "free"
                        ? "No renewal — free forever"
                        : `${formatMoney(plan.priceCents, LIST_CURRENCY)}/month · billed monthly through Paddle`}
                    </p>
                  </div>
                </div>
                {plan.id !== "free" ? (
                  billing?.cancelAtCycleEnd ? (
                    <Badge tone="neutral">Cancellation scheduled</Badge>
                  ) : (
                    <Btn variant="outline" size="sm" onClick={() => setConfirmCancel(true)}>
                      Cancel subscription
                    </Btn>
                  )
                ) : null}
              </div>

              <div className="mt-4 grid gap-4 border-t border-black/[0.05] pt-4 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                    {plan.id === "free" ? "Plan" : billing?.cancelAtCycleEnd ? "Access until" : "Renews"}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-ink">
                    <Clock className="size-3.5 text-neutral-300" aria-hidden="true" />
                    {plan.id === "free"
                      ? "No renewal — free forever"
                      : billing?.renewalDate ?? "—"}
                  </p>
                  {billing?.cancelAtCycleEnd ? (
                    <p className="mt-1 text-[10.5px] leading-4 text-ink-mute">
                      Your cancellation takes effect at the end of the current billing period. You keep
                      every feature until then.
                    </p>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                    Usage this cycle
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                      <div
                        className={cn("h-full rounded-full transition-colors", tone.bar)}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className={cn("text-xs font-medium", tone.text)}>{Math.min(pct, 100)}%</span>
                  </div>
                  <p className="mt-1 text-[10.5px] text-neutral-400">
                    {usageUsed.toLocaleString()} / {usageAllowance.toLocaleString()} leads used ·{" "}
                    {Math.max(usageAllowance - usageUsed, 0).toLocaleString()} remaining
                  </p>
                </div>
              </div>
            </>
        </Card>

        <Card className="p-4">
          <SectionTitle title="Seats" />
            <>
              <p className="font-display mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink">
                {billing?.seats.used ?? 1}
                <span className="text-sm font-medium text-ink-mute"> / {billing?.seats.limit ?? plan.maxUsers}</span>
              </p>
              <p className="mt-1 text-[11px] text-ink-mute">
                Team members included on the {plan.label} plan.
              </p>
              <Btn variant="outline" size="sm" className="mt-3 w-full" href="/team">
                Manage team
              </Btn>
            </>
        </Card>
      </div>
      )}

      {/* plans — one-step upgrade ladder, no downgrades, no add-ons */}
      <div className="mt-6">
        <SectionTitle
          title="Plans"
          description={
            target
              ? `Upgrade one step at a time — the next plan from ${plan.label} is ${planFromId(target).label}.`
              : "You're on the highest available plan."
          }
          className="mb-3"
        />
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p) => {
            const pId = p.name.toLowerCase();
            const current = pId === currentPlanId;
            const isTarget = target !== null && pId === target;
            const isSwitching = switching === pId;
            const beyondTarget = !current && !isTarget && pId !== "free";
            return (
              <li key={pId}>
                <Card
                  className={cn(
                    "flex h-full flex-col p-4",
                    current ? "ring-1 ring-brand-600/40" : "hover:border-black/[0.14]"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium text-ink">{p.name}</p>
                    {current ? (
                      <Badge tone="green">Current plan</Badge>
                    ) : pId === "scale" && target === null ? (
                      <Badge tone="neutral">Highest plan</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1.5">
                    <span className="font-display text-[26px] font-semibold tracking-[-0.03em] text-ink">
                      {formatDollars(p.price)}
                    </span>
                    <span className="text-xs text-ink-mute">/mo</span>
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4.5 text-ink-mute">{p.blurb}</p>
                  <ul className="mt-3 flex-1 space-y-1.5 border-t border-black/[0.05] pt-3">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-[11.5px] leading-4.5 text-ink-soft">
                        <Check className="mt-[3px] size-3 shrink-0 text-brand-600" aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {current ? (
                    <span className="mt-4 inline-flex h-8 cursor-default items-center justify-center rounded bg-neutral-100 text-xs font-medium text-neutral-400">
                      {pId === "scale" ? "Highest available plan" : "Current plan"}
                    </span>
                  ) : isTarget ? (
                    <button
                      type="button"
                      disabled={Boolean(switching) || busy}
                      onClick={onUpgrade}
                      className={cn(
                        "mt-4 inline-flex h-8 items-center justify-center gap-1 rounded bg-brand-600 text-xs font-medium text-white transition-all hover:bg-brand-700 active:scale-[0.98]",
                        switching && !isSwitching && "opacity-50"
                      )}
                    >
                      {isSwitching ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      )}
                      Upgrade to {p.name}
                    </button>
                  ) : pId === "free" ? (
                    <span className="mt-4 inline-flex h-8 cursor-default items-center justify-center rounded bg-neutral-100 text-xs font-medium text-neutral-400">
                      Plan downgrades aren't available
                    </span>
                  ) : beyondTarget ? (
                    <span className="mt-4 inline-flex h-8 cursor-default items-center justify-center rounded bg-neutral-100 text-xs font-medium text-neutral-400">
                      One step at a time
                    </span>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      </div>

      {/* invoices */}
      <div className="mt-6">
        <SectionTitle title="Payment history" description="Invoices confirmed by our payment provider." className="mb-3" />
        {busy ? (
          <BillingInvoicesSkeleton />
        ) : !billing?.invoices.length ? (
          <EmptyState
            icon={<FileText className="size-4" aria-hidden="true" />}
            title="No invoices yet"
            description="Once you upgrade to a paid plan, every confirmed payment appears here."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
            <div className="thin-scroll overflow-x-auto">
              <table className="w-full min-w-[620px] text-left">
                <thead>
                  <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                    {["Invoice", "Date", "Description", "Amount", "Status"].map((h, i) => (
                      <th
                        key={i}
                        scope="col"
                        className="py-2 pl-3 pr-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {billing.invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-black/[0.04] transition-colors last:border-0 hover:bg-neutral-50/70"
                    >
                      <td className="py-2 pl-3 pr-3">
                        <span className="inline-flex items-center gap-2">
                          <FileText className="size-3.5 text-neutral-300" aria-hidden="true" />
                          <span className="font-mono text-[11px] text-ink-soft">{inv.id}</span>
                        </span>
                      </td>
                      <td className="py-2 pl-3 pr-5 text-xs text-ink-soft">{formatDate(inv.date)}</td>
                      <td className="py-2 pl-3 pr-3 text-xs text-ink-soft">{inv.description}</td>
                      <td className="py-2 pl-3 pr-3 text-xs font-medium text-ink">{inv.amount}</td>
                      <td className="py-2 pl-3 pr-3">
                        <Badge
                          tone={inv.status === "paid" ? "green" : inv.status === "failed" ? "red" : "neutral"}
                        >
                          {inv.status === "paid" ? (
                            <CheckCircle2 className="size-2.5" aria-hidden="true" />
                          ) : inv.status === "failed" ? (
                            <TriangleAlert className="size-2.5" aria-hidden="true" />
                          ) : null}
                          {inv.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <MetaText className="mt-3 block">
          Payments are processed by Paddle — card details go directly to Paddle and never touch
          Zybble's servers.
        </MetaText>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={async () => {
          setConfirmCancel(false);
          const { error: cancelError } = await cancelSubscription();
          if (cancelError) {
            toast(cancelError, "error");
            return;
          }
          toast("Subscription will cancel at the end of the current period");
          refresh();
          load();
        }}
        title="Cancel your subscription?"
        description={
          billing?.renewalDate
            ? `Your ${plan.label} plan stays active until the end of the current billing period (${billing.renewalDate}), then moves to the Free plan. Your leads and lists are kept.`
            : "You'll keep access until the end of the current billing period, then move to the Free plan. Your leads and lists are kept."
        }
        confirmLabel="Cancel subscription"
      />
    </AppLayout>
  );
}
