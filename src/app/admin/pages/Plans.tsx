/* ------------------------------------------------------------------ */
/* /admin/plans — entitlement catalog.                                 */
/*                                                                     */
/* The `plans` table is the single source of truth: every limit        */
/* trigger (enforce_list_limit, enforce_seat_limit,                    */
/* enforce_client_workspace_plan) and reserve_leads() read it at       */
/* runtime, so an edit here takes effect immediately with no deploy.   */
/* Values are validated server-side and every change is audited.       */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { AlertTriangle, Pencil, RotateCw } from "lucide-react";
import { Badge, Btn, Card, Dialog, DialogHeader, Input, Skel, Switch, useToast } from "../../components/ui";
import { AdminApiError, adminPost, useAdminResource } from "../client";
import { ErrorPanel, Metric, MetricGrid, PageHead, Section, full, money } from "../ui";

type Plan = {
  id: string;
  label: string;
  price_cents: number;
  currency: string;
  lead_allowance: number;
  max_lists: number;
  max_users: number;
  has_ai: boolean;
  client_workspaces: boolean;
  priority_processing: boolean;
  subscribers: number;
};

type Response = { plans: Plan[]; totalWorkspaces: number };

type Draft = {
  price_cents: string;
  lead_allowance: string;
  max_lists: string;
  max_users: string;
  has_ai: boolean;
  client_workspaces: boolean;
  priority_processing: boolean;
};

const toDraft = (p: Plan): Draft => ({
  price_cents: String(p.price_cents),
  lead_allowance: String(p.lead_allowance),
  max_lists: String(p.max_lists),
  max_users: String(p.max_users),
  has_ai: p.has_ai,
  client_workspaces: p.client_workspaces,
  priority_processing: p.priority_processing,
});

