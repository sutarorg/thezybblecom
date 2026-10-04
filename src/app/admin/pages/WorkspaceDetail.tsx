/* ------------------------------------------------------------------ */
/* /admin/workspaces/:id — workspace 360                               */
/*                                                                     */
/* The quota override here writes usage_counters — the exact table     */
/* reserve_leads() meters against — so the console can never show a    */
/* different "used" number than the customer's own usage page.         */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Gauge, RefreshCw } from "lucide-react";
import { adminPost, AdminRequestError, useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  ActionDialog,
  CopyValue,
  CountChips,
  DataTable,
  DistributionBar,
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
import { arr, bool, counts, num, obj, str } from "../shape";
import { Badge, Btn, FieldLabel, Input, useToast } from "../../components/ui";

export function AdminWorkspaceDetail({ identity }: { identity: AdminIdentity }) {
  const { id = "" } = useParams();
  const toast = useToast();
  const query = useAdminData<Record<string, unknown>>(`workspaces/${id}`);

  const workspace = obj(query.data?.workspace);
  const entitlements = obj(workspace.entitlements);
  const owner = obj(query.data?.owner);
  const members = arr(query.data?.members);
  const invitations = arr(query.data?.invitations);
  const usage = obj(query.data?.usage);
  const current = obj(usage.current);
  const history = arr(usage.history);
  const searches = obj(query.data?.searches);
  const jobs = arr(query.data?.jobs);
  const leads = obj(query.data?.leads);
  const lists = obj(query.data?.lists);
  const exportRows = arr(query.data?.exports);
  const ai = obj(query.data?.ai);
  const activity = arr(query.data?.activity);
  const adminActions = arr(query.data?.admin_actions);

  const allowance = num(entitlements.lead_allowance);
  const used = num(current.leads_used);
  const pct = allowance > 0 ? Math.min(999, Math.round((used / allowance) * 100)) : 0;

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideValue, setOverrideValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function applyOverride(reason: string) {
    const parsed = Number(overrideValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setActionError("Enter the number of leads that should count as used — a whole number of 0 or more.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await adminPost("usage/override", {
        workspaceId: id,
        period: str(current.period_start),
        leadsUsed: parsed,
        reason,
        confirm: true,
      });
      toast("Quota updated.", "success");
      setOverrideOpen(false);
      query.refresh();
    } catch (caught) {
      setActionError(
        caught instanceof AdminRequestError ? caught.message : "That change couldn't be applied. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout
      identity={identity}
      title={query.initial ? "Workspace" : str(workspace.name) || "Workspace"}
      description="Members, quota, search and AI history for one tenant workspace."
      aside={
        <div className="flex flex-wrap items-center gap-1.5">
          <LinkBtn to="/admin/workspaces" variant="ghost">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            All workspaces
          </LinkBtn>
          <Btn variant="outline" size="sm" onClick={query.refresh} disabled={query.loading}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Refresh
          </Btn>
          {!query.initial && !query.error ? (
            <Btn
              variant="outline"
              size="sm"
              onClick={() => {
                setOverrideValue(String(used));
                setActionError(null);
                setOverrideOpen(true);
              }}
            >
              <Gauge className="size-3.5" aria-hidden="true" />
              Adjust quota
            </Btn>
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
          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel title="Workspace" className="lg:col-span-2">
              <KeyValue
                items={[
                  {
                    label: "Name",
                    value: (
                      <span className="flex items-center gap-1.5">
                        {str(workspace.name)}
                        {bool(workspace.is_client) ? <Badge tone="sky">Client</Badge> : null}
                      </span>
                    ),
                  },
                  { label: "Workspace id", value: <CopyValue value={str(workspace.id)} label="workspace id" /> },
                  {
                    label: "Owner",
                    value: owner.id ? (
                      <Link to={`/admin/users/${str(owner.id)}`} className="text-ink hover:underline">
                        {str(owner.name) || str(owner.email) || "Unnamed"}
                      </Link>
                    ) : (
                      "—"
                    ),
                  },
                  { label: "Owner email", value: str(owner.email) || "—" },
                  {
                    label: "Owner subscription",
                    value: owner.subscription_status ? <StatusBadge value={owner.subscription_status} /> : "None",
                  },
                  { label: "Created", value: formatDateTime(workspace.created_at) },
                  {
                    label: "Effective plan",
                    value: (
                      <span className="flex items-center gap-1.5">
                        <StatusBadge value={workspace.plan_id} />
                        {str(workspace.stored_plan_id) !== str(workspace.plan_id) ? (
                          <span className="text-[10.5px] text-ink-mute">
                            (row says {str(workspace.stored_plan_id) || "—"})
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    label: "Plan price",
                    value: `${formatMoney(entitlements.price_cents, str(entitlements.currency) || "INR")}/mo`,
                  },
                ]}
              />
            </Panel>

            <Panel title="Quota this period" description={`Period starting ${str(current.period_start) || "—"}`}>
              <div className="flex items-end justify-between gap-2">
                <p className="font-display text-[22px] font-semibold tabular-nums text-ink">{formatNumber(used)}</p>
                <p className="text-[11px] text-ink-mute">
                  of {allowance > 0 ? formatNumber(allowance) : "—"} leads
                </p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.07]">
                <div
                  className={
                    pct >= 100 ? "h-full rounded-full bg-red-500" : pct >= 80 ? "h-full rounded-full bg-amber-500" : "h-full rounded-full bg-brand-600"
                  }
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-ink-mute">{allowance > 0 ? `${pct}% used` : "No allowance on this plan"}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-black/[0.05] pt-3 text-center">
                {[
                  { label: "Searches", value: current.searches },
                  { label: "Exports", value: current.exports },
                  { label: "AI runs", value: current.ai_runs },
                ].map((item) => (
                  <div key={item.label}>
                    <dt className="text-[10.5px] text-ink-mute">{item.label}</dt>
                    <dd className="text-[14px] font-semibold tabular-nums text-ink">{formatNumber(item.value)}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title={`Members (${members.length})`}>
              <DataTable
                columns={[
                  {
                    key: "name",
                    header: "Member",
                    render: (row) => (
                      <Link to={`/admin/users/${str(row.user_id)}`} className="min-w-0 hover:underline">
                        <p className="truncate text-xs font-medium text-ink">{str(row.name) || "Unnamed"}</p>
                        <p className="truncate text-[11px] text-ink-mute">{str(row.email)}</p>
                      </Link>
                    ),
                  },
                  {
                    key: "role",
                    header: "Role",
                    render: (row) => (
                      <span className="flex items-center gap-1.5">
                        <StatusBadge value={row.role} />
                        {bool(row.is_owner) ? <Badge tone="green">Owner</Badge> : null}
                      </span>
                    ),
                  },
                  { key: "joined", header: "Joined", render: (row) => timeAgo(row.created_at) },
                ]}
                rows={members}
                rowKey={(row) => str(row.user_id)}
                minWidth="min-w-[420px]"
                empty={<Nothing title="No members" description="Only the owner has access." />}
              />
            </Panel>

            <Panel title="Invitations" description="Last 20">
              <DataTable
                columns={[
                  { key: "email", header: "Email", render: (row) => str(row.email) },
                  { key: "role", header: "Role", render: (row) => str(row.role) },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  { key: "sent", header: "Sent", render: (row) => timeAgo(row.created_at) },
                ]}
                rows={invitations}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[420px]"
                empty={<Nothing title="No invitations" />}
              />
            </Panel>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-3">
            <Panel title="Lead inventory" description={`${formatNumber(leads.total)} leads stored`}>
              <DistributionBar
                items={[
                  { label: "With email", value: num(leads.with_email) },
                  { label: "With phone", value: num(leads.with_phone) },
                  { label: "With website", value: num(leads.with_website) },
                ]}
                total={num(leads.total) || undefined}
              />
              <div className="mt-3 space-y-2 border-t border-black/[0.05] pt-3">
                <div>
                  <p className="mb-1 text-[11px] text-ink-mute">By status</p>
                  <CountChips counts={counts(leads.by_status)} />
                </div>
                <div>
                  <p className="mb-1 text-[11px] text-ink-mute">By business size</p>
                  <CountChips counts={counts(leads.by_business_size)} />
                </div>
              </div>
            </Panel>

            <Panel title="Search outcomes" description="All time, by status">
              <CountChips counts={counts(searches.by_status)} />
              <div className="mt-3 border-t border-black/[0.05] pt-3">
                <p className="mb-1 text-[11px] text-ink-mute">Lists</p>
                <p className="text-xs text-ink">{formatNumber(lists.count)} lists</p>
                <ul className="mt-1.5 space-y-1">
                  {arr(lists.top).map((list) => (
                    <li key={str(list.id)} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-ink-soft">{str(list.name)}</span>
                      <span className="tabular-nums text-ink-mute">{formatNumber(list.size)}</span>
                    </li>
                  ))}
                  {!arr(lists.top).length ? <li className="text-[11px] text-ink-mute">No lists yet.</li> : null}
                </ul>
              </div>
            </Panel>

            <Panel title="AI usage" description={`${formatNumber(ai.total)} requests · ${formatNumber(ai.failed)} failed`}>
              {arr(ai.recent).length ? (
                <ul className="space-y-1.5">
                  {arr(ai.recent).map((request) => (
                    <li key={str(request.id)} className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] text-ink-soft">
                        {str(request.kind)} · {str(request.model) || "unknown model"}
                      </span>
                      <StatusBadge value={request.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-mute">No AI requests from this workspace.</p>
              )}
            </Panel>
          </div>

          <Panel title="Recent searches" description="Last 20">
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
                { key: "user", header: "Run by", render: (row) => str(row.user_name) || "—" },
                { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                { key: "requested", header: "Requested", numeric: true, render: (row) => formatNumber(row.requested_count) },
                { key: "results", header: "Results", numeric: true, render: (row) => formatNumber(row.result_count) },
                {
                  key: "error",
                  header: "Error",
                  render: (row) =>
                    str(row.error) ? (
                      <span className="text-[11px] text-red-600" title={str(row.error)}>
                        {str(row.error).slice(0, 48)}
                      </span>
                    ) : (
                      "—"
                    ),
                },
                { key: "at", header: "When", render: (row) => timeAgo(row.created_at) },
              ]}
              rows={arr(searches.recent)}
              rowKey={(row) => str(row.id)}
              minWidth="min-w-[860px]"
              empty={<Nothing title="No searches" description="This workspace hasn't run a search yet." />}
            />
          </Panel>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Search jobs" description="Last 10 background jobs">
              <DataTable
                columns={[
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  { key: "stage", header: "Stage", render: (row) => str(row.current_stage) || "—" },
                  {
                    key: "progress",
                    header: "Processed",
                    numeric: true,
                    render: (row) => `${formatNumber(row.processed_count)} / ${formatNumber(row.requested_count)}`,
                  },
                  { key: "at", header: "Started", render: (row) => timeAgo(row.created_at) },
                ]}
                rows={jobs}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[440px]"
                empty={<Nothing title="No jobs" />}
              />
            </Panel>

            <Panel title="Exports" description="Last 10">
              <DataTable
                columns={[
                  { key: "file", header: "File", render: (row) => str(row.file_name) || "—" },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  { key: "leads", header: "Leads", numeric: true, render: (row) => formatNumber(row.lead_count) },
                  { key: "at", header: "When", render: (row) => timeAgo(row.created_at) },
                ]}
                rows={exportRows}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[440px]"
                empty={<Nothing title="No exports" />}
              />
            </Panel>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Usage history" description="Up to 12 periods, from usage_counters">
              <DataTable
                columns={[
                  { key: "period", header: "Period", render: (row) => str(row.period_start) },
                  { key: "leads", header: "Leads", numeric: true, render: (row) => formatNumber(row.leads_used) },
                  { key: "searches", header: "Searches", numeric: true, render: (row) => formatNumber(row.searches) },
                  { key: "exports", header: "Exports", numeric: true, render: (row) => formatNumber(row.exports) },
                  { key: "ai", header: "AI runs", numeric: true, render: (row) => formatNumber(row.ai_runs) },
                ]}
                rows={history}
                rowKey={(row) => str(row.period_start)}
                minWidth="min-w-[440px]"
                empty={<Nothing title="No metered usage yet" />}
              />
            </Panel>

            <Panel title="Activity" description="Last 25 workspace events">
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
          </div>

          {adminActions.length ? (
            <Panel title="Admin actions on this workspace">
              <ul className="space-y-2">
                {adminActions.map((entry) => (
                  <li key={str(entry.id)} className="border-b border-black/[0.04] pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink">{str(entry.action)}</span>
                      <StatusBadge value={entry.result} />
                    </div>
                    <p className="text-[11px] text-ink-mute">{str(entry.summary)}</p>
                    <p className="text-[10.5px] text-neutral-400">
                      {str(entry.admin_email)} · {formatDateTime(entry.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      )}

      <ActionDialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        onConfirm={applyOverride}
        busy={busy}
        error={actionError}
        title="Adjust metered leads"
        description={`Sets usage_counters.leads_used for the period starting ${str(current.period_start) || "this month"}. This is the counter searches reserve against, so the customer sees the same number immediately.`}
        confirmLabel="Apply adjustment"
      >
        <div>
          <FieldLabel htmlFor="quota-value">Leads used after the adjustment</FieldLabel>
          <Input
            id="quota-value"
            type="number"
            min={0}
            value={overrideValue}
            onChange={(event) => setOverrideValue(event.target.value)}
          />
          <p className="mt-1 text-[11px] text-ink-mute">
            Currently {formatNumber(used)} of {allowance > 0 ? formatNumber(allowance) : "—"} leads.
          </p>
        </div>
      </ActionDialog>
    </AdminLayout>
  );
}
