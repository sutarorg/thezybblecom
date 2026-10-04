/* ------------------------------------------------------------------ */
/* /admin/system — operational health.                                 */
/*                                                                     */
/* Every check is derived from something real: a Postgres round trip,  */
/* an actual HTTP request to /api/health, or observed failure rates in */
/* the last N minutes. Nothing is hardcoded to "ok", and a subsystem   */
/* with no traffic reports "unknown" rather than green.                */
/* ------------------------------------------------------------------ */
import { useMemo, useState } from "react";
import { CheckCircle2, CircleHelp, RotateCw, TriangleAlert, XCircle } from "lucide-react";
import { Badge, Btn, Card } from "../../components/ui";
import { useAdminResource } from "../client";
import { ErrorPanel, Metric, MetricGrid, PageHead, Section, SelectField, full, num } from "../ui";

type CheckStatus = "healthy" | "degraded" | "failing" | "unknown";
type Check = { id: string; label: string; status: CheckStatus; detail: string; source: string };

type Response = {
  windowMinutes: number;
  overall: CheckStatus;
  checks: Check[];
  health: Record<string, Record<string, number>>;
  config: Record<string, boolean>;
};

const TONE: Record<CheckStatus, { badge: "green" | "amber" | "red" | "neutral"; label: string }> = {
  healthy: { badge: "green", label: "Healthy" },
  degraded: { badge: "amber", label: "Degraded" },
  failing: { badge: "red", label: "Failing" },
  unknown: { badge: "neutral", label: "No data" },
};

function StatusIcon({ status }: { status: CheckStatus }) {
  const cls = "size-4 shrink-0";
  if (status === "healthy") return <CheckCircle2 className={`${cls} text-brand-600`} aria-hidden="true" />;
  if (status === "degraded") return <TriangleAlert className={`${cls} text-amber-600`} aria-hidden="true" />;
  if (status === "failing") return <XCircle className={`${cls} text-red-600`} aria-hidden="true" />;
  return <CircleHelp className={`${cls} text-neutral-400`} aria-hidden="true" />;
}

const CONFIG_LABELS: Record<string, string> = {
  supabase_url: "SUPABASE_URL",
  supabase_publishable: "SUPABASE_PUBLISHABLE_KEY / ANON_KEY",
  supabase_service_role: "SUPABASE_SERVICE_ROLE_KEY",
  serpapi: "SERPAPI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  razorpay: "RAZORPAY_KEY_ID + KEY_SECRET",
  razorpay_webhook_secret: "RAZORPAY_WEBHOOK_SECRET",
  razorpay_plans: "RAZORPAY_PLAN_{GROWTH,AGENCY,SCALE}_ID",
  resend: "RESEND_API_KEY",
  app_url: "APP_URL",
};

const WINDOWS = [
  { value: "15", label: "Last 15 minutes" },
  { value: "60", label: "Last hour" },
  { value: "360", label: "Last 6 hours" },
  { value: "1440", label: "Last 24 hours" },
];

