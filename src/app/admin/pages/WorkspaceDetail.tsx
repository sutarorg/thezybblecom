/* ------------------------------------------------------------------ */
/* /admin/workspaces/:id — workspace 360 (operations view).            */
/*                                                                     */
/* Deliberately NOT a second copy of the customer Leads UI: it reports */
/* aggregates, pipeline state and failures, not browsable lead rows.   */
/* ------------------------------------------------------------------ */
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, RotateCw } from "lucide-react";
import { Badge, Btn, Card, Skel } from "../../components/ui";
import { useAdminResource } from "../client";
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
  num,
} from "../ui";

type Detail = {
  workspace: {
    id: string; name: string; is_client: boolean; created_at: string;
    stored_plan_id: string; plan_id: string;
    owner: { id: string; name: string; email: string; role: string; status: string };
    plan: { id: string; lead_allowance: number; max_lists: number; max_users: number; has_ai: boolean; client_workspaces: boolean; priority_processing: boolean } | null;
  };
  members: { user_id: string; role: string; created_at: string; name: string; email: string; account_status: string }[];
  invitations: { id: string; email: string; role: string; status: string; created_at: string }[];
  usage: { period_start: string; leads_used: number; searches: number; exports: number; ai_runs: number }[];
  searches: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
  leads: {
    total: number; with_email: number; with_phone: number; with_website: number;
    by_status: Record<string, number>; by_source: Record<string, number>; by_provider: Record<string, number>;
  };
  lists: { id: string; name: string; created_at: string; size: number }[];
  exports: Record<string, unknown>[];
  ai_requests: Record<string, unknown>[];
  activity: Record<string, unknown>[];
};

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

