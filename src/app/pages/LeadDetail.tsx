/* ------------------------------------------------------------------ */
/* Zybble app — Lead detail                                            */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Download,
  FileSearch,
  Globe,
  Landmark,
  ListPlus,
  Mail,
  Navigation,
  Phone,
  Plus,
  Send,
  Sparkles,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import { AiPanel } from "../components/AiPanel";
import { LeadAvatar, STATUS_TONE } from "../components/LeadsTable";
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  FieldLabel,
  SectionTitle,
  Skel,
  Textarea,
  formatDate,
  relative,
  useToast,
} from "../components/ui";
import type { Lead, LeadList } from "../data/types";
import { useAppSeo } from "../hooks";
import {
  addLeadNote,
  addToList,
  analyzeLead,
  deleteLeadNote,
  downloadCsv,
  getLead,
  getLeadInsight,
  getLists,
  runExport,
  updateLeadStatus,
  updateLeadTags,
} from "../services/api";
import { useWorkspaceContext } from "../services/hooks";
import { Input } from "../components/ui";
import { copyText } from "../lib/clipboard";
import { validateTag } from "../lib/tags";

function DetailRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-black/[0.04] py-2 last:border-0">
      <dt className="shrink-0 text-[11px] text-ink-mute">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right text-xs text-ink",
          mono && "break-all font-mono text-[10.5px] leading-4.5 text-ink-soft"
        )}
      >
        {value || <span className="text-neutral-300">—</span>}
      </dd>
    </div>
  );
}

const OPEN_META: Record<Lead["open_state"], { tone: "green" | "neutral"; label: string }> = {
  open: { tone: "green", label: "Open now" },
  closed: { tone: "neutral", label: "Closed" },
  unknown: { tone: "neutral", label: "Hours unknown" },
};

