/* ------------------------------------------------------------------ */
/* /admin/plans — plan and entitlement administration                  */
/*                                                                     */
/* The `plans` table is the single source of truth for every limit the */
/* server enforces (reserve_leads, list/seat limits, AI and client     */
/* workspace gating). Editing here changes the product for real, so    */
/* every change is confirmed, reasoned, audited, and checked against   */
/* live consumption before it is applied.                              */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { Pencil } from "lucide-react";
import { adminPatch, AdminRequestError, useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  ActionDialog,
  Caveat,
  DataTable,
  ErrorState,
  Nothing,
  Panel,
  Stat,
  StatGrid,
  formatMoney,
  formatNumber,
} from "../components";
import { arr, bool, num, obj, str, type Row } from "../shape";
import { Badge, Btn, FieldLabel, Input, Switch, useToast } from "../../components/ui";

type Draft = {
  lead_allowance: string;
  max_lists: string;
  max_users: string;
  price_cents: string;
  has_ai: boolean;
  client_workspaces: boolean;
  priority_processing: boolean;
};

function draftFrom(plan: Row): Draft {
  return {
    lead_allowance: String(num(plan.lead_allowance)),
    max_lists: String(num(plan.max_lists)),
    max_users: String(num(plan.max_users)),
    price_cents: String(num(plan.price_cents)),
    has_ai: bool(plan.has_ai),
    client_workspaces: bool(plan.client_workspaces),
    priority_processing: bool(plan.priority_processing),
  };
}

