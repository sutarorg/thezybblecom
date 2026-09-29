/* ------------------------------------------------------------------ */
/* Zybble app — Billing                                                */
/* ------------------------------------------------------------------ */
import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
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
  MetaText,
  SectionTitle,
  TableSkeleton,
  formatDate,
  useToast,
} from "../components/ui";
import { INVOICES, KPI, PLAN } from "../data/mock";
import { PLANS } from "../../lib/site";
import { useAppSeo } from "../hooks";
import { BACKEND_ENABLED, cancelSubscription, getBilling, startCheckout, syncBilling } from "../services/api";
import { useWorkspace } from "../services/hooks";

export function BillingPage() {
  useAppSeo("Billing — Zybble", "Your plan, usage, and invoices.", "/billing");
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const { workspace } = useWorkspace();
  const [billing, setBilling] = useState<{ plan: string; status: string; renewalDate: string; seatInfo: { used: number; limit: number } } | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 420);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!BACKEND_ENABLED || !workspace) return;
    syncBilling().catch(() => undefined);
    getBilling(workspace.id)
      .then((state) => setBilling(state))
      .catch(() => undefined);
  }, [workspace]);

  const currentPlan = billing?.plan ?? PLAN;
  const renewal = billing?.renewalDate ?? KPI.renewalDate;

  const pct = Math.round((KPI.used / KPI.allowance) * 100);

  const onSwitch = async (planName: string) => {
    setSwitching(planName);
    if (BACKEND_ENABLED) {
      if (planName === currentPlan) {
        setSwitching(null);
        toast("You're already on that plan", "info");
        return;
      }
      const { url, error } = await startCheckout(planName.toLowerCase() as "growth" | "agency" | "scale");
      setSwitching(null);
      if (error || !url) {
        toast(error ?? "Checkout couldn't start right now.", "error");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      toast("Complete checkout in the new tab — your plan updates automatically.", "info");
      return;
    }
    window.setTimeout(() => {
      setSwitching(null);
      toast(planName === currentPlan ? `You're already on ${planName}` : `Plan change to ${planName} scheduled — demo action`, planName === currentPlan ? "info" : "success");
    }, 900);
  };

  return (
    <AppLayout
      title="Billing"
      description="Your subscription, usage, and payment history."
      wide
    >
      {/* current subscription */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-brand-600 text-white">
                <CreditCard className="size-4.5" aria-hidden="true" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-base font-semibold tracking-[-0.02em] text-ink">{currentPlan} plan</h2>
                  <Badge tone="green">
                    <CheckCircle2 className="size-2.5" aria-hidden="true" />
                    Active
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-ink-mute">$99/month · billed monthly</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Btn
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (BACKEND_ENABLED) {
                    const { error } = await cancelSubscription();
                    if (error) {
                      toast(error, "error");
                      return;
                    }
                    toast("Subscription will cancel at the end of the current period");
                    return;
                  }
                  toast("A person will reach out about plan changes", "info");
                }}
              >
                Cancel subscription
              </Btn>
              <Btn variant="primary" size="sm" onClick={() => toast("Pick a plan below to change", "info")}>
                Change plan
              </Btn>
            </div>
          </div>

          <div className="mt-4 grid gap-4 border-t border-black/[0.05] pt-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Renews</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-ink">
                <Clock className="size-3.5 text-neutral-300" aria-hidden="true" />
                {renewal}
              </p>
              <p className="mt-0.5 text-[10.5px] text-neutral-400">auto-renew monthly</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Usage this cycle</p>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-medium text-ink">{pct}%</span>
              </div>
              <p className="mt-1 text-[10.5px] text-neutral-400">
                {KPI.used.toLocaleString()} of {KPI.allowance.toLocaleString()} leads · {KPI.remaining.toLocaleString()} remaining
              </p>
            </div>
          </div>
        </Card>

        {/* payment method */}
        <Card className="p-4">
          <SectionTitle title="Payment method" />
          <div className="mt-3 flex items-center gap-2.5 rounded-md border border-black/[0.06] bg-neutral-50/70 px-3 py-2.5">
            <span className="grid size-8 place-items-center rounded-md bg-white text-neutral-500 ring-1 ring-black/[0.05]">
              <CreditCard className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] font-medium text-ink">•••• •••• •••• 4242</p>
              <p className="text-[10px] text-neutral-400">Expires 08/28 · Visa</p>
            </div>
            <Btn variant="outline" size="sm" onClick={() => toast("Payment methods update on account", "info")}>
              Update
            </Btn>
          </div>
          <p className="mt-3 text-[10.5px] leading-4 text-neutral-400">
            Payments are processed by the payment provider — card details never touch Zybble's servers.
          </p>
        </Card>
      </div>

      {/* plans */}
      <div className="mt-6">
        <SectionTitle title="Plans" description="Monthly plans — no long commitments." className="mb-3" />
        {loading ? (
          <TableSkeleton rows={4} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PLANS.map((plan) => {
              const current = plan.name === currentPlan;
              const isSwitching = switching === plan.name;
              return (
                <li key={plan.name}>
                  <Card
                    className={cn(
                      "flex h-full flex-col p-4",
                      current ? "ring-1 ring-brand-600/40" : "hover:border-black/[0.14]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-ink">{plan.name}</p>
                      {current ? <Badge tone="green">Current plan</Badge> : null}
                    </div>
                    <p className="mt-1.5">
                      <span className="font-display text-[26px] font-semibold tracking-[-0.03em] text-ink">${plan.price}</span>
                      <span className="text-xs text-ink-mute">/mo</span>
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4.5 text-ink-mute">{plan.blurb}</p>
                    <ul className="mt-3 flex-1 space-y-1.5 border-t border-black/[0.05] pt-3">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-1.5 text-[11.5px] leading-4.5 text-ink-soft">
                          <Check className="mt-[3px] size-3 shrink-0 text-brand-600" aria-hidden="true" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      disabled={current || Boolean(switching)}
                      onClick={() => onSwitch(plan.name)}
                      className={cn(
                        "mt-4 inline-flex h-8 items-center justify-center rounded text-xs font-medium transition-all",
                        current
                          ? "cursor-default bg-neutral-100 text-neutral-400"
                          : "bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.98]",
                        switching && !isSwitching && "opacity-50"
                      )}
                    >
                      {isSwitching ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : current ? (
                        "Current plan"
                      ) : plan.name === "Free" ? (
                        "Downgrade"
                      ) : (
                        `Switch to ${plan.name}`
                      )}
                    </button>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* invoices */}
      <div className="mt-6">
        <SectionTitle title="Payment history" description="Past invoices and upcoming charge." className="mb-3" />
        <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                  {["Invoice", "Date", "Description", "Amount", "Status", ""].map((h, i) => (
                    <th key={i} scope="col" className="py-2 pl-3 pr-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-black/[0.04] bg-neutral-50/40">
                  <td className="py-2 pl-3 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <FileText className="size-3.5 text-neutral-300" aria-hidden="true" />
                      <span className="font-mono text-[11px] text-ink-soft">inv-2026-003</span>
                    </span>
                  </td>
                  <td className="py-2 pl-3 pr-3"><MetaText>{renewal}</MetaText></td>
                  <td className="py-2 pl-3 pr-3 text-xs text-ink-soft">Agency plan · March</td>
                  <td className="py-2 pl-3 pr-3 text-xs font-medium text-ink">$99.00</td>
                  <td className="py-2 pl-3 pr-3">
                    <Badge tone="neutral">Upcoming</Badge>
                  </td>
                  <td className="py-2 pl-3 pr-3" />
                </tr>
                {INVOICES.map((inv) => (
                  <tr key={inv.id} className="border-b border-black/[0.04] transition-colors last:border-0 hover:bg-neutral-50/70">
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
                      <Badge tone={inv.status === "paid" ? "green" : inv.status === "failed" ? "red" : "neutral"}>
                        {inv.status === "paid" ? <CheckCircle2 className="size-2.5" aria-hidden="true" /> : inv.status === "failed" ? <TriangleAlert className="size-2.5" aria-hidden="true" /> : null}
                        {inv.status}
                      </Badge>
                    </td>
                    <td className="py-2 pl-3 pr-3">
                      <Btn variant="ghost" size="sm" onClick={() => toast("Invoice PDF downloading — demo", "info")}>
                        <Download className="size-3.5" aria-hidden="true" />
                        PDF
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
