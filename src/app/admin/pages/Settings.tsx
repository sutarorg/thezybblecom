/* ------------------------------------------------------------------ */
/* /admin/settings — who may use this console                          */
/*                                                                     */
/* Role management only. There is deliberately no secret manager here: */
/* API keys live in the host's environment, are read by the server,    */
/* and must never be viewable or editable from a browser session.      */
/* ------------------------------------------------------------------ */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { adminPost, AdminRequestError, useAdminData } from "../client";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import {
  ActionDialog,
  Caveat,
  DataTable,
  DebouncedSearch,
  ErrorState,
  Nothing,
  Panel,
  formatDateTime,
  timeAgo,
  useFilters,
} from "../components";
import { arr, bool, obj, str, type Row } from "../shape";
import { Badge, Btn, useToast } from "../../components/ui";

const CAPABILITY_COPY: Record<string, { label: string; yes: string; no: string }> = {
  roleManagement: {
    label: "Grant and revoke admin",
    yes: "Writes profiles.role through a guarded function that refuses to remove the last administrator.",
    no: "Unavailable on this deployment.",
  },
  suspendAccounts: {
    label: "Suspend accounts",
    yes: "Uses Supabase Auth bans, so sign-in and token refresh are actually blocked.",
    no: "Unavailable on this deployment.",
  },
  planEditing: {
    label: "Edit plan entitlements",
    yes: "Writes the plans table the quota functions read.",
    no: "Unavailable on this deployment.",
  },
  quotaOverride: {
    label: "Adjust metered usage",
    yes: "Writes usage_counters — the same counter searches reserve against.",
    no: "Unavailable on this deployment.",
  },
  subscriptionSync: {
    label: "Reconcile with Razorpay",
    yes: "Reads a subscription from the provider and stores the result.",
    no: "Razorpay credentials aren't configured on the server.",
  },
  webhookReplay: {
    label: "Replay webhooks",
    yes: "Available.",
    no: "Not possible: the signature is computed over the original request body, which isn't stored, so a replay couldn't be authenticated.",
  },
  impersonation: {
    label: "Sign in as a customer",
    yes: "Available.",
    no: "Not offered on purpose — the read-only customer 360 answers support questions without borrowing someone's identity.",
  },
  featureFlags: {
    label: "Feature flags",
    yes: "Available.",
    no: "Zybble has no flag system; a toggle here would control nothing.",
  },
  maintenanceMode: {
    label: "Maintenance mode",
    yes: "Available.",
    no: "No part of the app reads a maintenance switch, so the control would be decorative.",
  },
};