function PopularTimes({ value }: { value: unknown }) {
  const entries = Array.isArray(value)
    ? value.slice(0, 7)
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).slice(0, 7).map(([day, data]) => ({ day, data }))
      : [];
  if (!entries.length) return <span className="text-neutral-300">Not available</span>;
  return (
    <div className="w-full min-w-[220px] space-y-1.5 text-left">
      {entries.map((entry, i) => {
        const day = typeof entry === "object" && "day" in entry ? String(entry.day) : String((entry as Record<string, unknown>).day ?? `Day ${i + 1}`);
        const raw = typeof entry === "object" && "data" in entry ? (entry as { data: unknown }).data : (entry as Record<string, unknown>).hours;
        const values = Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite).slice(0, 24) : [];
        const max = Math.max(1, ...values);
        return (
          <div key={day} className="grid grid-cols-[44px_1fr] items-center gap-2">
            <span className="text-[10px] text-neutral-400">{day.slice(0, 3)}</span>
            <span className="flex h-5 items-end gap-0.5">
              {values.length ? values.map((v, idx) => (
                <span key={idx} className="w-1 flex-1 rounded-t bg-brand-600/70" style={{ height: `${Math.max(15, (v / max) * 100)}%` }} />
              )) : <span className="text-[10px] text-neutral-300">Not available</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LeadDetailSkeleton() {
  const CardBlock = ({ title, rows = 4 }: { title: string; rows?: number }) => (
    <Card className="p-4">
      <Skel className="h-3.5 w-32 rounded" />
      <span className="sr-only">{title}</span>
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-6 border-b border-black/[0.04] pb-2 last:border-0">
            <Skel className="h-2.5 w-20 rounded" />
            <Skel className={cn("h-2.5 rounded", i % 2 ? "w-32" : "w-48")} />
          </div>
        ))}
      </div>
    </Card>
  );
  return (
    <AppLayout title="Lead detail" wide>
      <div className="mb-4 flex items-center justify-between gap-3" aria-hidden="true">
        <Skel className="h-4 w-20 rounded" />
        <div className="flex gap-1.5"><Skel className="h-7 w-20 rounded" /><Skel className="h-7 w-24 rounded" /><Skel className="h-7 w-28 rounded" /></div>
      </div>
      <Card className="mb-3 p-4 sm:p-5" aria-hidden="true">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Skel className="size-10 rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><Skel className="h-4 w-56 rounded" /><Skel className="h-5 w-16 rounded" /><Skel className="h-5 w-20 rounded" /></div>
              <Skel className="mt-2 h-2.5 w-[min(520px,80vw)] rounded" />
            </div>
          </div>
          <Skel className="h-7 w-36 rounded" />
        </div>
      </Card>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]" aria-hidden="true">
        <div className="space-y-3">
          <CardBlock title="Business information" rows={6} />
          <CardBlock title="Contact" rows={4} />
          <CardBlock title="Location" rows={6} />
          <CardBlock title="Hours and amenities" rows={5} />
          <CardBlock title="Source" rows={5} />
        </div>
        <div className="space-y-3 lg:sticky lg:top-[60px] lg:self-start">
          <CardBlock title="Saved in" rows={2} />
          <CardBlock title="Zybble AI" rows={4} />
          <CardBlock title="Tags" rows={3} />
          <CardBlock title="Notes" rows={4} />
        </div>
      </div>
    </AppLayout>
  );
}

export function LeadDetailPage({ id }: { id: string }) {
  const toast = useToast();
  const location = useLocation();
  const { workspace, loading: ctxLoading } = useWorkspaceContext();
  const autoAnalyzeStarted = useRef(false);

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiLines, setAiLines] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [lists, setLists] = useState<LeadList[]>([]);

  useAppSeo(
    lead ? `${lead.name} — Zybble` : "Lead — Zybble",
    lead ? `${lead.category} in ${lead.city} — business detail.` : "Lead detail.",
    `/leads/${id}`
  );

  useEffect(() => {
    if (!workspace) {
      if (!ctxLoading) setLoading(false);
      return;
    }
    setLoading(true);
    getLead(id, workspace.id)
      .then((found) => setLead(found))
      .catch(() => setLead(null))
      .finally(() => setLoading(false));

    getLeadInsight(id)
      .then((insight) => {
        if (insight) setAiLines(insight.points.length ? [insight.summary, ...insight.points] : [insight.summary]);
      })
      .catch(() => undefined);

    getLists(workspace.id).then(setLists).catch(() => undefined);
  }, [id, workspace, ctxLoading]);

  const leadLists = useMemo(
    () => (lead ? lists.filter((l) => lead.list_ids.includes(l.id)) : []),
    [lists, lead]
  );
  const suggestedLists = useMemo(
    () => (lead ? lists.filter((l) => !lead.list_ids.includes(l.id)).slice(0, 3) : []),
    [lists, lead]
  );

  useEffect(() => {
    if (!lead || !workspace || autoAnalyzeStarted.current) return;
    if (!new URLSearchParams(location.search).has("analyze")) return;
    autoAnalyzeStarted.current = true;
    setAiBusy(true);
    analyzeLead(lead.id, workspace.id).then(({ result, error }) => {
      setAiBusy(false);
      if (error || !result) {
        toast(error ?? "AI analysis couldn't run right now.", "error");
        return;
      }
      setAiLines([result.summary, ...result.points]);
      toast("AI analysis ready");
    });
  }, [lead, workspace, location.search, toast]);

  const busy = loading || ctxLoading;

  /* ---------------- loading ---------------- */
  if (busy) return <LeadDetailSkeleton />;

  /* ---------------- not found ---------------- */
  if (!lead) {
    return (
      <AppLayout title="Lead detail" wide>
        <a
          href="/leads"
          className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-ink-mute transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Leads
        </a>
        <EmptyState
          icon={<FileSearch className="size-4" aria-hidden="true" />}
          title="Lead not found"
          description="This lead doesn't exist, or it belongs to a workspace you don't have access to."
          action={
            <Btn variant="primary" href="/leads">
              Back to leads
            </Btn>
          }
        />
      </AppLayout>
    );
  }

  const statusMeta = STATUS_TONE[lead.status];

  /* ---------------- handlers ---------------- */
  const runAi = async () => {
    if (aiBusy || !workspace) return;
    setAiBusy(true);
    const { result, error } = await analyzeLead(lead.id, workspace.id);
    setAiBusy(false);
    if (error || !result) {
      toast(error ?? "AI analysis couldn't run right now.", "error");
      return;
    }
    setAiLines([result.summary, ...result.points]);
    toast("AI analysis ready");
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      const created = await addLeadNote(lead.id, note.trim());
      setLead((l) => (l ? { ...l, notes: [created, ...l.notes] } : l));
      setNote("");
      toast("Note added");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const addTag = async () => {
    const checked = validateTag(tagInput);
    if (!checked.ok) {
      toast(checked.error, "error");
      return;
    }
    const t = checked.tag;
    if (lead.tags.includes(t)) return;
    const tags = [...lead.tags, t];
    setLead((l) => (l ? { ...l, tags } : l));
    setTagInput("");
    try {
      await updateLeadTags(lead.id, tags);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const removeTag = async (tag: string) => {
    const tags = lead.tags.filter((t) => t !== tag);
    setLead((l) => (l ? { ...l, tags } : l));
    try {
      await updateLeadTags(lead.id, tags);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <AppLayout title="Lead detail" wide>
      {/* back + actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <a
          href="/leads"
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-mute transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Leads
        </a>
        <div className="flex items-center gap-1.5">
          <Btn
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!workspace) return;
              const res = await runExport({
                workspaceId: workspace.id,
                leadIds: [lead.id],
                source: lead.name,
              });
              if (res.error) {
                toast(res.error, "error");
                return;
              }
              if (res.export?.csv) downloadCsv(res.export.csv, res.export.file_name);
              toast("CSV export downloaded");
            }}
          >
            <Download className="size-3.5" aria-hidden="true" />
            Export
          </Btn>
          {lists.length ? (
            <Btn
              variant="outline"
              size="sm"
              onClick={async () => {
                const target = lists[0];
                try {
                  await addToList(target.id, [lead.id]);
                  setLead((l) => (l ? { ...l, list_ids: [...new Set([...l.list_ids, target.id])] } : l));
                  toast(`Saved to “${target.name}”`);
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              <ListPlus className="size-3.5" aria-hidden="true" />
              Save to list
            </Btn>
          ) : null}
          {lead.status !== "contacted" ? (
            <Btn
              variant="primary"
              size="sm"
              onClick={async () => {
                setLead((l) => (l ? { ...l, status: "contacted" } : l));
                try {
                  await updateLeadStatus(lead.id, "contacted");
                  toast("Marked as contacted");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              <Send className="size-3.5" aria-hidden="true" />
              Mark contacted
            </Btn>
          ) : (
            <Badge tone="amber" className="h-7 px-2">
              Contacted
            </Badge>
          )}
        </div>
      </div>

      {/* heading */}
      <Card className="mb-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <LeadAvatar lead={lead} className="size-10 rounded-lg text-sm" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display truncate text-[17px] font-semibold tracking-[-0.02em] text-ink">
                  {lead.name}
                </h2>
                <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                <Badge tone={OPEN_META[lead.open_state].tone}>● {OPEN_META[lead.open_state].label}</Badge>
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-mute">
                <span>{lead.category}</span>
                {lead.address ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{lead.address}</span>
                  </>
                ) : null}
                {lead.rating ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                      <span className="font-medium text-ink">{lead.rating.toFixed(1)}</span>
                      <span>({lead.reviews.toLocaleString()} reviews)</span>
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          {lead.maps_url ? (
            <a
              href={lead.maps_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded border border-black/[0.09] px-2.5 text-xs font-medium text-ink-soft transition-colors hover:border-black/[0.16] hover:text-ink"
            >
              Open in Google Maps
              <ArrowUpRight className="size-3 text-neutral-400" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* left column */}
        <div className="min-w-0 space-y-3">
          <Card>
            <div className="px-4 pt-4">
              <SectionTitle title="Business information" />
            </div>
            <dl className="px-4 pb-3 pt-2">
              <DetailRow label="Name" value={lead.name} />
              <DetailRow label="Categories" value={lead.categories.join(", ") || lead.category} />
              <DetailRow label="Description" value={lead.description} />
              <DetailRow label="Price tier" value={lead.price} />
              <DetailRow
                label="Rating"
                value={
                  lead.rating ? (
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                      {lead.rating.toFixed(1)} · {lead.reviews.toLocaleString()} reviews
                    </span>
                  ) : null
                }
              />
              <DetailRow label="Business size" value={lead.business_size === "unknown" ? "Unknown" : `${lead.business_size}${lead.employee_count ? ` · ${lead.employee_count} employees` : ""}`} />
              <DetailRow label="Popular times" value={<PopularTimes value={lead.popular_times} />} />
            </dl>
          </Card>

          <Card>
            <div className="px-4 pt-4">
              <SectionTitle title="Contact" />
            </div>
            <div className="grid gap-2 px-4 pb-4 pt-3 sm:grid-cols-2">
              {[
                { icon: Phone, label: "Phone", value: lead.phone || "Not listed", copy: lead.phone || undefined },
                {
                  icon: Mail,
                  label: "Email",
                  value: lead.email ?? "Not publicly listed",
                  copy: lead.email ?? undefined,
                },
                {
                  icon: Globe,
                  label: "Website",
                  value: lead.website_domain ?? "None detected",
                  href: lead.website_domain ? `https://${lead.website_domain}` : undefined,
                },
                { icon: Clock, label: "Hours", value: lead.hours_display || "Not listed" },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center gap-2.5 rounded-md border border-black/[0.05] bg-neutral-50/60 px-3 py-2.5"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white text-neutral-400 ring-1 ring-black/[0.05]">
                    <row.icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                      {row.label}
                    </p>
                    {row.href ? (
                      <a
                        href={row.href}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs font-medium text-brand-700 hover:text-brand-600"
                      >
                        {row.value}
                      </a>
                    ) : (
                      <p className="truncate text-xs font-medium text-ink">{row.value}</p>
                    )}
                  </div>
                  {row.copy ? (
                    <button
                      type="button"
                      aria-label={`Copy ${row.label}`}
                      onClick={async () => {
                        try {
                          await copyText(row.copy!);
                          toast(`${row.label} copied`);
                        } catch (e) {
                          toast((e as Error).message || `Couldn't copy ${row.label.toLowerCase()}.`, "error");
                        }
                      }}
                      className="grid size-6 shrink-0 place-items-center rounded text-neutral-300 transition-colors hover:bg-black/[0.05] hover:text-ink"
                    >
                      <Copy className="size-3" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="px-4 pt-4">
              <SectionTitle title="Location" />
            </div>
            <dl className="px-4 pb-3 pt-2">
              <DetailRow label="Address" value={lead.address} />
              <DetailRow label="City" value={lead.city} />
              <DetailRow label="State" value={[lead.state, lead.postal_code].filter(Boolean).join(" ")} />
              <DetailRow
                label="Country"
                value={lead.country ? `${lead.country}${lead.country_code ? ` (${lead.country_code})` : ""}` : null}
              />
              <DetailRow
                label="Coordinates"
                value={
                  lead.latitude || lead.longitude ? (
                    <span className="inline-flex items-center gap-1 text-ink-soft">
                      <Navigation className="size-3 text-neutral-300" aria-hidden="true" />
                      {lead.latitude.toFixed(5)}, {lead.longitude.toFixed(5)}
                    </span>
                  ) : null
                }
              />
              <DetailRow label="Plus code" value={lead.plus_code} mono />
            </dl>
          </Card>

          {lead.services.length || lead.attributes.length || Object.keys(lead.hours).length ? (
            <Card>
              <div className="px-4 pt-4">
                <SectionTitle title="Hours & amenities" />
              </div>
              <div className="grid gap-4 px-4 pb-4 pt-3 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                    Opening hours
                  </p>
                  {Object.keys(lead.hours).length ? (
                    <ul className="space-y-1">
                      {Object.entries(lead.hours).map(([day, hours]) => (
                        <li key={day} className="flex items-center gap-2 text-[11.5px] text-ink-soft">
                          <span className="w-[72px] shrink-0">{day.slice(0, 3)}</span>
                          <span className={hours === "Closed" ? "text-neutral-400" : ""}>{String(hours)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11.5px] text-neutral-400">Not published.</p>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                    Services
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {lead.services.length ? (
                      lead.services.map((s) => (
                        <Badge key={s} tone="neutral">
                          {s}
                        </Badge>
                      ))
                    ) : (
                      <p className="text-[11.5px] text-neutral-400">Not published.</p>
                    )}
                  </div>
                  {lead.attributes.length ? (
                    <>
                      <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                        Attributes
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {lead.attributes.map((a) => (
                          <Badge key={a} tone="neutral" className="bg-neutral-50">
                            {a}
                          </Badge>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="px-4 pt-4">
              <SectionTitle title="Source information" description="Identifiers from the origin listing." />
            </div>
            <dl className="px-4 pb-3 pt-2">
              <DetailRow label="Source" value={lead.source} />
              <DetailRow label="Place ID" value={lead.place_id} mono />
              <DetailRow label="Data CID" value={lead.data_cid} mono />
              <DetailRow label="Collected" value={formatDate(lead.collected_at)} />
              <DetailRow label="Last updated" value={relative(lead.updated_at)} />
              <DetailRow label="Origin search" value={lead.search_query ? `“${lead.search_query}”` : null} />
            </dl>
          </Card>
        </div>

        {/* right column */}
        <div className="min-w-0 space-y-3 lg:sticky lg:top-[60px] lg:self-start">
          <Card className="p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Saved in</p>
            {leadLists.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {leadLists.map((list) => (
                  <a key={list.id} href={`/lists/${list.id}`}>
                    <Badge tone="green" className="cursor-pointer transition-colors hover:bg-brand-100">
                      {list.name}
                    </Badge>
                  </a>
                ))}
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-[11px] leading-4.5 text-ink-mute">Not in a list yet.</p>
                {suggestedLists.length ? suggestedLists.map((list) => (
                  <div key={list.id} className="flex items-center justify-between gap-2 rounded border border-black/[0.05] px-2 py-1.5">
                    <span className="truncate text-[11.5px] font-medium text-ink-soft">{list.name}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await addToList(list.id, [lead.id]);
                          setLead((l) => (l ? { ...l, list_ids: [...new Set([...l.list_ids, list.id])] } : l));
                          toast(`Added to “${list.name}”`);
                        } catch (e) {
                          toast((e as Error).message, "error");
                        }
                      }}
                      className="text-[11px] font-semibold text-brand-700 hover:text-brand-600"
                    >
                      Add
                    </button>
                  </div>
                )) : (
                  <a href="/lists" className="text-[11px] font-medium text-brand-700 hover:text-brand-600">Create a list</a>
                )}
                {lists.length > 3 ? <a href="/lists" className="block text-[11px] text-ink-mute hover:text-ink">View all lists</a> : null}
              </div>
            )}
          </Card>

          <AiPanel
            title="Zybble AI"
            facts={[
              {
                label: "Rating",
                value: lead.rating ? `${lead.rating.toFixed(1)} · ${lead.reviews} reviews` : "No rating",
                icon: <Star className="size-2.5" aria-hidden="true" />,
              },
              {
                label: "Presence",
                value: lead.website ? "Website found" : "No website",
                icon: <Landmark className="size-2.5" aria-hidden="true" />,
              },
              {
                label: "Contact",
                value: lead.email ? "Email + phone" : lead.phone ? "Phone only" : "None found",
                icon: <Mail className="size-2.5" aria-hidden="true" />,
              },
            ]}
            busy={aiBusy}
            actions={[
              {
                id: "analyze",
                label: aiLines.length ? "Re-analyze this lead" : "Analyze this lead",
                hint: "Reads the business data above",
                icon: <Sparkles className="size-3" aria-hidden="true" />,
                onClick: runAi,
                busy: aiBusy,
              },
            ]}
          >
            {aiLines.length > 0 && !aiBusy ? (
              <div className="rounded-md border border-brand-600/15 bg-brand-50/50 p-2.5">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-700">
                  <Check className="size-3" aria-hidden="true" />
                  AI analysis
                </p>
                <ul className="mt-2 space-y-1.5">
                  {aiLines.map((line) => (
                    <li key={line} className="flex gap-1.5 text-[11.5px] leading-4.5 text-ink-soft">
                      <span className="mt-[6px] size-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[9.5px] text-neutral-400">AI generated · verify before outreach</p>
              </div>
            ) : null}
          </AiPanel>

          <Card className="p-3.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
              <Tag className="size-3" aria-hidden="true" />
              Tags
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {lead.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex h-5 items-center gap-1 rounded bg-neutral-100 pl-1.5 pr-1 text-[11px] font-medium text-ink-soft"
                >
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => removeTag(tag)}
                    className="grid size-4 place-items-center rounded text-neutral-400 hover:bg-black/[0.06] hover:text-ink"
                  >
                    <X className="size-2.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
              {!lead.tags.length ? <p className="text-[11px] text-neutral-400">No tags yet.</p> : null}
            </div>
            <div className="mt-2 flex gap-1.5">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add a tag…"
                aria-label="Add a tag"
                className="h-7 text-[11px]"
              />
              <Btn variant="outline" size="sm" onClick={addTag} className="shrink-0" disabled={!tagInput.trim()}>
                <Plus className="size-3" aria-hidden="true" />
              </Btn>
            </div>
          </Card>

          <Card className="p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Notes</p>
            <ul className="mt-2 space-y-2.5">
              {lead.notes.length === 0 ? (
                <li className="text-[11px] leading-4.5 text-neutral-400">
                  No notes yet — something worth remembering about this business?
                </li>
              ) : (
                lead.notes.map((n) => (
                  <li
                    key={n.id}
                    className="group flex gap-2 rounded-md border border-black/[0.05] bg-neutral-50/60 p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] leading-4.5 text-ink-soft">{n.body}</p>
                      <p className="mt-1 text-[9.5px] text-neutral-400">
                        {n.author} · {relative(n.at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Delete note"
                      onClick={async () => {
                        setLead((l) => (l ? { ...l, notes: l.notes.filter((x) => x.id !== n.id) } : l));
                        try {
                          await deleteLeadNote(n.id);
                        } catch {
                          /* already removed locally */
                        }
                      }}
                      className="grid size-5 shrink-0 place-items-center rounded text-neutral-300 opacity-0 transition-all hover:bg-black/[0.06] hover:text-red-600 group-hover:opacity-100"
                    >
                      <Trash2 className="size-2.5" aria-hidden="true" />
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="mt-2.5">
              <FieldLabel htmlFor="lead-note">Add a note</FieldLabel>
              <Textarea
                id="lead-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What's worth remembering about this lead?"
              />
              <Btn variant="outline" size="sm" className="mt-1.5 w-full" onClick={addNote} disabled={!note.trim()}>
                Save note
              </Btn>
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
