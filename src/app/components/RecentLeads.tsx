/* ------------------------------------------------------------------ */
/* Zybble app — Recent leads card (/find)                              */
/*                                                                     */
/* Shows the latest real leads collected in the workspace. The layout   */
/* is deliberately constrained so long business names, emails, phones   */
/* and badges can never overlap the card edges or force horizontal      */
/* page scrolling on any breakpoint:                                   */
/*   • the card and every row use min-w-0 so flex children can shrink;  */
/*   • icons/avatars are shrink-0, text blocks are min-w-0 flex-1;      */
/*   • names, emails, phones and domains truncate within their block;   */
/*   • meta chips wrap (flex-wrap) instead of pushing content out.      */
/* ------------------------------------------------------------------ */
import { useEffect, useState } from "react";
import { ArrowUpRight, FileSearch, Mail, Phone, Star } from "lucide-react";
import { LeadAvatar } from "./LeadsTable";
import { Badge, Card, EmptyState, SectionTitle, Skel } from "./ui";
import type { Lead } from "../data/types";
import { truncateBusinessName } from "../lib/text";
import { listLeads } from "../services/api";

export function RecentLeadsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-black/[0.05] px-4 py-3" aria-hidden="true">
        <Skel className="h-3.5 w-24 rounded" />
      </div>
      <ul className="px-4 py-2">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 border-b border-black/[0.04] py-2.5 last:border-0">
            <Skel className="size-6 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skel className={i % 2 ? "block h-2.5 w-40 max-w-full rounded" : "block h-2.5 w-52 max-w-full rounded"} />
              <Skel className="block h-2 w-24 max-w-full rounded" />
            </div>
            <Skel className="h-4 w-16 max-w-[30%] shrink-0 rounded" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LeadContact({ lead }: { lead: Lead }) {
  /* Emails and phones are the widest values in a row — they truncate inside
     a constrained block and never push siblings past the card boundary. */
  if (lead.email) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-ink-mute">
        <Mail className="size-3 shrink-0 text-neutral-300" aria-hidden="true" />
        <span className="max-w-[150px] truncate">{lead.email}</span>
      </span>
    );
  }
  if (lead.phone) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] text-ink-mute">
        <Phone className="size-3 shrink-0 text-neutral-300" aria-hidden="true" />
        <span className="max-w-[130px] truncate">{lead.phone}</span>
      </span>
    );
  }
  return <span className="truncate text-[11px] text-neutral-300">No public contact</span>;
}

export function RecentLeadsCard({
  leads,
  loading,
  total,
  onRetry,
}: {
  leads: Lead[];
  loading: boolean;
  total: number;
  onRetry?: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.05] px-4 py-3">
        <SectionTitle title="Recent leads" description="Latest businesses collected in this workspace." />
        {leads.length ? (
          <a
            href="/leads"
            className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-ink-mute transition-colors hover:text-brand-700"
          >
            View all
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </div>

      {loading ? (
        <ul aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 border-b border-black/[0.04] px-4 py-2.5 last:border-0">
              <Skel className="size-6 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skel className={i % 2 ? "block h-2.5 w-40 max-w-full rounded" : "block h-2.5 w-52 max-w-full rounded"} />
                <Skel className="block h-2 w-24 max-w-full rounded" />
              </div>
              <Skel className="h-4 w-16 max-w-[30%] shrink-0 rounded" />
            </li>
          ))}
        </ul>
      ) : leads.length === 0 ? (
        <div className="p-4">
          <EmptyState
            className="border-0 bg-transparent py-8"
            icon={<FileSearch className="size-4" aria-hidden="true" />}
            title="No leads yet"
            description="Run your first search and the businesses you collect will show up here."
          />
        </div>
      ) : (
        <ul className="divide-y divide-black/[0.04]">
          {leads.map((lead) => (
            <li key={lead.id} className="min-w-0">
              {/* The whole row carries the complete business name: `title`
                  exposes it as a hover/focus tooltip and aria-label keeps the
                  full name in the accessible name even when the visible
                  label is truncated. */}
              <a
                href={`/leads/${lead.id}`}
                title={lead.name}
                aria-label={`View ${lead.name}`}
                className="group flex min-w-0 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-neutral-50/70"
              >
                <LeadAvatar lead={lead} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  {/* Names over 26 characters are cut with an ellipsis, and
                      CSS `truncate` (min-width: 0 + overflow: hidden +
                      nowrap + text-overflow) still guards narrower widths —
                      a long name can never wrap, overlap or push the meta
                      block outside the card. */}
                  <span className="block truncate whitespace-nowrap text-xs font-medium text-ink">
                    {truncateBusinessName(lead.name)}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-mute">
                    {[lead.category, lead.city || lead.state].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <span className="flex min-w-0 shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2.5">
                  {lead.rating ? (
                    <Badge tone="neutral" className="shrink-0 whitespace-nowrap">
                      <Star className="size-2.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                      {lead.rating.toFixed(1)}
                    </Badge>
                  ) : null}
                  <LeadContact lead={lead} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {!loading && total > leads.length ? (
        <p className="border-t border-black/[0.04] px-4 py-2 text-[10.5px] text-neutral-400">
          Showing {leads.length} of {total.toLocaleString()} leads in this workspace
        </p>
      ) : null}
      {onRetry ? <button type="button" onClick={onRetry} className="sr-only">Reload recent leads</button> : null}
    </Card>
  );
}

/**
 * Loads the workspace's most recent leads (RLS-guarded read) and renders the
 * card. Real rows only — no fabricated businesses.
 */
export function RecentLeads({ workspaceId, enabled = true }: { workspaceId: string | null; enabled?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    if (!workspaceId) {
      setLoading(true);
      return;
    }
    let mounted = true;
    setLoading(true);
    listLeads(workspaceId, { pageSize: 5, page: 1 })
      .then(({ rows, total: count }) => {
        if (!mounted) return;
        setLeads(rows);
        setTotal(count);
      })
      .catch(() => {
        if (!mounted) return;
        setLeads([]);
        setTotal(0);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [workspaceId, enabled]);

  if (!workspaceId && loading) return <RecentLeadsSkeleton />;
  return <RecentLeadsCard leads={leads} loading={loading} total={total} />;
}