export function AdminSystem() {
  const [windowMinutes, setWindowMinutes] = useState("60");
  const params = useMemo(() => ({ window: windowMinutes }), [windowMinutes]);
  const { data, loading, error, reload } = useAdminResource<Response>("system", params);

  if (error) {
    return (
      <>
        <PageHead title="System health" />
        <ErrorPanel message={error} onRetry={reload} />
      </>
    );
  }

  const overall = data?.overall ?? "unknown";
  const counts = (data?.checks ?? []).reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHead
        title="System health"
        description="Derived from live database aggregates and a real HTTP probe — never a hardcoded status."
        actions={
          <>
            <SelectField label="Window" value={windowMinutes} onChange={setWindowMinutes} options={WINDOWS} />
            <Btn variant="outline" size="sm" onClick={reload} label="Re-run checks">
              <RotateCw className="size-3.5" aria-hidden="true" />
            </Btn>
          </>
        }
      />

      <div className="space-y-6">
        <Card className="min-w-0 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusIcon status={overall} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold tracking-[-0.01em] text-ink">
                {loading ? "Running checks…" : `Platform ${TONE[overall].label.toLowerCase()}`}
              </p>
              <p className="mt-0.5 text-[11.5px] text-ink-mute">
                {full(data?.checks.length)} checks over the last {full(data?.windowMinutes)} minute(s).
              </p>
            </div>
            <Badge tone={TONE[overall].badge}>{TONE[overall].label}</Badge>
          </div>
        </Card>

        <MetricGrid cols={4}>
          <Metric label="Healthy" value={full(counts.healthy)} tone="good" loading={loading} />
          <Metric label="Degraded" value={full(counts.degraded)} tone={counts.degraded ? "warn" : "neutral"} loading={loading} />
          <Metric label="Failing" value={full(counts.failing)} tone={counts.failing ? "bad" : "neutral"} loading={loading} />
          <Metric label="No data" value={full(counts.unknown)} loading={loading} />
        </MetricGrid>

        <Section title="Checks" description="Each row names the exact source the verdict was computed from.">
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {(data?.checks ?? []).map((check) => (
              <Card key={check.id} className="min-w-0 p-4">
                <div className="flex items-start gap-2.5">
                  <StatusIcon status={check.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13px] font-medium text-ink">{check.label}</p>
                      <Badge tone={TONE[check.status].badge}>{TONE[check.status].label}</Badge>
                    </div>
                    <p className="mt-1 break-words text-[12px] leading-5 text-ink-soft">{check.detail}</p>
                    <p className="mt-1.5 font-mono text-[10.5px] text-neutral-400">{check.source}</p>
                  </div>
                </div>
              </Card>
            ))}
            {!loading && !data?.checks.length ? (
              <p className="text-[11.5px] text-ink-mute">No checks returned.</p>
            ) : null}
          </div>
        </Section>

        <Section title="Activity in this window" description="Raw counters behind the verdicts above.">
          <Card className="min-w-0 overflow-x-auto p-0">
            <table className="w-full min-w-[420px] text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.07] text-left text-[11px] uppercase tracking-[0.06em] text-neutral-500">
                  <th className="px-3.5 py-2 font-medium">Subsystem</th>
                  <th className="px-3.5 py-2 text-right font-medium">Total</th>
                  <th className="px-3.5 py-2 text-right font-medium">Failed</th>
                  <th className="px-3.5 py-2 text-right font-medium">Other</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {Object.entries(data?.health ?? {}).map(([key, value]) => {
                  const node = (value ?? {}) as Record<string, number>;
                  const other = Object.entries(node)
                    .filter(([k]) => k !== "total" && k !== "failed")
                    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
                    .join(", ");
                  return (
                    <tr key={key}>
                      <td className="px-3.5 py-2 text-ink">{key.replace(/_/g, " ")}</td>
                      <td className="px-3.5 py-2 text-right tabular-nums">{full(node.total)}</td>
                      <td className={`px-3.5 py-2 text-right tabular-nums ${num(node.failed) ? "text-red-600" : ""}`}>{full(node.failed)}</td>
                      <td className="px-3.5 py-2 text-right text-[11px] text-ink-mute">{other || "—"}</td>
                    </tr>
                  );
                })}
                {!loading && !Object.keys(data?.health ?? {}).length ? (
                  <tr>
                    <td colSpan={4} className="px-3.5 py-6 text-center text-[11.5px] text-ink-mute">
                      No activity recorded in this window.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </Section>

        <Section
          title="Provider configuration"
          description="Presence only. The server reports whether each variable is set; no value is ever read into a response or sent to this page."
        >
          <Card className="min-w-0 p-4">
            <ul className="grid gap-1.5 text-[12px] sm:grid-cols-2">
              {Object.entries(data?.config ?? {}).map(([key, present]) => (
                <li key={key} className="flex items-center justify-between gap-2 border-b border-black/[0.04] py-1.5 last:border-b-0">
                  <span className="min-w-0 truncate font-mono text-[11px] text-ink-soft">{CONFIG_LABELS[key] ?? key}</span>
                  <Badge tone={present ? "green" : "red"}>{present ? "Set" : "Missing"}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-5 text-ink-mute">
              A missing variable is configured in Vercel → Project → Settings → Environment Variables, then redeployed. Values
              are never displayed here, and none of them are exposed to the browser.
            </p>
          </Card>
        </Section>
      </div>
    </>
  );
}