export function AdminWorkspaceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAdminResource<{ workspace: Detail }>(`workspaces/${id}`);

  const back = (
    <Btn variant="outline" size="sm" onClick={() => navigate("/admin/workspaces")}>
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      All workspaces
    </Btn>
  );

  if (error) {
    return (
      <>
        <PageHead title="Workspace" actions={back} />
        <ErrorPanel message={error} onRetry={reload} />
      </>
    );
  }

  const d = data?.workspace;
  const w = d?.workspace;
  const current = d?.usage?.[0];
  const allowance = num(w?.plan?.lead_allowance);

  return (
    <>
      <PageHead
        title={loading ? "Loading workspace…" : (w?.name ?? "Workspace")}
        description={w ? `Owned by ${w.owner.name || w.owner.email} · created ${dateOnly(w.created_at)}` : undefined}
        actions={
          <>
            {back}
            <Btn variant="outline" size="sm" onClick={reload} label="Refresh">
              <RotateCw className="size-3.5" aria-hidden="true" />
            </Btn>
          </>
        }
      />

      {loading ? (
        <div className="space-y-3">
          <Skel className="h-24 w-full rounded-lg" />
          <Skel className="h-48 w-full rounded-lg" />
        </div>
      ) : !d || !w ? (
        <ErrorPanel message="That workspace no longer exists." onRetry={() => navigate("/admin/workspaces")} />
      ) : (
        <div className="space-y-6">
          <MetricGrid cols={5}>
            <Metric label="Plan" value={<PlanBadge plan={w.plan_id} />} hint={w.stored_plan_id !== w.plan_id ? `stored: ${w.stored_plan_id}` : undefined} />
            <Metric label="Members" value={full(d.members.length)} hint={w.plan ? `seat limit ${w.plan.max_users}` : undefined} />
            <Metric label="Leads stored" value={full(d.leads.total)} />
            <Metric
              label="Leads used (mo)"
              value={`${full(current?.leads_used ?? 0)}${allowance > 0 ? ` / ${full(allowance)}` : ""}`}
              tone={allowance > 0 && num(current?.leads_used) >= allowance ? "bad" : allowance > 0 && num(current?.leads_used) / allowance >= 0.8 ? "warn" : "neutral"}
            />
            <Metric label="Lists" value={full(d.lists.length)} hint={w.plan ? (w.plan.max_lists < 0 ? "unlimited" : `max ${w.plan.max_lists}`) : undefined} />
          </MetricGrid>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card className="min-w-0 p-4">
              <Section title="Overview">
                <KeyValue
                  items={[
                    { label: "Workspace id", value: <Mono value={w.id} /> },
                    { label: "Client workspace", value: w.is_client ? <Badge tone="sky">Yes</Badge> : "No" },
                    { label: "Created", value: dateTime(w.created_at) },
                    {
                      label: "Owner",
                      value: (
                        <button type="button" className="text-brand-700 underline-offset-2 hover:underline" onClick={() => navigate(`/admin/users/${w.owner.id}`)}>
                          {w.owner.name || w.owner.email}
                        </button>
                      ),
                    },
                    { label: "Owner account", value: <StatusBadge value={w.owner.status} /> },
                    { label: "Effective plan", value: <PlanBadge plan={w.plan_id} /> },
                  ]}
                />
                {w.plan ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone={w.plan.has_ai ? "green" : "neutral"}>AI {w.plan.has_ai ? "on" : "off"}</Badge>
                    <Badge tone={w.plan.client_workspaces ? "green" : "neutral"}>Client workspaces {w.plan.client_workspaces ? "on" : "off"}</Badge>
                    <Badge tone={w.plan.priority_processing ? "green" : "neutral"}>Priority {w.plan.priority_processing ? "on" : "off"}</Badge>
                  </div>
                ) : null}
              </Section>
            </Card>

            <Card className="min-w-0 p-4">
              <Section title="Members &amp; invitations">
                <ul className="divide-y divide-black/[0.05] text-[12px]">
                  {d.members.map((m) => (
                    <li key={m.user_id} className="flex items-center justify-between gap-2 py-1.5">
                      <button type="button" onClick={() => navigate(`/admin/users/${m.user_id}`)} className="min-w-0 text-left">
                        <span className="block truncate text-ink">{m.name || m.email || m.user_id}</span>
                        <span className="block truncate text-[11px] text-ink-mute">{m.email}</span>
                      </button>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {m.account_status === "suspended" ? <StatusBadge value="suspended" /> : null}
                        <Badge tone={m.role === "owner" ? "green" : "neutral"}>{m.role}</Badge>
                      </span>
                    </li>
                  ))}
                  {!d.members.length ? <li className="py-2 text-[11.5px] text-ink-mute">No members.</li> : null}
                </ul>
                {d.invitations.length ? (
                  <>
                    <p className="mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-neutral-400">Invitations</p>
                    <ul className="divide-y divide-black/[0.05] text-[12px]">
                      {d.invitations.map((i) => (
                        <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="min-w-0 truncate text-ink-soft">{i.email}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Badge tone="neutral">{i.role}</Badge>
                            <StatusBadge value={i.status} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Section>
            </Card>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            <Card className="min-w-0 p-4">
              <Section title="Lead coverage" description="Enrichment completeness of stored leads.">
                {d.leads.total ? (
                  <ul className="space-y-2 text-[12px]">
                    {(
                      [
                        ["Email", d.leads.with_email],
                        ["Phone", d.leads.with_phone],
                        ["Website", d.leads.with_website],
                      ] as const
                    ).map(([label, value]) => (
                      <li key={label}>
                        <div className="flex items-baseline justify-between">
                          <span className="text-ink-soft">{label}</span>
                          <span className="tabular-nums text-ink">
                            {full(value)} ({pct(value, d.leads.total)})
                          </span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/[0.06]">
                          <div className="h-full rounded-full bg-brand-600" style={{ width: `${(value / d.leads.total) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-[11.5px] text-ink-mute">No leads collected yet.</p>
                )}
              </Section>
            </Card>
            <Card className="min-w-0 p-4">
              <Section title="Lead sources" description="Where the data came from.">
                <Distribution data={d.leads.by_source} total={d.leads.total} emptyLabel="No leads yet." />
              </Section>
            </Card>
            <Card className="min-w-0 p-4">
              <Section title="Lead workflow" description="Customer-set status on each lead.">
                <Distribution data={d.leads.by_status} total={d.leads.total} emptyLabel="No leads yet." />
              </Section>
            </Card>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card className="min-w-0 p-4">
              <Section title="Recent searches" aside={<span className="text-[11px] text-neutral-400">latest 20</span>}>
                {d.searches.length ? (
                  <ul className="divide-y divide-black/[0.05]">
                    {d.searches.map((s) => (
                      <li key={String(s.id)} className="py-2">
                        <button type="button" onClick={() => navigate(`/admin/searches/${String(s.id)}`)} className="flex w-full min-w-0 items-start justify-between gap-2 text-left">
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] text-ink">{String(s.query)}</span>
                            <span className="block truncate text-[11px] text-ink-mute">
                              {full(s.result_count)}/{full(s.requested_count)} results · {ago(String(s.created_at))}
                            </span>
                            {s.error ? <span className="mt-0.5 block truncate text-[11px] text-red-600">{String(s.error)}</span> : null}
                          </span>
                          <StatusBadge value={String(s.status)} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-[11.5px] text-ink-mute">No searches run in this workspace.</p>
                )}
              </Section>
            </Card>

            <Card className="min-w-0 p-4">
              <Section title="Search jobs" description="Pipeline stage and processed counts.">
                {d.jobs.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {d.jobs.map((j) => (
                      <li key={String(j.id)} className="flex items-start justify-between gap-2 py-1.5">
                        <span className="min-w-0">
                          <span className="block truncate text-ink-soft">
                            {String(j.current_stage ?? "—")} · {full(j.processed_count)}/{full(j.requested_count)}
                          </span>
                          <span className="block text-[11px] text-neutral-400">{ago(String(j.created_at))}</span>
                          {j.error ? <span className="block truncate text-[11px] text-red-600">{String(j.error)}</span> : null}
                        </span>
                        <StatusBadge value={String(j.status)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-[11.5px] text-ink-mute">No jobs recorded.</p>
                )}
              </Section>
            </Card>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            <Card className="min-w-0 p-4">
              <Section title="Usage history">
                {d.usage.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {d.usage.map((u) => (
                      <li key={u.period_start} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="text-ink-soft">{u.period_start}</span>
                        <span className="flex gap-2.5 tabular-nums text-[11px] text-ink-mute">
                          <span>{full(u.leads_used)} leads</span>
                          <span>{full(u.searches)} srch</span>
                          <span>{full(u.exports)} exp</span>
                          <span>{full(u.ai_runs)} ai</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-[11.5px] text-ink-mute">No usage recorded.</p>
                )}
              </Section>
            </Card>

            <Card className="min-w-0 p-4">
              <Section title="Lists">
                {d.lists.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {d.lists.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate text-ink-soft">{l.name}</span>
                        <span className="shrink-0 tabular-nums text-[11px] text-ink-mute">{full(l.size)} leads</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-[11.5px] text-ink-mute">No lists.</p>
                )}
              </Section>
            </Card>

            <Card className="min-w-0 p-4">
              <Section title="Exports &amp; AI">
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-neutral-400">Exports</p>
                {d.exports.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {d.exports.slice(0, 6).map((e) => (
                      <li key={String(e.id)} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate text-ink-soft">{String(e.file_name)}</span>
                        <StatusBadge value={String(e.status)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-[11.5px] text-ink-mute">No exports.</p>
                )}
                <p className="mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-neutral-400">AI requests</p>
                {d.ai_requests.length ? (
                  <ul className="divide-y divide-black/[0.05] text-[12px]">
                    {d.ai_requests.slice(0, 6).map((r) => (
                      <li key={String(r.id)} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate text-ink-soft">{String(r.kind)}</span>
                        <StatusBadge value={String(r.status)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-[11.5px] text-ink-mute">No AI requests.</p>
                )}
              </Section>
            </Card>
          </div>

          <Card className="min-w-0 p-4">
            <Section title="Activity log">
              {d.activity.length ? (
                <ul className="divide-y divide-black/[0.05] text-[12px]">
                  {d.activity.map((a) => (
                    <li key={String(a.id)} className="flex items-start justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate text-ink-soft">{String(a.text)}</span>
                      <span className="shrink-0 text-[11px] text-neutral-400">{dateTime(String(a.created_at))}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-[11.5px] text-ink-mute">No activity recorded.</p>
              )}
            </Section>
          </Card>
        </div>
      )}
    </>
  );
}
