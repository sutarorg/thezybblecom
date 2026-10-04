/* ------------------------------------------------------------------ */
/* /admin/users/:id — Customer 360.                                    */
/*                                                                     */
/* Goal: an operator answers "who is this, what are they paying for,   */
/* did it work, and what broke?" without ever opening Supabase.        */
/* Everything is read-only except two audited, server-enforced         */
/* actions: change admin role, and suspend/reactivate the account.     */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, RotateCw, ShieldCheck, ShieldOff, UserCheck } from "lucide-react";
import { Badge, Btn, Card, Dialog, DialogHeader, Input, Skel, useToast } from "../../components/ui";
import { adminPost, useAdminResource, AdminApiError } from "../client";
import {
  Distribution,
  ErrorPanel,
  KeyValue,
  Metric,
  MetricGrid,
  Mono,
  PageHead,
  PlanBadge,
  Section,
  StatusBadge,
  ago,
  dateOnly,
  dateTime,
  full,
  money,
  num,
} from "../ui";

type Detail = {
  profile: {
    id: string; name: string; avatar_url: string | null; role: string; status: string;
    created_at: string; updated_at: string; email: string;
    email_confirmed_at: string | null; last_sign_in_at: string | null; effective_plan: string;
  };
  subscription: Record<string, unknown> | null;
  checkouts: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  workspaces: {
    id: string; name: string; is_client: boolean; created_at: string; is_owner: boolean;
    member_role: string | null; plan_id: string; member_count: number;
    leads_used: number; lead_allowance: number;
  }[];
  usage: { period_start: string; leads_used: number; searches: number; exports: number; ai_runs: number }[];
  searches: Record<string, unknown>[];
  exports: Record<string, unknown>[];
  ai_requests: Record<string, unknown>[];
  activity: Record<string, unknown>[];
  sessions: { id: string; user_agent: string | null; created_at: string; last_seen_at: string; revoked_at: string | null }[];
  admin_actions: { id: string; action: string; admin_email: string; summary: string; created_at: string }[];
};