export function AdminSettings({ identity }: { identity: AdminIdentity }) {
  const toast = useToast();
  const { get, set } = useFilters();
  const settings = useAdminData<Row>("settings");
  const search = get("q");
  const candidates = useAdminData<Row>("users", { q: search, pageSize: 5 }, search.length > 1);

  const admins = arr(settings.data?.admins);
  const recentChanges = arr(settings.data?.recentRoleChanges);
  const capabilities = obj(settings.data?.capabilities);

  const [target, setTarget] = useState<{ id: string; name: string; grant: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function apply(reason: string) {
    if (!target) return;
    setBusy(true);
    setActionError(null);
    try {
      await adminPost(`users/${target.id}/role`, {
        role: target.grant ? "admin" : "user",
        reason,
        confirm: true,
      });
      toast(target.grant ? "Admin access granted." : "Admin access removed.", "success");
      setTarget(null);
      settings.refresh();
      candidates.refresh();
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
      title="Settings"
      description="Administrator roster and what this console is able to do."
    >
      {settings.error ? (
        <ErrorState message={settings.error} onRetry={settings.refresh} />
      ) : (
        <div className="space-y-2.5">
          <Panel title="Administrators" description="Accounts with profiles.role = 'admin'">
            <DataTable
              columns={[
                {
                  key: "name",
                  header: "Administrator",
                  render: (row) => (
                    <Link to={`/admin/users/${str(row.id)}`} className="min-w-0 hover:underline">
                      <p className="truncate text-xs font-medium text-ink">
                        {str(row.name) || "Unnamed"}
                        {str(row.id) === identity.id ? " (you)" : ""}
                      </p>
                      <p className="truncate text-[11px] text-ink-mute">{str(row.email)}</p>
                    </Link>
                  ),
                },
                { key: "since", header: "Account created", render: (row) => formatDateTime(row.created_at) },
                { key: "seen", header: "Last sign-in", render: (row) => timeAgo(row.last_sign_in_at) },
                {
                  key: "state",
                  header: "State",
                  render: (row) => (row.banned_until ? <Badge tone="red">Suspended</Badge> : <Badge tone="green">Active</Badge>),
                },
                {
                  key: "actions",
                  header: "",
                  render: (row) => (
                    <Btn
                      variant="outline"
                      size="sm"
                      disabled={str(row.id) === identity.id}
                      title={str(row.id) === identity.id ? "You can't remove your own access" : undefined}
                      onClick={() => {
                        setActionError(null);
                        setTarget({ id: str(row.id), name: str(row.name) || str(row.email), grant: false });
                      }}
                    >
                      <ShieldOff className="size-3" aria-hidden="true" />
                      Revoke
                    </Btn>
                  ),
                },
              ]}
              rows={admins}
              loading={settings.loading}
              rowKey={(row) => str(row.id)}
              minWidth="min-w-[720px]"
              empty={<Nothing title="No administrators" description="At least one account must hold the admin role." />}
            />
          </Panel>

          <Panel
            title="Grant admin access"
            description="Find an existing account and promote it. The server refuses to remove the last administrator."
            aside={
              <DebouncedSearch
                value={search}
                placeholder="Search name or email"
                onChange={(value) => set({ q: value })}
              />
            }
          >
            {search.length > 1 ? (
              <DataTable
                columns={[
                  {
                    key: "name",
                    header: "Account",
                    render: (row) => (
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink">{str(row.name) || "Unnamed"}</p>
                        <p className="truncate text-[11px] text-ink-mute">{str(row.email)}</p>
                      </div>
                    ),
                  },
                  {
                    key: "role",
                    header: "Role",
                    render: (row) =>
                      str(row.role) === "admin" ? <Badge tone="violet">Admin</Badge> : <Badge>Customer</Badge>,
                  },
                  {
                    key: "actions",
                    header: "",
                    render: (row) =>
                      str(row.role) === "admin" ? (
                        <span className="text-[11px] text-ink-mute">Already an administrator</span>
                      ) : (
                        <Btn
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setActionError(null);
                            setTarget({ id: str(row.id), name: str(row.name) || str(row.email), grant: true });
                          }}
                        >
                          <ShieldCheck className="size-3" aria-hidden="true" />
                          Make admin
                        </Btn>
                      ),
                  },
                ]}
                rows={arr(candidates.data?.rows)}
                loading={candidates.loading}
                rowKey={(row) => str(row.id)}
                minWidth="min-w-[560px]"
                empty={<Nothing title="No matching accounts" description="Search by name or email address." />}
              />
            ) : (
              <p className="text-xs text-ink-mute">Type at least two characters to search for an account.</p>
            )}
          </Panel>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <Panel title="Recent role changes" description="From the audit log">
              {recentChanges.length ? (
                <ul className="space-y-2">
                  {recentChanges.map((entry) => (
                    <li key={str(entry.id)} className="border-b border-black/[0.04] pb-2 last:border-0 last:pb-0">
                      <p className="text-xs text-ink">{str(entry.summary)}</p>
                      <p className="text-[10.5px] text-ink-mute">
                        {str(entry.target_label) || "—"} · by {str(entry.admin_email)} ·{" "}
                        {formatDateTime(entry.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-mute">No role changes have been made from this console yet.</p>
              )}
            </Panel>

            <Panel title="What this console can do" description="Reported by the server, not hard-coded in the UI">
              <ul className="space-y-2">
                {Object.entries(CAPABILITY_COPY).map(([key, copy]) => {
                  const enabled = bool(capabilities[key]);
                  return (
                    <li key={key} className="border-b border-black/[0.04] pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-ink">{copy.label}</span>
                        {enabled ? <Badge tone="green">Available</Badge> : <Badge>Not available</Badge>}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-4 text-ink-mute">{enabled ? copy.yes : copy.no}</p>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>

          <Caveat>
            API keys and provider secrets are not editable here and never will be: they live in the host's environment
            variables, are read only by server code, and are reported in System as present or missing. Anything that
            could expose a secret value to a browser session would defeat the point of this architecture.
          </Caveat>
        </div>
      )}

      <ActionDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={apply}
        busy={busy}
        error={actionError}
        danger={target ? !target.grant : false}
        title={target?.grant ? "Grant admin access" : "Remove admin access"}
        description={
          target
            ? target.grant
              ? `${target.name} will be able to read and change every tenant's data in this console.`
              : `${target.name} keeps their normal account but loses the console.`
            : undefined
        }
        confirmLabel={target?.grant ? "Grant admin" : "Remove admin"}
      />
    </AdminLayout>
  );
}
