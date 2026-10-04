/* ------------------------------------------------------------------ */
/* /admin/usage — quota administration                                 */
/*                                                                     */
/* Everything here reads `usage_counters`, the table reserve_leads()   */
/* reserves against. That is the only accounting source in the         */
/* product, so the console and the customer's own usage page can never */
/* disagree.                                                           */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Gauge } from "lucide-react";
import { adminPost, AdminRequestError, useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  ActionDialog,
  Caveat,
  DataTable,
  DebouncedSearch,
  ErrorState,
  FilterSelect,
  Nothing,
  PagerBar,
  Panel,
  Stat,
  StatGrid,
  StatusBadge,
  formatNumber,
  useFilters,
} from "../components";
import { arr, num, obj, str, type Row } from "../shape";
import { Btn, FieldLabel, Input, useToast } from "../../components/ui";

export function AdminUsage({ identity }: { identity: AdminIdentity }) {
  const toast = useToast();
  const { get, set, page, setPage } = useFilters();

  const query = useAdminData<Row>("usage", {
    period: get("period"),
    plan: get("plan"),
    state: get("state"),
    q: get("q"),
    page,
    pageSize: 25,
  });

  const totals = obj(query.data?.totals);
  const rows = arr(query.data?.rows);
  const byPlan = arr(query.data?.by_plan);
  const history = arr(query.data?.history);
  const total = num(query.data?.total);
  const period = str(query.data?.period_start);

  const [target, setTarget] = useState<Row | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function applyOverride(reason: string) {
    if (!target) return;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setActionError("Enter a whole number of leads (0 or more).");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await adminPost("usage/override", {
        workspaceId: str(target.workspace_id),
        period: str(target.period_start) || period,
        leadsUsed: parsed,
        reason,
        confirm: true,
      });
      toast("Quota updated.", "success");
      setTarget(null);
      query.refresh();
    } catch (caught) {
      setActionError(
        caught instanceof AdminRequestError ? caught.message : "That change couldn't be applied. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const periodOptions = [
    { value: "", label: "Current period" },
    ...history
      .map((row) => str(row.period_start))
      .filter(Boolean)
      .reverse()
      .map((value) => ({ value, label: value })),
  ].filter((option, index, all) => all.findIndex((candidate) => candidate.value === option.value) === index);

  return (
    <AdminLayout
      identity={identity}
      title="Usage"
      description={`Metered consumption per workspace for the period starting ${period || "—"}.`}
      aside={
        <FilterSelect
          label="Billing period"
          value={get("period")}
          options={periodOptions}
          onChange={(value) => set({ period: value })}
          width="w-[160px]"
        />
      }
    >
      {query.error ? (
        <ErrorState message={query.error} onRetry={query.refresh} />
      ) : (
        <div className="space-y-2.5">
          <StatGrid>
            <Stat
              label="Leads metered"
              value={formatNumber(totals.leads_used)}
              hint={`of ${formatNumber(totals.allowance)} granted by plans`}
              loading={query.initial}
            />
            <Stat label="Workspaces consuming" value={formatNumber(totals.active)} loading={query.initial} />
            <Stat
              label="Near the limit (80%+)"
              value={formatNumber(totals.near_limit)}
              tone={num(totals.near_limit) > 0 ? "warn" : "default"}
              loading={query.initial}
            />
            <Stat
              label="Exhausted"
              value={formatNumber(totals.exhausted)}
              tone={num(totals.exhausted) > 0 ? "danger" : "default"}
              loading={query.initial}
            />
          </StatGrid>

          <Panel title="By plan" description="Consumption of this period, grouped by effective plan">
            <DataTable
              columns={[
                { key: "plan", header: "Plan", render: (row) => <StatusBadge value={row.plan_id} /> },
                { key: "workspaces", header: "Workspaces", numeric: true, render: (row) => formatNumber(row.workspaces) },
                { key: "leads", header: "Leads", numeric: true, render: (row) => formatNumber(row.leads_used) },
                { key: "searches", header: "Searches", numeric: true, render: (row) => formatNumber(row.searches) },
                { key: "exports", header: "Exports", numeric: true, render: (row) => formatNumber(row.exports) },
                { key: "ai", header: "AI runs", numeric: true, render: (row) => formatNumber(row.ai_runs) },
              ]}
              rows={byPlan}
              loading={query.loading}
              rowKey={(row) => str(row.plan_id)}
              minWidth="min-w-[620px]"
              empty={<Nothing title="Nothing metered yet" description="No workspace has consumed quota this period." />}
            />
          </Panel>

          <Panel
            title={`${formatNumber(total)} workspaces`}
            description="Ordered by consumption. Adjusting a quota writes the same counter searches reserve against."
            aside={
              <div className="flex flex-wrap items-center gap-1.5">
                <DebouncedSearch
                  value={get("q")}
                  placeholder="Workspace or owner"
                  onChange={(value) => set({ q: value })}
                />
                <FilterSelect
                  label="Plan"
                  value={get("plan")}
                  width="w-[120px]"
                  options={[
                    { value: "", label: "All plans" },
                    { value: "free", label: "Free" },
                    { value: "growth", label: "Growth" },
                    { value: "agency", label: "Agency" },
                    { value: "scale", label: "Scale" },
                  ]}
                  onChange={(value) => set({ plan: value })}
                />
                <FilterSelect
                  label="State"
                  value={get("state")}
                  width="w-[145px]"
                  options={[
                    { value: "", label: "Any state" },
                    { value: "active", label: "Used something" },
                    { value: "near", label: "80–99% used" },
                    { value: "exhausted", label: "At or over limit" },
                  ]}
                  onChange={(value) => set({ state: value })}
                />
              </div>
            }
          >
            <DataTable
              columns={[
                {
                  key: "workspace",
                  header: "Workspace",
                  render: (row) => (
                    <div className="min-w-0">
                      <Link
                        to={`/admin/workspaces/${str(row.workspace_id)}`}
                        className="truncate text-xs font-medium text-ink hover:underline"
                      >
                        {str(row.workspace_name) || "Unnamed workspace"}
                      </Link>
                      <p className="truncate text-[11px] text-ink-mute">
                        {str(row.owner_name) || str(row.owner_email) || "No owner"}
                      </p>
                    </div>
                  ),
                },
                { key: "plan", header: "Plan", render: (row) => <StatusBadge value={row.plan_id} /> },
                {
                  key: "leads",
                  header: "Leads used",
                  numeric: true,
                  render: (row) => (
                    <span>
                      {formatNumber(row.leads_used)}
                      <span className="text-ink-mute"> / {formatNumber(row.lead_allowance)}</span>
                    </span>
                  ),
                },
                {
                  key: "pct",
                  header: "Used",
                  numeric: true,
                  render: (row) => {
                    const pct = num(row.used_pct);
                    return (
                      <span
                        className={
                          pct >= 100 ? "font-medium text-red-600" : pct >= 80 ? "font-medium text-amber-700" : undefined
                        }
                      >
                        {pct}%
                      </span>
                    );
                  },
                },
                { key: "searches", header: "Searches", numeric: true, render: (row) => formatNumber(row.searches) },
                { key: "exports", header: "Exports", numeric: true, render: (row) => formatNumber(row.exports) },
                { key: "ai", header: "AI runs", numeric: true, render: (row) => formatNumber(row.ai_runs) },
                {
                  key: "actions",
                  header: "",
                  render: (row) => (
                    <Btn
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTarget(row);
                        setValue(String(num(row.leads_used)));
                        setActionError(null);
                      }}
                    >
                      <Gauge className="size-3" aria-hidden="true" />
                      Adjust
                    </Btn>
                  ),
                },
              ]}
              rows={rows}
              loading={query.loading}
              rowKey={(row) => str(row.workspace_id)}
              minWidth="min-w-[960px]"
              empty={
                <Nothing
                  title="No workspaces match"
                  description="Try another period or clear the filters — a period with no usage simply has no rows."
                />
              }
            />
            <PagerBar page={page} pageSize={num(query.data?.pageSize) || 25} total={total} onPage={setPage} />
          </Panel>

          <Caveat>
            Allowances come from the plan, consumption from <code>usage_counters</code>. An adjustment changes only the
            consumed figure for the chosen period; metering continues normally afterwards, and the change is recorded in
            the audit log with the reason you give.
          </Caveat>
        </div>
      )}

      <ActionDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={applyOverride}
        busy={busy}
        error={actionError}
        title="Adjust metered leads"
        description={
          target
            ? `${str(target.workspace_name)} · period starting ${str(target.period_start) || period}`
            : undefined
        }
        confirmLabel="Apply adjustment"
      >
        <div>
          <FieldLabel htmlFor="usage-value">Leads used after the adjustment</FieldLabel>
          <Input
            id="usage-value"
            type="number"
            min={0}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {target ? (
            <p className="mt-1 text-[11px] text-ink-mute">
              Currently {formatNumber(target.leads_used)} of {formatNumber(target.lead_allowance)} leads.
            </p>
          ) : null}
        </div>
      </ActionDialog>
    </AdminLayout>
  );
}