export function AdminPlans() {
  const toast = useToast();
  const { data, loading, error, reload } = useAdminResource<Response>("plans");
  const [editing, setEditing] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [impactWarning, setImpactWarning] = useState<string | null>(null);

  function open(plan: Plan) {
    setEditing(plan);
    setDraft(toDraft(plan));
    setImpactWarning(null);
  }

  const diff =
    editing && draft
      ? (
          [
            ["price_cents", Number(draft.price_cents), editing.price_cents],
            ["lead_allowance", Number(draft.lead_allowance), editing.lead_allowance],
            ["max_lists", Number(draft.max_lists), editing.max_lists],
            ["max_users", Number(draft.max_users), editing.max_users],
            ["has_ai", draft.has_ai, editing.has_ai],
            ["client_workspaces", draft.client_workspaces, editing.client_workspaces],
            ["priority_processing", draft.priority_processing, editing.priority_processing],
          ] as const
        ).filter(([, next, current]) => next !== current)
      : [];

  async function save(acknowledgeImpact: boolean) {
    if (!editing || !draft || !diff.length) return;
    setBusy(true);
    try {
      await adminPost("plans", {
        id: editing.id,
        ...Object.fromEntries(diff.map(([key, next]) => [key, next])),
        ...(acknowledgeImpact ? { acknowledgeImpact: true } : {}),
      });
      toast(`The ${editing.label} plan was updated.`, "success");
      setEditing(null);
      setDraft(null);
      setImpactWarning(null);
      reload();
    } catch (e) {
      if (e instanceof AdminApiError && e.code === "plan_impact") setImpactWarning(e.message);
      else toast(e instanceof AdminApiError ? e.message : "That plan couldn't be updated.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorPanel message={error} onRetry={reload} />;

  return (
    <>
      <PageHead
        title="Plans &amp; entitlements"
        description="The plans table drives every limit in the product at runtime. Editing a value here changes behaviour immediately for every customer on that plan."
        actions={
          <Btn variant="outline" size="sm" onClick={reload} label="Refresh">
            <RotateCw className="size-3.5" aria-hidden="true" />
          </Btn>
        }
      />

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skel key={i} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <MetricGrid cols={3}>
            <Metric label="Plans configured" value={full(data?.plans.length)} />
            <Metric label="Paying subscriptions" value={full(data?.plans.reduce((acc, p) => acc + (p.id === "free" ? 0 : p.subscribers), 0))} />
            <Metric label="Workspaces affected" value={full(data?.totalWorkspaces)} />
          </MetricGrid>

          <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {data?.plans.map((plan) => (
              <Card key={plan.id} className="flex min-w-0 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-sm font-semibold tracking-[-0.01em] text-ink">{plan.label}</p>
                    <p className="font-display mt-0.5 text-[22px] font-semibold tracking-[-0.02em] text-ink">
                      {money(plan.price_cents, plan.currency)}
                      <span className="ml-1 text-[11px] font-normal text-ink-mute">/mo</span>
                    </p>
                  </div>
                  <Badge tone={plan.subscribers > 0 ? "green" : "neutral"}>{full(plan.subscribers)} active</Badge>
                </div>

                <dl className="mt-4 flex-1 space-y-1.5 text-[12px]">
                  {(
                    [
                      ["Lead allowance", full(plan.lead_allowance)],
                      ["Max lists", plan.max_lists < 0 ? "Unlimited" : full(plan.max_lists)],
                      ["Seats", full(plan.max_users)],
                      ["Currency", plan.currency],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-2">
                      <dt className="text-ink-mute">{label}</dt>
                      <dd className="tabular-nums text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={plan.has_ai ? "green" : "neutral"}>AI</Badge>
                  <Badge tone={plan.client_workspaces ? "green" : "neutral"}>Client workspaces</Badge>
                  <Badge tone={plan.priority_processing ? "green" : "neutral"}>Priority</Badge>
                </div>

                <Btn variant="outline" size="sm" className="mt-4 w-full" onClick={() => open(plan)}>
                  <Pencil className="size-3.5" aria-hidden="true" />
                  Edit entitlements
                </Btn>
              </Card>
            ))}
          </div>

          <Section
            className="mt-6"
            title="Where these values are enforced"
            description="Nothing on this page is cosmetic — each field below is read by a database trigger or function at request time."
          >
            <Card className="min-w-0 p-4">
              <ul className="space-y-1.5 text-[12px] text-ink-soft">
                <li>
                  <code className="font-mono text-[11px]">lead_allowance</code> — read by{" "}
                  <code className="font-mono text-[11px]">reserve_leads()</code> on every search; exceeding it returns a 429.
                </li>
                <li>
                  <code className="font-mono text-[11px]">max_lists</code> — enforced by{" "}
                  <code className="font-mono text-[11px]">enforce_list_limit()</code> before a list row is inserted. <code className="font-mono text-[11px]">-1</code> means unlimited.
                </li>
                <li>
                  <code className="font-mono text-[11px]">max_users</code> — enforced by{" "}
                  <code className="font-mono text-[11px]">enforce_seat_limit()</code> on membership insert and on invitation acceptance.
                </li>
                <li>
                  <code className="font-mono text-[11px]">client_workspaces</code> — enforced by{" "}
                  <code className="font-mono text-[11px]">enforce_client_workspace_plan()</code>.
                </li>
                <li>
                  <code className="font-mono text-[11px]">price_cents</code> — the MRR figure on the dashboard and the amount shown at checkout. The Razorpay plan
                  amount is configured separately in Razorpay and is NOT changed by editing this value.
                </li>
              </ul>
            </Card>
          </Section>
        </>
      )}

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} label="Edit plan entitlements" maxWidth="max-w-lg">
        {editing && draft ? (
          <>
            <DialogHeader
              title={`Edit the ${editing.label} plan`}
              description={`${full(editing.subscribers)} active subscription(s) are on this plan right now.`}
              onClose={() => setEditing(null)}
            />
            <div className="space-y-3 px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["price_cents", `Price (minor units, ${editing.currency})`],
                    ["lead_allowance", "Lead allowance / month"],
                    ["max_lists", "Max lists (-1 = unlimited)"],
                    ["max_users", "Seats"],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="block">
                    <span className="mb-1 block text-[11px] font-medium text-ink">{label}</span>
                    <Input
                      type="number"
                      value={draft[field]}
                      onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                    />
                  </label>
                ))}
              </div>

              <div className="space-y-2 rounded border border-black/[0.07] px-3 py-2.5">
                {(
                  [
                    ["has_ai", "AI features"],
                    ["client_workspaces", "Client workspaces"],
                    ["priority_processing", "Priority processing"],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field} className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-ink-soft">{label}</span>
                    <Switch checked={draft[field]} onChange={(v) => setDraft({ ...draft, [field]: v })} label={label} />
                  </div>
                ))}
              </div>

              {diff.length ? (
                <div className="rounded border border-black/[0.07] bg-neutral-50 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-500">Exactly what will change</p>
                  <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-soft">
                    {diff.map(([key, next, current]) => (
                      <li key={key}>
                        <code className="font-mono text-[11px]">{key}</code>: {String(current)} → <span className="font-medium text-ink">{String(next)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[11.5px] text-ink-mute">No changes yet.</p>
              )}

              {impactWarning ? (
                <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <div>
                    <p className="text-[11.5px] leading-5 text-amber-800">{impactWarning}</p>
                    <Btn variant="outline" size="sm" className="mt-2" disabled={busy} onClick={() => save(true)}>
                      I understand — apply anyway
                    </Btn>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end gap-1.5 pt-1">
                <Btn variant="outline" size="sm" onClick={() => setEditing(null)} disabled={busy}>
                  Cancel
                </Btn>
                <Btn variant="primary" size="sm" disabled={busy || !diff.length} onClick={() => save(false)}>
                  {busy ? "Saving…" : "Save entitlements"}
                </Btn>
              </div>
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  );
}
