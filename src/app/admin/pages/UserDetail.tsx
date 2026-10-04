/* ------------------------------------------------------------------ */
/* /admin/users/:id — customer 360                                     */
/*                                                                     */
/* Built so a support question ("why can't this account run a search", */
/* "did their payment land", "which device is still signed in") can be */
/* answered here instead of in the Supabase dashboard.                 */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, ShieldCheck, ShieldOff, UserMinus, UserPlus } from "lucide-react";
import { adminPost, AdminRequestError, useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  ActionDialog,
  Caveat,
  CopyValue,
  DataTable,
  ErrorState,
  KeyValue,
  LinkBtn,
  LoadingPanel,
  Nothing,
  Panel,
  StatusBadge,
  formatDateTime,
  formatMoney,
  formatNumber,
  timeAgo,
} from "../components";
import { arr, bool, num, obj, str, type Row } from "../shape";
import { Badge, Btn, useToast } from "../../components/ui";

type ActionKind = "grant" | "revoke" | "suspend" | "restore" | "sync" | null;

export function AdminUserDetail({ identity }: { identity: AdminIdentity }) {
  const { id = "" } = useParams();
  const toast = useToast();
  const query = useAdminData<Row>(`users/${id}`);
  const [action, setAction] = useState<ActionKind>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const profile = obj(query.data?.profile);
  const auth = obj(query.data?.auth);
  const plan = obj(query.data?.plan);
  const entitlements = obj(plan.entitlements);
  const subscription = obj(query.data?.subscription);
  const hasSubscription = Object.keys(subscription).length > 0;
  const usage = obj(query.data?.usage);
  const workspaces = arr(query.data?.workspaces);
  const payments = arr(query.data?.payments);
  const invoices = arr(query.data?.invoices);
  const checkouts = arr(query.data?.checkouts);
  const searches = arr(query.data?.searches);
  const exportRows = arr(query.data?.exports);
  const aiRequests = arr(query.data?.ai_requests);
  const activity = arr(query.data?.activity);
  const sessions = arr(query.data?.sessions);
  const adminActions = arr(query.data?.admin_actions);
  const usageHistory = arr(usage.history);

  const name = str(profile.name) || "Unnamed customer";
  const email = str(auth.email);
  const isAdmin = str(profile.role) === "admin";
  const suspended = Boolean(auth.banned_until);
  const isSelf = str(profile.id) === identity.id;

  async function run(reason: string) {
    setBusy(true);
    setActionError(null);
    try {
      if (action === "grant" || action === "revoke") {
        await adminPost(`users/${id}/role`, { role: action === "grant" ? "admin" : "user", reason, confirm: true });
        toast(action === "grant" ? "Admin access granted." : "Admin access removed.", "success");
      } else if (action === "suspend" || action === "restore") {
        await adminPost(`users/${id}/suspend`, { suspend: action === "suspend", reason, confirm: true });
        toast(action === "suspend" ? "Account suspended." : "Account restored.", "success");
      } else if (action === "sync") {
        await adminPost("billing/sync", { userId: id, reason });
        toast("Subscription reconciled with Razorpay.", "success");
      }
      setAction(null);
      query.refresh();
    } catch (caught) {
      setActionError(
        caught instanceof AdminRequestError ? caught.message : "That action couldn't be completed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const dialogCopy: Record<Exclude<ActionKind, null>, { title: string; description: string; confirm: string; danger?: boolean }> = {
    grant: {
      title: "Grant admin access",
      description: `${name} will be able to read and change every tenant's data in this console.`,
      confirm: "Grant admin",
    },
    revoke: {
      title: "Remove admin access",
      description: `${name} keeps their normal account but loses the console.`,
      confirm: "Remove admin",
      danger: true,
    },
    suspend: {
      title: "Suspend this account",
      description:
        "Supabase Auth will refuse new sign-ins and token refreshes for this user, so they are signed out everywhere. Their data is untouched.",
      confirm: "Suspend account",
      danger: true,
    },
    restore: {
      title: "Restore this account",
      description: "The sign-in block is lifted immediately.",
      confirm: "Restore account",
    },
    sync: {
      title: "Reconcile with Razorpay",
      description:
        "Reads the subscription from Razorpay and stores the provider's answer (status, period, cancellation). Nothing is charged or cancelled.",
      confirm: "Reconcile now",
    },
  };

  return (
    <AdminLayout
      identity={identity}
      title={query.initial ? "Customer" : name}
      description={email || "Customer 360 — profile, billing, workspaces, usage, activity and security."}
      aside={
        <div className="flex flex-wrap items-center gap-1.5">
          <LinkBtn to="/admin/users" variant="ghost">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            All users
          </LinkBtn>
          <Btn variant="outline" size="sm" onClick={query.refresh} disabled={query.loading}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Refresh
          </Btn>
          {!query.initial && !query.error ? (
            <>
              {isAdmin ? (
                <Btn variant="outline" size="sm" onClick={() => setAction("revoke")} disabled={isSelf}>
                  <ShieldOff className="size-3.5" aria-hidden="true" />
                  Remove admin
                </Btn>
              ) : (
                <Btn variant="outline" size="sm" onClick={() => setAction("grant")}>
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  Make admin
                </Btn>
              )}
              {suspended ? (
                <Btn variant="outline" size="sm" onClick={() => setAction("restore")}>
                  <UserPlus className="size-3.5" aria-hidden="true" />
                  Restore
                </Btn>
              ) : (
                <Btn variant="outline" size="sm" onClick={() => setAction("suspend")} disabled={isSelf}>
                  <UserMinus className="size-3.5" aria-hidden="true" />
                  Suspend
                </Btn>
              )}
            </>
          ) : null}
        </div>
      }
    >
      {query.error ? (
        <ErrorState message={query.error} onRetry={query.refresh} />
      ) : query.initial ? (
        <Panel>
          <LoadingPanel rows={6} />
        </Panel>
      ) : (
        <div className="space-y-2.5">
          {isSelf ? (
            <Caveat>
              This is your own account. Removing your admin role or suspending yourself is blocked by the server.
            </Caveat>
          ) : null}

          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel title="Profile" className="lg:col-span-2">
              <KeyValue
                items={[
                  {
                    label: "Name",
                    value: (
                      <span className="flex items-center gap-1.5">
                        {name}
                        {isAdmin ? <Badge tone="violet">Admin</Badge> : null}
                        {suspended ? <Badge tone="red">Suspended</Badge> : null}
                      </span>
                    ),
                  },
                  { label: "Email", value: email || "—" },
                  { label: "User id", value: <CopyValue value={str(profile.id)} label="user id" /> },
                  { label: "Signed up", value: formatDateTime(profile.created_at) },
                  { label: "Last sign-in", value: formatDateTime(auth.last_sign_in_at) },
                  {
                    label: "Email confirmed",
                    value: auth.email_confirmed_at ? formatDateTime(auth.email_confirmed_at) : "Not confirmed",
                  },
                  { label: "Profile updated", value: formatDateTime(profile.updated_at) },
                  {
                    label: "Suspended until",
                    value: suspended ? formatDateTime(auth.banned_until) : "Not suspended",
                  },
                ]}
              />
            </Panel>

            <Panel title="Entitlements" description={`Effective plan: ${str(plan.effective) || "free"}`}>
              {Object.keys(entitlements).length ? (
                <ul className="space-y-1.5 text-xs text-ink-soft">
                  <li className="flex justify-between gap-2">
                    <span>Lead allowance</span>
                    <span className="font-medium tabular-nums text-ink">{formatNumber(entitlements.lead_allowance)}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>Lists</span>
                    <span className="font-medium tabular-nums text-ink">
                      {num(entitlements.max_lists) === -1 ? "Unlimited" : formatNumber(entitlements.max_lists)}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>Seats</span>
                    <span className="font-medium tabular-nums text-ink">{formatNumber(entitlements.max_users)}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>AI features</span>
                    <span className="font-medium text-ink">{bool(entitlements.has_ai) ? "Yes" : "No"}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>Client workspaces</span>
                    <span className="font-medium text-ink">{bool(entitlements.client_workspaces) ? "Yes" : "No"}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>Plan price</span>
                    <span className="font-medium tabular-nums text-ink">
                      {formatMoney(entitlements.price_cents, str(entitlements.currency) || "INR")}/mo
                    </span>
                  </li>
                </ul>
              ) : (
                <p className="text-xs text-ink-mute">No plan row resolved for this account.</p>
              )}
            </Panel>
          </div>

          {/* Billing ---------------------------------------------------- */}
          <Panel
            title="Subscription"
            description={hasSubscription ? "The row the app reads to decide entitlements." : undefined}
            aside={
              hasSubscription && str(subscription.razorpay_subscription_id) ? (
                <Btn variant="outline" size="sm" onClick={() => setAction("sync")}>
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Reconcile with Razorpay
                </Btn>
              ) : null
            }
          >
            {hasSubscription ? (
              <KeyValue
                items={[
                  { label: "Status", value: <StatusBadge value={subscription.status} /> },
                  { label: "Plan", value: str(subscription.plan_id) },
                  { label: "Current period ends", value: formatDateTime(subscription.current_period_end) },
                  { label: "Next charge", value: formatDateTime(subscription.charge_at) },
                  {
                    label: "Cancels at cycle end",
                    value: bool(subscription.cancel_at_cycle_end) ? "Yes" : "No",
                  },
                  { label: "Cancelled at", value: subscription.cancel_at ? formatDateTime(subscription.cancel_at) : "—" },
                  {
                    label: "Razorpay subscription",
                    value: <CopyValue value={str(subscription.razorpay_subscription_id)} label="subscription id" />,
                  },
                  {
                    label: "Razorpay customer",
                    value: <CopyValue value={str(subscription.razorpay_customer_id)} label="customer id" />,
                  },
                  { label: "Last provider event", value: formatDateTime(subscription.last_event_at) },
                  { label: "Updated", value: formatDateTime(subscription.updated_at) },
                ]}
              />
            ) : (
              <p className="text-xs text-ink-mute">
                No subscription row — this account is on Free and has never started a paid checkout that completed.
              </p>
            )}
          </Panel>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Payments" description="Most recent 10">
              <DataTable
                columns={[
                  { key: "at", header: "Date", render: (row) => formatDateTime(row.created_at) },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  {
                    key: "amount",
                    header: "Amount",
                    numeric: true,
                    render: (row) => formatMoney(row.amount_cents, str(row.currency) || "INR"),
                  },
                  { key: "method", header: "Method", render: (row) => str(row.method) || "—" },
                  {
                    key: "provider",
                    header: "Razorpay id",
                    render: (row) => <CopyValue value={str(row.razorpay_payment_id)} label="payment id" />,
                  },
                ]}
                rows={payments}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[560px]"
                empty={<Nothing title="No payments" description="Nothing has been charged to this account." />}
              />
            </Panel>

            <Panel title="Invoices" description="Most recent 10">
              <DataTable
                columns={[
                  { key: "number", header: "Number", render: (row) => str(row.number) || "—" },
                  { key: "issued", header: "Issued", render: (row) => formatDateTime(row.issued_at) },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  {
                    key: "amount",
                    header: "Amount",
                    numeric: true,
                    render: (row) => formatMoney(row.amount_cents, str(row.currency) || "INR"),
                  },
                ]}
                rows={invoices}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[460px]"
                empty={<Nothing title="No invoices" description="Invoices are written when a payment is captured." />}
              />
            </Panel>
          </div>

          {checkouts.length ? (
            <Panel title="Checkout attempts" description="Last 5 — useful when a customer says payment didn't go through">
              <DataTable
                columns={[
                  { key: "created", header: "Started", render: (row) => formatDateTime(row.created_at) },
                  { key: "plan", header: "Plan", render: (row) => str(row.plan_id) },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  {
                    key: "amount",
                    header: "Amount",
                    numeric: true,
                    render: (row) => formatMoney(row.amount_cents, str(row.currency) || "INR"),
                  },
                  { key: "completed", header: "Completed", render: (row) => formatDateTime(row.completed_at) },
                ]}
                rows={checkouts}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[560px]"
                empty={<Nothing title="No checkouts" />}
              />
            </Panel>
          ) : null}

          {/* Usage ------------------------------------------------------ */}
          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel
              title="Usage this period"
              description={`Period starting ${str(usage.period_start) || "—"} · summed across owned workspaces`}
              className="lg:col-span-2"
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Leads used", value: usage.leads_used },
                  { label: "Searches", value: usage.searches },
                  { label: "Exports", value: usage.exports },
                  { label: "AI runs", value: usage.ai_runs },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-[11px] text-ink-mute">{item.label}</p>
                    <p className="font-display text-[17px] font-semibold tabular-nums text-ink">
                      {formatNumber(item.value)}
                    </p>
                  </div>
                ))}
              </div>
              {usageHistory.length ? (
                <div className="mt-3 border-t border-black/[0.05] pt-3">
                  <DataTable
                    columns={[
                      { key: "period", header: "Period", render: (row) => str(row.period_start) },
                      { key: "leads", header: "Leads", numeric: true, render: (row) => formatNumber(row.leads_used) },
                      { key: "searches", header: "Searches", numeric: true, render: (row) => formatNumber(row.searches) },
                      { key: "exports", header: "Exports", numeric: true, render: (row) => formatNumber(row.exports) },
                      { key: "ai", header: "AI runs", numeric: true, render: (row) => formatNumber(row.ai_runs) },
                    ]}
                    rows={usageHistory}
                    rowKey={(row) => str(row.period_start)}
                    minWidth="min-w-[420px]"
                    empty={<Nothing title="No usage history" />}
                  />
                </div>
              ) : null}
            </Panel>

            <Panel title="Sessions" description="Devices that have an app session row">
              {sessions.length ? (
                <ul className="space-y-2">
                  {sessions.map((session) => (
                    <li key={str(session.id)} className="border-b border-black/[0.04] pb-2 last:border-0 last:pb-0">
                      <p className="truncate text-[11px] text-ink-soft" title={str(session.user_agent)}>
                        {str(session.user_agent) || "Unknown device"}
                      </p>
                      <p className="text-[10.5px] text-ink-mute">
                        Last seen {timeAgo(session.last_seen_at)}
                        {session.revoked_at ? " · revoked" : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-mute">No recorded sessions.</p>
              )}
            </Panel>
          </div>

          {/* Workspaces -------------------------------------------------- */}
          <Panel title="Workspaces" description="Owned and joined">
            <DataTable
              columns={[
                {
                  key: "name",
                  header: "Workspace",
                  render: (row) => (
                    <Link to={`/admin/workspaces/${str(row.id)}`} className="font-medium text-ink hover:underline">
                      {str(row.name)}
                    </Link>
                  ),
                },
                {
                  key: "role",
                  header: "Relationship",
                  render: (row) => (bool(row.is_owner) ? "Owner" : str(row.member_role) || "Member"),
                },
                { key: "plan", header: "Plan", render: (row) => <StatusBadge value={row.plan_id} /> },
                { key: "kind", header: "Type", render: (row) => (bool(row.is_client) ? "Client" : "Personal") },
                { key: "members", header: "Members", numeric: true, render: (row) => formatNumber(row.member_count) },
                { key: "leads", header: "Leads stored", numeric: true, render: (row) => formatNumber(row.leads_total) },
                { key: "used", header: "Leads this period", numeric: true, render: (row) => formatNumber(row.leads_used) },
              ]}
              rows={workspaces}
              rowKey={(row) => str(row.id)}
              empty={<Nothing title="No workspaces" description="This account has no workspace membership." />}
            />
          </Panel>

          {/* Product activity -------------------------------------------- */}
          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Recent searches" description="Last 10">
              <DataTable
                columns={[
                  {
                    key: "query",
                    header: "Query",
                    render: (row) => (
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink">{str(row.query)}</p>
                        <p className="truncate text-[11px] text-ink-mute">{str(row.location) || "No location"}</p>
                      </div>
                    ),
                  },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  { key: "results", header: "Results", numeric: true, render: (row) => formatNumber(row.result_count) },
                  { key: "at", header: "When", render: (row) => timeAgo(row.created_at) },
                ]}
                rows={searches}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[520px]"
                empty={<Nothing title="No searches" description="This customer hasn't run a search yet." />}
              />
            </Panel>

            <Panel title="Exports and AI" description="Last 10 of each">
              <DataTable
                columns={[
                  { key: "file", header: "Export", render: (row) => str(row.file_name) || "—" },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  { key: "leads", header: "Leads", numeric: true, render: (row) => formatNumber(row.lead_count) },
                  { key: "at", header: "When", render: (row) => timeAgo(row.created_at) },
                ]}
                rows={exportRows}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[440px]"
                empty={<Nothing title="No exports" />}
              />
              <div className="mt-3 border-t border-black/[0.05] pt-3">
                <DataTable
                  columns={[
                    { key: "kind", header: "AI request", render: (row) => str(row.kind) },
                    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                    { key: "model", header: "Model", render: (row) => str(row.model) || "—" },
                    { key: "at", header: "When", render: (row) => timeAgo(row.created_at) },
                  ]}
                  rows={aiRequests}
                  rowKey={(row) => str(row.id)}
                  minWidth="min-w-[440px]"
                  empty={<Nothing title="No AI requests" />}
                />
              </div>
            </Panel>
          </div>

          {/* Activity + admin trail --------------------------------------- */}
          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Activity log" description="What the customer did, newest first">
              {activity.length ? (
                <ul className="space-y-2">
                  {activity.map((entry) => (
                    <li key={str(entry.id)} className="flex items-start justify-between gap-3 border-b border-black/[0.04] pb-2 last:border-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-ink-soft">{str(entry.text)}</p>
                        <p className="text-[10.5px] text-ink-mute">{str(entry.kind)}</p>
                      </div>
                      <span className="shrink-0 text-[10.5px] text-ink-mute">{timeAgo(entry.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-mute">No recorded activity.</p>
              )}
            </Panel>

            <Panel title="Admin actions on this account" description="From the immutable audit log">
              {adminActions.length ? (
                <ul className="space-y-2">
                  {adminActions.map((entry) => (
                    <li key={str(entry.id)} className="border-b border-black/[0.04] pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-ink">{str(entry.action)}</span>
                        <StatusBadge value={entry.result} />
                      </div>
                      <p className="truncate text-[11px] text-ink-mute">{str(entry.summary)}</p>
                      <p className="text-[10.5px] text-neutral-400">
                        {str(entry.admin_email)} · {formatDateTime(entry.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-mute">No administrator has changed this account.</p>
              )}
            </Panel>
          </div>
        </div>
      )}

      <ActionDialog
        open={action !== null}
        onClose={() => {
          setAction(null);
          setActionError(null);
        }}
        onConfirm={run}
        busy={busy}
        error={actionError}
        title={action ? dialogCopy[action].title : ""}
        description={action ? dialogCopy[action].description : undefined}
        confirmLabel={action ? dialogCopy[action].confirm : "Confirm"}
        danger={action ? dialogCopy[action].danger : false}
      />
    </AdminLayout>
  );
}
