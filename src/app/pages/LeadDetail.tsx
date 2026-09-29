/* ------------------------------------------------------------------ */
/* Zybble app — Lead detail                                            */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Download,
  Globe,
  Landmark,
  ListPlus,
  Loader2,
  Mail,
  Navigation,
  Phone,
  Plus,
  Send,
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
  FieldLabel,
  Input,
  SectionTitle,
  Skel,
  Textarea,
  formatDate,
  relative,
  useToast,
} from "../components/ui";
import { LEADS, LISTS } from "../data/mock";
import type { Lead, Note } from "../data/types";
import { useAppSeo } from "../hooks";
import {
  BACKEND_ENABLED,
  addLeadNote,
  addToList,
  analyzeLead,
  deleteLeadNote,
  getLead,
  getLeadInsight,
  updateLeadStatus,
  updateLeadTags,
} from "../services/api";
import { useWorkspace } from "../services/hooks";

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-black/[0.04] py-2 last:border-0">
      <dt className="shrink-0 text-[11px] text-ink-mute">{label}</dt>
      <dd className={cn("min-w-0 text-right text-xs text-ink", mono && "break-all font-mono text-[10.5px] leading-4.5 text-ink-soft")}>
        {value}
      </dd>
    </div>
  );
}

const OPEN_META: Record<Lead["open_state"], { tone: "green" | "neutral" | "red"; label: string }> = {
  open: { tone: "green", label: "Open now" },
  closed: { tone: "neutral", label: "Closed" },
  unknown: { tone: "neutral", label: "Hours unknown" },
};

