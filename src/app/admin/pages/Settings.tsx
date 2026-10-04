/* ------------------------------------------------------------------ */
/* /admin/settings — who can operate this console, and an honest       */
/* statement of what the console deliberately does NOT do.             */
/*                                                                     */
/* This is NOT a secret manager: no environment value is readable      */
/* here. Admin access is granted by changing profiles.role on the      */
/* customer record, which is audited.                                  */
/* ------------------------------------------------------------------ */
import { useNavigate } from "react-router-dom";
import { RotateCw, ShieldCheck } from "lucide-react";
import { Badge, Btn, Card } from "../../components/ui";
import { useAdminResource } from "../client";
import { ErrorPanel, Mono, PageHead, Section, StatusBadge, ago, dateOnly, full } from "../ui";

type Admin = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  status: string | null;
  plan_id: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
};

type AccessChange = {
  id: string;
  admin_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string | null;
  created_at: string;
};

type Response = {
  admins: Admin[];
  recentAccessChanges: AccessChange[];
  capabilities: Record<string, boolean>;
  notes: Record<string, string>;
};

const CAPABILITY_LABELS: Record<string, string> = {
  featureFlags: "Feature flags",
  maintenanceMode: "Maintenance mode",
  impersonation: "Log in as customer",
  webhookRetry: "Webhook replay",
};

export function AdminSettings() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAdminResource<Response>("settings");

  if (error) {
    return (
      <>
        <PageHead title="Admin settings" />
        <ErrorPanel message={error} onRetry={reload} />
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Admin settings"
        description="Console access and capability status. No credential or environment value is readable from this page."
        actions={
          <Btn variant="outline" size="sm" onClick={reload} label="Refresh">
            <RotateCw className="size-3.5" aria-hidden="true" />
          </Btn>
        }
      />

      <div className="space-y-6">
        <Section
          title="Administrators"
          description="Accounts whose profiles.role is 'admin'. This is the only thing that grants access — the server re-checks it on every single /api/admin request."
        >
          <Card className="min-w-0 overflow-hidden">
            {loading ? (
              <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-mute">Loading…</p>
            ) : data?.admins.length ? (
              <ul className="divide-y divide-black/[0.05]">
                {data.admins.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
                    <ShieldCheck className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-ink">{a.name || a.email || a.id}</p>
                      <p className="truncate text-[11px] text-ink-mute">{a.email}</p>
                    </div>
                    {a.status ? <StatusBadge value={a.status} /> : null}
                    <span className="shrink-0 text-[11px] text-neutral-400">since {dateOnly(a.created_at)}</span>
                    <Btn variant="ghost" size="sm" onClick={() => navigate(`/admin/users/${a.id}`)}>
                      Open
                    </Btn>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-mute">No admin accounts found.</p>
            )}
          </Card>
          <p className="mt-2 text-[11.5px] leading-5 text-ink-mute">
            To grant or revoke access, open the customer at <span className="font-medium text-ink">/admin/users/:id</span> and
            change their role. The change is blocked for non-admins by a database trigger and is written to the audit log with
            the previous and new value.
          </p>
        </Section>

        <Section title="Recent access changes" description="Role changes, suspensions and reactivations.">
          <Card className="min-w-0 overflow-hidden">
            {data?.recentAccessChanges?.length ? (
              <ul className="divide-y divide-black/[0.05] text-[12px]">
                {data.recentAccessChanges.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
                    <span className="shrink-0 font-medium text-ink">{c.action.replace(/[._]/g, " ")}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{c.summary ?? "—"}</span>
                    <span className="shrink-0 text-[11px] text-ink-mute">by {c.admin_email ?? "unknown"}</span>
                    <span className="shrink-0 text-[11px] text-neutral-400">{ago(c.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-mute">
                {loading ? "Loading…" : "No access changes recorded yet."}
              </p>
            )}
          </Card>
          <div className="mt-2">
            <Btn variant="outline" size="sm" onClick={() => navigate("/admin/audit-logs")}>
              View the full audit log
            </Btn>
          </div>
        </Section>

        <Section
          title="Capabilities deliberately not offered"
          description="Each of these would require real infrastructure that does not exist in this codebase. A toggle that changed nothing would be worse than its absence, so the reason is stated instead."
        >
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {Object.entries(data?.notes ?? {}).map(([key, note]) => (
              <Card key={key} className="min-w-0 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12.5px] font-medium text-ink">{CAPABILITY_LABELS[key] ?? key}</p>
                  <Badge tone={data?.capabilities?.[key] ? "green" : "neutral"}>
                    {data?.capabilities?.[key] ? "Available" : "Not implemented"}
                  </Badge>
                </div>
                <p className="mt-1.5 text-[11.5px] leading-5 text-ink-soft">{note}</p>
              </Card>
            ))}
          </div>
        </Section>

        <Section title="Secrets" description="Where configuration actually lives.">
          <Card className="min-w-0 p-4">
            <p className="text-[12px] leading-5 text-ink-soft">
              Provider keys — Supabase service role, Razorpay, OpenRouter, Resend, SerpApi — are environment variables on the
              Vercel deployment and in Supabase Edge Function secrets. They are never read into an API response, never stored in
              the database, and never sent to a browser. This page can only report whether each one is <em>set</em>, which is
              shown on <button type="button" className="text-brand-700 hover:underline" onClick={() => navigate("/admin/system")}>System health</button>.
            </p>
            <p className="mt-2 text-[11.5px] leading-5 text-ink-mute">
              Rotating a key is done in the provider dashboard and then in Vercel → Settings → Environment Variables, followed by
              a redeploy. Nothing in this console can change a secret.
            </p>
          </Card>
        </Section>

        <Section title="Console summary">
          <Card className="min-w-0 p-4">
            <ul className="space-y-1 text-[12px] text-ink-soft">
              <li>
                Administrators: <span className="font-medium text-ink">{full(data?.admins.length)}</span>
              </li>
              <li>
                Authorization: browser Supabase JWT → <Mono value="/api/admin/*" /> → server verifies the token → verifies{" "}
                <Mono value="profiles.role = 'admin'" /> → privileged service client. The client-side flag is presentation only.
              </li>
              <li>Every privileged mutation writes an append-only audit entry with actor, target, before, after, IP and timestamp.</li>
            </ul>
          </Card>
        </Section>
      </div>
    </>
  );
}