export function AdminPlans({ identity }: { identity: AdminIdentity }) {
  const toast = useToast();
  const query = useAdminData<Row>("plans");

  const plans = arr(query.data?.plans);
  const adoption = obj(query.data?.adoption);
  const totals = obj(query.data?.totals);
  const providerPlans = obj(query.data?.providerPlans);

  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [force, setForce] = useState(false);

  function startEdit(plan: Row) {
    setEditing(plan);
    setDraft(draftFrom(plan));
    setActionError(null);
    setForce(false);
  }

  async function save(reason: string) {
    if (!editing || !draft) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await adminPatch<{ changed: string[]; priceDrift: boolean }>(`plans/${str(editing.id)}`, {
        lead_allowance: Number(draft.lead_allowance),
        max_lists: Number(draft.max_lists),
        max_users: Number(draft.max_users),
        price_cents: Number(draft.price_cents),
        has_ai: draft.has_ai,
        client_workspaces: draft.client_workspaces,
        priority_processing: draft.priority_processing,
        reason,
        confirm: true,
        force,
      });
      toast(
        result.changed.length
          ? `Plan updated: ${result.changed.join(", ")}.${result.priceDrift ? " Update the Razorpay plan amount too." : ""}`
          : "No changes to apply.",
        "success",
      );
      setEditing(null);
      setDraft(null);
      query.refresh();
    } catch (caught) {
      const message =
        caught instanceof AdminRequestError ? caught.message : "That plan change couldn't be saved. Please try again.";
      setActionError(message);
      if (caught instanceof AdminRequestError && caught.code === "plan_change_blocked") setForce(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout
      identity={identity}
      title="Plans"
      description="Entitlements the server enforces, and how many customers are on each plan."
    >
      {query.error ? (
        <ErrorState message={query.error} onRetry={query.refresh} />
      ) : (
        <div className="space-y-2.5">
          <StatGrid className="lg:grid-cols-3">
            <Stat label="Total accounts" value={formatNumber(totals.users)} loading={query.initial} />
            <Stat
              label="Paid subscribers"
              value={formatNumber(totals.paidSubscribers)}
              hint="Entitling subscriptions on a paid plan"
              loading={query.initial}
            />
            <Stat label="On Free" value={formatNumber(totals.freeUsers)} loading={query.initial} />
          </StatGrid>

          <Panel
            title="Plan catalog"
            description="One row per plan — these values are read by the database functions that enforce quotas."
          >
            <DataTable
              columns={[
                {
                  key: "plan",
                  header: "Plan",
                  render: (row) => (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium capitalize text-ink">{str(row.id)}</span>
                      {num(adoption[str(row.id)]) > 0 ? (
                        <Badge tone="green">{formatNumber(adoption[str(row.id)])} active</Badge>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: "price",
                  header: "Price / month",
                  numeric: true,
                  render: (row) => formatMoney(row.price_cents, str(row.currency) || "INR"),
                },
                { key: "leads", header: "Lead allowance", numeric: true, render: (row) => formatNumber(row.lead_allowance) },
                {
                  key: "lists",
                  header: "Lists",
                  numeric: true,
                  render: (row) => (num(row.max_lists) === -1 ? "Unlimited" : formatNumber(row.max_lists)),
                },
                { key: "seats", header: "Seats", numeric: true, render: (row) => formatNumber(row.max_users) },
                { key: "ai", header: "AI", render: (row) => (bool(row.has_ai) ? "Yes" : "No") },
                {
                  key: "client",
                  header: "Client workspaces",
                  render: (row) => (bool(row.client_workspaces) ? "Yes" : "No"),
                },
                {
                  key: "priority",
                  header: "Priority",
                  render: (row) => (bool(row.priority_processing) ? "Yes" : "No"),
                },
                {
                  key: "provider",
                  header: "Razorpay plan",
                  render: (row) =>
                    str(row.id) === "free" ? (
                      <span className="text-[11px] text-ink-mute">Not billed</span>
                    ) : bool(providerPlans[str(row.id)]) ? (
                      <Badge tone="green">Configured</Badge>
                    ) : (
                      <Badge tone="amber">Missing id</Badge>
                    ),
                },
                {
                  key: "actions",
                  header: "",
                  render: (row) => (
                    <Btn variant="outline" size="sm" onClick={() => startEdit(row)}>
                      <Pencil className="size-3" aria-hidden="true" />
                      Edit
                    </Btn>
                  ),
                },
              ]}
              rows={plans}
              loading={query.loading}
              rowKey={(row) => str(row.id)}
              minWidth="min-w-[980px]"
              empty={<Nothing title="No plans configured" description="The plans table is empty." />}
            />
          </Panel>

          <Caveat>
            Prices are stored in the minor unit (paise) and are what Zybble displays and sends to checkout. The amount a
            customer is actually charged on renewal comes from the Razorpay plan object, so if you change a price here
            you must change the matching Razorpay plan too — this console deliberately won't pretend to do that for you.
            “Razorpay plan: configured” only reports whether the server has an id for that plan; the id itself is never
            sent to the browser.
          </Caveat>
        </div>
      )}

      <ActionDialog
        open={editing !== null}
        onClose={() => {
          setEditing(null);
          setDraft(null);
        }}
        onConfirm={save}
        busy={busy}
        error={actionError}
        title={`Edit the ${str(editing?.id)} plan`}
        description="Changes take effect immediately for every customer on this plan."
        confirmLabel={force ? "Apply anyway" : "Save plan"}
        danger={force}
      >
        {draft ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="plan-leads">Lead allowance</FieldLabel>
              <Input
                id="plan-leads"
                type="number"
                min={0}
                value={draft.lead_allowance}
                onChange={(event) => setDraft({ ...draft, lead_allowance: event.target.value })}
              />
            </div>
            <div>
              <FieldLabel htmlFor="plan-price">Price (paise)</FieldLabel>
              <Input
                id="plan-price"
                type="number"
                min={0}
                value={draft.price_cents}
                onChange={(event) => setDraft({ ...draft, price_cents: event.target.value })}
              />
              <p className="mt-1 text-[11px] text-ink-mute">
                {formatMoney(Number(draft.price_cents) || 0, str(editing?.currency) || "INR")} per month
              </p>
            </div>
            <div>
              <FieldLabel htmlFor="plan-lists">Max lists (-1 = unlimited)</FieldLabel>
              <Input
                id="plan-lists"
                type="number"
                min={-1}
                value={draft.max_lists}
                onChange={(event) => setDraft({ ...draft, max_lists: event.target.value })}
              />
            </div>
            <div>
              <FieldLabel htmlFor="plan-seats">Seats</FieldLabel>
              <Input
                id="plan-seats"
                type="number"
                min={1}
                value={draft.max_users}
                onChange={(event) => setDraft({ ...draft, max_users: event.target.value })}
              />
            </div>
            <div className="space-y-2 rounded border border-black/[0.06] px-2.5 py-2 sm:col-span-2">
              {(
                [
                  { key: "has_ai", label: "AI features" },
                  { key: "client_workspaces", label: "Client workspaces" },
                  { key: "priority_processing", label: "Priority processing" },
                ] as const
              ).map((toggle) => (
                <div key={toggle.key} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-ink-soft">{toggle.label}</span>
                  <Switch
                    checked={draft[toggle.key]}
                    onChange={(value) => setDraft({ ...draft, [toggle.key]: value })}
                    label={toggle.label}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </ActionDialog>
    </AdminLayout>
  );
}