export function AdminUserDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useAdminResource<{ user: Detail }>(`users/${id}`);
  const [dialog, setDialog] = useState<"role" | "suspend" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (error) {
    return (
      <>
        <PageHead
          title="Customer"
          actions={
            <Btn variant="outline" size="sm" onClick={() => navigate("/admin/users")}>
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              All users
            </Btn>
          }
        />
        <ErrorPanel message={error} onRetry={reload} />
      </>
    );
  }

  const u = data?.user;
  const p = u?.profile;
  const sub = u?.subscription as Record<string, unknown> | null | undefined;
  const latestPayment = u?.payments?.[0];
  const currency = String(sub?.currency ?? "INR");

  /** Run a privileged action; never show success unless the server said so. */
  async function act(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    try {
      const result = await adminPost<{ audited?: boolean; changed?: boolean }>(`users/${id}`, body);
      if (result.changed === false) toast("No change was needed — the value already matched.", "info");
      else toast(result.audited === false ? `${successMessage} (audit log write failed — check function logs)` : successMessage, result.audited === false ? "error" : "success");
      setDialog(null);
      setReason("");
      reload();
    } catch (e) {
      toast(e instanceof AdminApiError ? e.message : "That action couldn't be completed.", "error");
    } finally {
      setBusy(false);
    }
  }

  const suspended = p?.status === "suspended";
  const isAdmin = p?.role === "admin";

  return (
    <>
      <PageHead
        title={loading ? "Loading customer…" : p?.name || p?.email || "Customer"}
        description={p ? `${p.email} · joined ${dateOnly(p.created_at)}` : undefined}
        actions={
          <>
            <Btn variant="outline" size="sm" onClick={() => navigate("/admin/users")}>
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              All users
            </Btn>
            <Btn variant="outline" size="sm" onClick={reload} label="Refresh">
              <RotateCw className="size-3.5" aria-hidden="true" />
            </Btn>
            {p ? (
              <>
                <Btn variant="outline" size="sm" onClick={() => setDialog("role")}>
                  {isAdmin ? <ShieldOff className="size-3.5" aria-hidden="true" /> : <ShieldCheck className="size-3.5" aria-hidden="true" />}
                  {isAdmin ? "Revoke admin" : "Make admin"}
                </Btn>
                <Btn variant={suspended ? "outline" : "danger"} size="sm" onClick={() => setDialog("suspend")}>
                  {suspended ? <UserCheck className="size-3.5" aria-hidden="true" /> : <Ban className="size-3.5" aria-hidden="true" />}
                  {suspended ? "Reactivate" : "Suspend"}
                </Btn>
              </>
            ) : null}
          </>
        }
      />

      {loading ? (
        <div className="space-y-3">
          <Skel className="h-24 w-full rounded-lg" />
          <Skel className="h-40 w-full rounded-lg" />
        </div>
      ) : !u || !p ? (
        <ErrorPanel message="That customer no longer exists." onRetry={() => navigate("/admin/users")} />
      ) : (
        <div className="space-y-6">
          {suspended ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5">
              <Ban className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden="true" />
              <p className="text-xs leading-5 text-red-700">
                This account is suspended. Every workspace they own is blocked from consuming lead quota, so searches
                will fail with a 403 until it is reactivated.
              </p>
            </div>
          ) : null}

          {/* At-a-glance answers to the common support questions */}
          <MetricGrid cols={5}>
            <Metric label="Effective plan" value={<PlanBadge plan={p.effective_plan} />} />
            <Metric
              label="Subscription"
              value={sub ? <StatusBadge value={String(sub.status)} /> : <span className="text-[13px] text-ink-mute">None</span>}
              hint={sub?.current_period_end ? `renews ${dateOnly(String(sub.current_period_end))}` : undefined}
            />
            <Metric
              label="Latest payment"
              value={latestPayment ? money(latestPayment.amount_cents, String(latestPayment.currency ?? currency)) : "—"}
              hint={latestPayment ? `${String(latestPayment.status)} · ${ago(String(latestPayment.created_at))}` : "No payments recorded"}
              tone={latestPayment && latestPayment.status !== "captured" ? "bad" : "neutral"}
            />
            <Metric label="Workspaces" value={full(u.workspaces.length)} />
            <Metric
              label="Leads used (mo)"
              value={full(u.usage[0]?.leads_used ?? 0)}
              hint={u.usage[0]?.period_start ? `period ${u.usage[0].period_start}` : undefined}
            />
          </MetricGrid>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card className="min-w-0 p-4">
              <Section title="Profile">
                <KeyValue
                  items={[
                    { label: "Name", value: p.name || "—" },
                    { label: "Email", value: p.email || "—" },
                    { label: "User id", value: <Mono value={p.id} /> },
                    { label: "Role", value: <StatusBadge value={p.role} /> },
                    { label: "Account status", value: <StatusBadge value={p.status} /> },
                    { label: "Email confirmed", value: p.email_confirmed_at ? dateTime(p.email_confirmed_at) : "Not confirmed" },
                    { label: "Last sign-in", value: p.last_sign_in_at ? `${dateTime(p.last_sign_in_at)} (${ago(p.last_sign_in_at)})` : "Never" },
                    { label: "Created", value: dateTime(p.created_at) },
                  ]}
                />
              </Section>
            </Card>

            <Card className="min-w-0 p-4">
              <Section title="Plan &amp; billing" description="From the subscriptions table — the entitlement source of truth.">
                {sub ? (
                  <KeyValue
                    items={[
                      { label: "Stored plan", value: <PlanBadge plan={String(sub.plan_id)} /> },
                      { label: "Status", value: <StatusBadge value={String(sub.status)} /> },
                      { label: "Razorpay subscription", value: <Mono value={sub.razorpay_subscription_id as string} /> },
                      { label: "Razorpay plan", value: <Mono value={sub.razorpay_plan_id as string} /> },
                      { label: "Period", value: `${dateOnly(sub.current_period_start as string)} → ${dateOnly(sub.current_period_end as string)}` },
                      { label: "Next charge", value: dateOnly(sub.charge_at as string) },
                      { label: "Cancel at cycle end", value: sub.cancel_at_cycle_end ? <Badge tone="amber">Yes</Badge> : "No" },
                      { label: "Last provider event", value: sub.last_event_at ? ago(String(sub.last_event_at)) : "—" },
                    ]}
                  />
                ) : (
                  <p className="py-3 text-[11.5px] text-ink-mute">
                    No subscription row — this account is on the Free plan and has never completed a checkout.
                  </p>
                )}
                {u.checkouts.length ? (
                  <p className="mt-3 text-[11px] text-ink-mute">
                    {u.checkouts.length} pending/abandoned checkout(s) recorded. Latest:{" "}
                    <Mono value={String(u.checkouts[0]!.razorpay_subscription_id ?? "")} /> ({String(u.checkouts[0]!.status)})
                  </p>
                ) : null}
              </Section>
            </Card>
          </div>

          <Section title="Workspaces" description="Owned and joined workspaces, with this month's quota consumption.">
            <Card className="min-w-0 overflow-hidden">
              {u.workspaces.length ? (
                <ul className="divide-y divide-black/[0.05]">
                  {u.workspaces.map((w) => {
                    const pct = w.lead_allowance > 0 ? Math.min(100, (w.leads_used / w.lead_allowance) * 100) : 0;
                    return (
                      <li key={w.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/workspaces/${w.id}`)}
                          className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 text-left transition-colors hover:bg-neutral-50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium text-ink">{w.name}</span>
                            <span className="block truncate text-[11px] text-ink-mute">
                              {w.is_owner ? "Owner" : (w.member_role ?? "member")} · {w.member_count} member(s) · created {dateOnly(w.created_at)}
                            </span>
                          </span>
                          {w.is_client ? <Badge tone="sky">Client</Badge> : null}
                          <PlanBadge plan={w.plan_id} />
                          <span className="w-28 shrink-0">
                            <span className="block text-right text-[11px] tabular-nums text-ink-soft">
                              {full(w.leads_used)} / {w.lead_allowance < 0 ? "∞" : full(w.lead_allowance)}
                            </span>
                            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-black/[0.07]">
                              <span
                                className={pct >= 100 ? "block h-full bg-red-500" : pct >= 80 ? "block h-full bg-amber-500" : "block h-full bg-brand-600"}
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-mute">No workspaces.</p>
              )}
            </Card>
          </Section>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card className="min-w-0 p-4">
              <Section title="Usage history" description="Aggregated across every workspace this user owns.">
                {u.usage.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {u.usage.slice(0, 12).map((row) => (
                      <li key={row.period_start} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="text-ink-soft">{row.period_start}</span>
                        <span className="flex gap-3 tabular-nums text-ink-mute">
                          <span title="Leads">{full(row.leads_used)} leads</span>
                          <span title="Searches">{full(row.searches)} srch</span>
                          <span title="Exports">{full(row.exports)} exp</span>
                          <span title="AI runs">{full(row.ai_runs)} ai</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-[11.5px] text-ink-mute">No usage recorded yet.</p>
                )}
              </Section>
            </Card>

            <Card className="min-w-0 p-4">
              <Section title="Invoices &amp; payments">
                {u.invoices.length || u.payments.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {u.invoices.slice(0, 6).map((inv) => (
                      <li key={String(inv.id)} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="min-w-0 truncate text-ink-soft">
                          {String(inv.number)} · {dateOnly(String(inv.issued_at))}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular-nums text-ink">{money(inv.amount_cents, String(inv.currency ?? currency))}</span>
                          <StatusBadge value={String(inv.status)} />
                        </span>
                      </li>
                    ))}
                    {u.payments.slice(0, 6).map((pay) => (
                      <li key={String(pay.id)} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="min-w-0 truncate text-ink-soft">
                          <Mono value={String(pay.razorpay_payment_id ?? pay.id)} />
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular-nums text-ink">{money(pay.amount_cents, String(pay.currency ?? currency))}</span>
                          <StatusBadge value={String(pay.status)} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-[11.5px] text-ink-mute">No invoices or payments recorded.</p>
                )}
              </Section>
            </Card>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card className="min-w-0 p-4">
              <Section title="Recent searches" description="Did their last search work?">
                {u.searches.length ? (
                  <ul className="divide-y divide-black/[0.05]">
                    {u.searches.map((s) => (
                      <li key={String(s.id)} className="py-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/searches/${String(s.id)}`)}
                          className="flex w-full min-w-0 items-start justify-between gap-2 text-left"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] text-ink">{String(s.query)}</span>
                            <span className="block truncate text-[11px] text-ink-mute">
                              {String(s.location ?? "—")} · {full(s.result_count)}/{full(s.requested_count)} results · {ago(String(s.created_at))}
                            </span>
                            {s.error ? <span className="mt-0.5 block truncate text-[11px] text-red-600">{String(s.error)}</span> : null}
                          </span>
                          <StatusBadge value={String(s.status)} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-[11.5px] text-ink-mute">No searches yet.</p>
                )}
              </Section>
            </Card>

            <Card className="min-w-0 p-4">
              <Section title="AI &amp; exports" description="Did AI or an export fail for this customer?">
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-neutral-400">AI requests</p>
                {u.ai_requests.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {u.ai_requests.slice(0, 6).map((r) => (
                      <li key={String(r.id)} className="flex items-start justify-between gap-2 py-1.5">
                        <span className="min-w-0">
                          <span className="text-ink-soft">{String(r.kind)}</span>
                          <span className="ml-1.5 text-[11px] text-ink-mute">{String(r.model ?? "—")} · {ago(String(r.created_at))}</span>
                          {r.error ? <span className="block truncate text-[11px] text-red-600">{String(r.error)}</span> : null}
                        </span>
                        <StatusBadge value={String(r.status)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-[11.5px] text-ink-mute">No AI requests.</p>
                )}
                <p className="mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-neutral-400">Exports</p>
                {u.exports.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {u.exports.slice(0, 6).map((e) => (
                      <li key={String(e.id)} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate text-ink-soft">
                          {String(e.file_name)} · {full(e.lead_count)} leads
                        </span>
                        <StatusBadge value={String(e.status)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-[11.5px] text-ink-mute">No exports.</p>
                )}
              </Section>
            </Card>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card className="min-w-0 p-4">
              <Section title="Activity log" description="Workspace activity this user generated.">
                {u.activity.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {u.activity.map((a) => (
                      <li key={String(a.id)} className="flex items-start justify-between gap-3 py-1.5">
                        <span className="min-w-0 truncate text-ink-soft">{String(a.text)}</span>
                        <span className="shrink-0 text-[11px] text-neutral-400">{ago(String(a.created_at))}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-[11.5px] text-ink-mute">No activity recorded.</p>
                )}
              </Section>
            </Card>

            <Card className="min-w-0 p-4">
              <Section title="Security" description="App sessions and administrative changes to this account.">
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-neutral-400">App sessions</p>
                {u.sessions.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {u.sessions.map((s) => (
                      <li key={s.id} className="flex items-start justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate text-ink-soft" title={s.user_agent ?? ""}>
                          {s.user_agent?.slice(0, 60) || "Unknown client"}
                        </span>
                        <span className="shrink-0">
                          {s.revoked_at ? <Badge tone="red">revoked</Badge> : <span className="text-[11px] text-neutral-400">{ago(s.last_seen_at)}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-[11.5px] text-ink-mute">No recorded app sessions.</p>
                )}
                <p className="mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-neutral-400">Admin changes</p>
                {u.admin_actions.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {u.admin_actions.map((a) => (
                      <li key={a.id} className="py-1.5">
                        <p className="truncate text-ink-soft">{a.summary || a.action}</p>
                        <p className="text-[11px] text-neutral-400">
                          {a.admin_email} · {dateTime(a.created_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-[11.5px] text-ink-mute">No administrative changes recorded.</p>
                )}
              </Section>
            </Card>
          </div>

          <Card className="min-w-0 p-4">
            <Section title="Lead quality across their workspaces" description="Coverage of the contact fields this account has collected.">
              <Distribution
                data={u.workspaces.reduce<Record<string, number>>((acc, w) => {
                  acc[w.name] = num(w.leads_used);
                  return acc;
                }, {})}
                emptyLabel="No lead consumption recorded this month."
              />
            </Section>
          </Card>
        </div>
      )}

      {/* --------------------------- role ---------------------------- */}
      <Dialog open={dialog === "role"} onClose={() => setDialog(null)} label="Change admin role" maxWidth="max-w-md">
        <DialogHeader
          title={isAdmin ? "Revoke administrator access" : "Grant administrator access"}
          description={
            isAdmin
              ? "They will immediately lose access to /admin and to every /api/admin endpoint."
              : "They will gain full read access to every customer's data and the ability to perform privileged actions."
          }
          onClose={() => setDialog(null)}
        />
        <div className="px-4 py-4">
          <p className="text-xs leading-5 text-ink-mute">
            Target: <span className="font-medium text-ink">{p?.email}</span>
          </p>
          <p className="mt-2 text-[11.5px] leading-5 text-ink-mute">
            This is enforced server-side by the <code className="font-mono">profiles_protect_role</code> trigger and
            written to the admin audit log.
          </p>
          <div className="mt-4 flex justify-end gap-1.5">
            <Btn variant="outline" size="sm" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => act({ action: "set_role", role: isAdmin ? "user" : "admin" }, isAdmin ? "Admin access revoked." : "Admin access granted.")}
            >
              {busy ? "Working…" : isAdmin ? "Revoke admin" : "Grant admin"}
            </Btn>
          </div>
        </div>
      </Dialog>

      {/* -------------------------- suspend -------------------------- */}
      <Dialog open={dialog === "suspend"} onClose={() => setDialog(null)} label="Change account status" maxWidth="max-w-md">
        <DialogHeader
          title={suspended ? "Reactivate this account" : "Suspend this account"}
          description={
            suspended
              ? "Quota consumption will resume immediately for every workspace they own."
              : "Every workspace they own will be blocked from consuming lead quota. Existing data is untouched."
          }
          onClose={() => setDialog(null)}
        />
        <div className="px-4 py-4">
          {!suspended ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11.5px] leading-5 text-amber-800">
                Destructive for the customer: their searches will start failing with "This account is suspended".
              </p>
            </div>
          ) : null}
          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] font-medium text-ink">Reason (recorded in the audit log)</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. payment fraud investigation" />
          </label>
          <div className="mt-4 flex justify-end gap-1.5">
            <Btn variant="outline" size="sm" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              disabled={busy}
              className={suspended ? "" : "bg-red-600 shadow-none hover:bg-red-700"}
              onClick={() =>
                act(
                  { action: "set_status", status: suspended ? "active" : "suspended", reason },
                  suspended ? "Account reactivated." : "Account suspended.",
                )
              }
            >
              {busy ? "Working…" : suspended ? "Reactivate account" : "Suspend account"}
            </Btn>
          </div>
        </div>
      </Dialog>
    </>
  );
}