export function LeadDetailPage({ id }: { id: string }) {
  const base = useMemo(() => LEADS.find((l) => l.id === id) ?? LEADS[0], [id]);
  const [lead, setLead] = useState<Lead>(base);
  useAppSeo(`${lead.name} — Zybble`, `${lead.category} in ${lead.city} — business detail and AI intelligence.`, `/leads/${id}`);
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const { workspace } = useWorkspace();
  useEffect(() => {
    setLead(base);
    setLoading(true);
    const t = window.setTimeout(() => setLoading(false), 420);
    return () => window.clearTimeout(t);
  }, [id, base]);

  useEffect(() => {
    if (!BACKEND_ENABLED || !workspace) return;
    setLoading(true);
    getLead(id, workspace.id).then((found) => {
      if (found) setLead(found);
      setLoading(false);
    }).catch(() => setLoading(false));
    getLeadInsight(id).then((insight) => {
      if (insight) setAiLines(insight.points.length ? [insight.summary, ...insight.points] : [insight.summary]);
    }).catch(() => undefined);
  }, [id, workspace]);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiLines, setAiLines] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [tagInput, setTagInput] = useState("");

  const lists = useMemo(() => LISTS.filter((l) => lead.list_ids.includes(l.id)), [lead]);
  const statusMeta = STATUS_TONE[lead.status];

  const runAi = async () => {
    if (aiBusy) return;
    if (BACKEND_ENABLED && workspace) {
      setAiBusy(true);
      const { result, error } = await analyzeLead(lead.id, workspace.id);
      setAiBusy(false);
      if (error || !result) {
        toast(error ?? "AI analysis couldn't run right now.", "error");
        return;
      }
      setAiLines([result.summary, ...result.points]);
      toast("AI analysis ready");
      return;
    }
    setAiBusy(true);
    window.setTimeout(() => {
      setAiBusy(false);
      setAiLines([
        `Strong local presence — ${lead.rating.toFixed(1)} across ${lead.reviews.toLocaleString()} reviews.`,
        lead.website ? `Website detected at ${lead.website_domain} with a direct contact channel.` : "No website detected — phone is the primary channel.",
        lead.email ? `Email available: ${lead.email} — outreach-ready.` : "No public email found — consider phone or form first.",
        "Potential outreach opportunity for growth and reputation services.",
      ]);
      toast("AI analysis ready");
    }, 1300);
  };

  const addNote = async () => {
    if (!note.trim()) return;
    if (BACKEND_ENABLED) {
      const created = await addLeadNote(lead.id, note.trim());
      if (created) {
        setLead((l) => ({ ...l, notes: [created, ...l.notes] }));
      }
    } else {
      const next: Note = {
        id: `note-${Date.now()}`,
        author: "Avery Chen",
        body: note.trim(),
        at: new Date().toISOString(),
      };
      setLead((l) => ({ ...l, notes: [next, ...l.notes] }));
    }
    setNote("");
    toast("Note added");
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || lead.tags.includes(t)) return;
    const tags = [...lead.tags, t];
    setLead((l) => ({ ...l, tags }));
    if (BACKEND_ENABLED) updateLeadTags(lead.id, tags);
    setTagInput("");
  };

  return (
    <AppLayout title="Lead detail" wide>
      {/* back + header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <a
          href="#/leads"
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-mute transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Leads
        </a>
        <div className="flex items-center gap-1.5">
          <Btn variant="outline" size="sm" onClick={() => toast("Lead exported", "info")}>
            <Download className="size-3.5" aria-hidden="true" />
            Export
          </Btn>
          <Btn
            variant="outline"
            size="sm"
            onClick={() => {
              if (BACKEND_ENABLED && lead.list_ids[0]) addToList(lead.list_ids[0], [lead.id]);
              toast("Saved to a list");
            }}
          >
            <ListPlus className="size-3.5" aria-hidden="true" />
            Save to list
          </Btn>
          {lead.status !== "contacted" ? (
            <Btn
              variant="primary"
              size="sm"
              onClick={() => {
                setLead((l) => ({ ...l, status: "contacted" }));
                if (BACKEND_ENABLED) updateLeadStatus(lead.id, "contacted");
                toast("Marked as contacted");
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

      {loading ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]" aria-hidden="true">
          <div className="space-y-3">
            {[280, 200, 180, 160].map((h, i) => (
              <Card key={i} className="p-4">
                <Skel className="h-3 w-28" />
                <div className="mt-4 space-y-2.5" style={{ height: h / 3 }}>
                  <Skel className="h-2.5 w-full" />
                  <Skel className="h-2.5 w-2/3" />
                  <Skel className="h-2.5 w-1/2" />
                </div>
              </Card>
            ))}
          </div>
          <Card className="h-fit p-4">
            <Skel className="h-3 w-24" />
            <Skel className="mt-4 h-24 w-full" />
            <Skel className="mt-3 h-20 w-full" />
          </Card>
        </div>
      ) : (
        <>
          {/* lead heading */}
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
                    <span aria-hidden="true">·</span>
                    <span>{lead.address}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                      <span className="font-medium text-ink">{lead.rating.toFixed(1)}</span>
                      <span>({lead.reviews.toLocaleString()} reviews)</span>
                    </span>
                  </p>
                </div>
              </div>
              <a
                href={lead.maps_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded border border-black/[0.09] px-2.5 text-xs font-medium text-ink-soft transition-colors hover:border-black/[0.16] hover:text-ink"
              >
                Open in Google Maps
                <ArrowUpRight className="size-3 text-neutral-400" aria-hidden="true" />
              </a>
            </div>
          </Card>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* left column */}
            <div className="min-w-0 space-y-3">
              {/* business information */}
              <Card>
                <div className="px-4 pt-4">
                  <SectionTitle title="Business information" />
                </div>
                <dl className="px-4 pb-3 pt-2">
                  <DetailRow label="Name" value={lead.name} />
                  <DetailRow label="Categories" value={lead.categories.join(", ")} />
                  <DetailRow label="Description" value={lead.description} />
                  <DetailRow label="Price tier" value={lead.price ?? "—"} />
                  <DetailRow
                    label="Rating"
                    value={
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                        {lead.rating.toFixed(1)} · {lead.reviews.toLocaleString()} reviews
                      </span>
                    }
                  />
                  <DetailRow label="Types" value={<span className="font-mono text-[10.5px] text-ink-soft">{lead.types.join("  ")}</span>} />
                </dl>
              </Card>

              {/* contact */}
              <Card>
                <div className="px-4 pt-4">
                  <SectionTitle title="Contact" />
                </div>
                <div className="grid gap-2 px-4 pb-4 pt-3 sm:grid-cols-2">
                  {[
                    { icon: Phone, label: "Phone", value: lead.phone, sub: lead.phone_normalized, copy: lead.phone },
                    { icon: Mail, label: "Email", value: lead.email ?? "Not publicly listed", copy: lead.email ?? undefined },
                    { icon: Globe, label: "Website", value: lead.website_domain ?? "None detected", href: lead.website ? `https://${lead.website_domain}` : undefined },
                    { icon: Clock, label: "Hours", value: lead.hours_display },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center gap-2.5 rounded-md border border-black/[0.05] bg-neutral-50/60 px-3 py-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white text-neutral-400 ring-1 ring-black/[0.05]">
                        <row.icon className="size-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-neutral-400">{row.label}</p>
                        {row.href ? (
                          <a href={row.href} target="_blank" rel="noreferrer" className="block truncate text-xs font-medium text-brand-700 hover:text-brand-600">
                            {row.value}
                          </a>
                        ) : (
                          <p className="truncate text-xs font-medium text-ink">{row.value}</p>
                        )}
                        {row.sub ? <p className="font-mono text-[9.5px] text-neutral-400">{row.sub}</p> : null}
                      </div>
                      {row.copy ? (
                        <button
                          type="button"
                          aria-label={`Copy ${row.label}`}
                          onClick={() => toast(`${row.label} copied`)}
                          className="grid size-6 shrink-0 place-items-center rounded text-neutral-300 transition-colors hover:bg-black/[0.05] hover:text-ink"
                        >
                          <Copy className="size-3" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Card>

              {/* location */}
              <Card>
                <div className="px-4 pt-4">
                  <SectionTitle title="Location" />
                </div>
                <dl className="px-4 pb-3 pt-2">
                  <DetailRow label="Address" value={lead.address} />
                  <DetailRow label="City" value={lead.city} />
                  <DetailRow label="State" value={`${lead.state} ${lead.postal_code}`} />
                  <DetailRow label="Country" value={`${lead.country} (${lead.country_code})`} />
                  <DetailRow
                    label="Coordinates"
                    value={
                      <span className="inline-flex items-center gap-1 text-ink-soft">
                        <Navigation className="size-3 text-neutral-300" aria-hidden="true" />
                        {lead.latitude.toFixed(5)}, {lead.longitude.toFixed(5)}
                      </span>
                    }
                  />
                  <DetailRow label="Plus code" value={<span className="font-mono text-[10.5px] text-ink-soft">{lead.plus_code}</span>} />
                </dl>
              </Card>

              {/* details */}
              <Card>
                <div className="px-4 pt-4">
                  <SectionTitle title="Hours & amenities" />
                </div>
                <div className="grid gap-4 px-4 pb-4 pt-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Opening hours</p>
                    <ul className="space-y-1">
                      {Object.entries(lead.hours).map(([day, hours]) => {
                        const today = new Date().toLocaleDateString("en-US", { weekday: "long" }) === day;
                        return (
                          <li key={day} className={cn("flex items-center gap-2 text-[11.5px]", today ? "rounded bg-brand-50/70 px-1.5 py-0.5 -mx-1.5 font-medium text-brand-800 text-brand-700" : "text-ink-soft")}>
                            <span className="w-[72px] shrink-0">{day.slice(0, 3)}</span>
                            <span className={hours === "Closed" ? "text-neutral-400" : ""}>{hours}</span>
                            {today ? <span className="ml-auto text-[9.5px]">Today</span> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Services</p>
                    <div className="flex flex-wrap gap-1">
                      {lead.services.map((s) => (
                        <Badge key={s} tone="neutral">
                          {s}
                        </Badge>
                      ))}
                    </div>
                    <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Attributes</p>
                    <div className="flex flex-wrap gap-1">
                      {lead.attributes.map((a) => (
                        <Badge key={a} tone="neutral" className="bg-neutral-50">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              {/* source */}
              <Card>
                <div className="px-4 pt-4">
                  <SectionTitle title="Source information" description="Technical identifiers from the origin listing." />
                </div>
                <dl className="px-4 pb-3 pt-2">
                  <DetailRow label="Source" value={lead.source} />
                  <DetailRow label="Place ID" value={lead.place_id} mono />
                  <DetailRow label="Data CID" value={lead.data_cid} mono />
                  <DetailRow label="KGMID" value={lead.kgmid} mono />
                  <DetailRow label="Collected" value={formatDate(lead.collected_at)} />
                  <DetailRow label="Last updated" value={`${relative(lead.updated_at)}`} />
                  <DetailRow label="Origin search" value={`“${lead.search_query}”`} />
                </dl>
              </Card>
            </div>

            {/* right column */}
            <div className="min-w-0 space-y-3 lg:sticky lg:top-[60px] lg:self-start">
              {/* lists */}
              <Card className="p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Saved in</p>
                {lists.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {lists.map((list) => (
                      <a key={list.id} href={`#/lists/${list.id}`}>
                        <Badge tone="green" className="cursor-pointer transition-colors hover:bg-brand-100">
                          {list.name}
                        </Badge>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2">
                    <Btn variant="outline" size="sm" onClick={() => toast("Saved to a list")}>
                      <ListPlus className="size-3.5" aria-hidden="true" />
                      Save to a list
                    </Btn>
                  </div>
                )}
                <p className="mt-3 border-t border-black/[0.05] pt-3 text-[10px] leading-4 text-neutral-400">
                  Collected from “{lead.search_location}” result set
                </p>
              </Card>

              {/* AI panel */}
              <AiPanel
                title="Zybble AI"
                facts={[
                  { label: "Rating", value: `${lead.rating.toFixed(1)} · ${lead.reviews} reviews`, icon: <Star className="size-2.5" aria-hidden="true" /> },
                  { label: "Presence", value: lead.website ? "Website found" : "No website", icon: <Landmark className="size-2.5" aria-hidden="true" /> },
                  { label: "Contact", value: lead.email ? "Email + phone" : "Phone only", icon: <Mail className="size-2.5" aria-hidden="true" /> },
                ]}
                busy={aiBusy}
                actions={[
                  {
                    id: "analyze",
                    label: aiLines.length ? "Re-analyze this lead" : "Analyze this lead",
                    hint: "Reads the business data above",
                    icon: <X className="hidden" />,
                    onClick: runAi,
                    busy: aiBusy,
                  },
                ]}
              >
                {aiLines.length > 0 && !aiBusy ? (
                  <div className="rounded-md border border-brand-600/15 bg-brand-50/50 p-2.5">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-700">
                      <Loader2 className="hidden" />
                      <Check className="size-3" aria-hidden="true" />
                      AI analysis ready
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

              {/* tags */}
              <Card className="p-3.5">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                  <Tag className="size-3" aria-hidden="true" />
                  Tags
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {lead.tags.map((tag) => (
                    <span key={tag} className="inline-flex h-5 items-center gap-1 rounded bg-neutral-100 pl-1.5 pr-1 text-[11px] font-medium text-ink-soft">
                      {tag}
                      <button
                        type="button"
                        aria-label={`Remove tag ${tag}`}
                        onClick={() => setLead((l) => ({ ...l, tags: l.tags.filter((t) => t !== tag) }))}
                        className="grid size-4 place-items-center rounded text-neutral-400 hover:bg-black/[0.06] hover:text-ink"
                      >
                        <X className="size-2.5" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addTag();
                    }}
                    placeholder="Add a tag…"
                    aria-label="Add a tag"
                    className="h-7 text-[11px]"
                  />
                  <Btn variant="outline" size="sm" onClick={addTag} className="shrink-0">
                    <Plus className="size-3" aria-hidden="true" />
                  </Btn>
                </div>
              </Card>

              {/* notes */}
              <Card className="p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Notes</p>
                <ul className="mt-2 space-y-2.5">
                  {lead.notes.length === 0 ? (
                    <li className="text-[11px] leading-4.5 text-neutral-400">No notes yet — something worth remembering about this business?</li>
                  ) : (
                    lead.notes.map((n) => (
                      <li key={n.id} className="group flex gap-2 rounded-md border border-black/[0.05] bg-neutral-50/60 p-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11.5px] leading-4.5 text-ink-soft">{n.body}</p>
                          <p className="mt-1 text-[9.5px] text-neutral-400">
                            {n.author} · {relative(n.at)}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label="Delete note"
                          onClick={() => {
                            setLead((l) => ({ ...l, notes: l.notes.filter((x) => x.id !== n.id) }));
                            if (BACKEND_ENABLED) deleteLeadNote(n.id);
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
        </>
      )}
    </AppLayout>
  );
}
