/* ------------------------------------------------------------------ */
/* Zybble app — the lead table (selection, sort, bulk, pagination)     */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  ListPlus,
  MoreHorizontal,
  SearchX,
  Sparkles,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { cn } from "../../utils/cn";
import type { Lead } from "../data/types";
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  IconBtn,
  Pagination,
  PopItem as MenuItem,
  PopSep,
  Popover,
  Skel,
  useToast,
} from "./ui";
import { navigate } from "../hooks";

type SortKey = "name" | "rating" | "reviews" | "updated";

const STATUS_TONE: Record<Lead["status"], { tone: "neutral" | "green" | "amber"; label: string }> = {
  new: { tone: "neutral", label: "New" },
  enriched: { tone: "green", label: "Enriched" },
  contacted: { tone: "amber", label: "Contacted" },
};

function listBadge(lead: Lead, listNames: Record<string, string>) {
  if (!lead.list_ids.length) return <span className="text-[11px] text-neutral-300">—</span>;
  const first = listNames[lead.list_ids[0]];
  return (
    <span className="flex items-center gap-1">
      <Badge className={cn("max-w-[132px] truncate")} tone="neutral">
        {first ?? "In a list"}
      </Badge>
      {lead.list_ids.length > 1 ? (
        <span className="text-[11px] text-neutral-400">+{lead.list_ids.length - 1}</span>
      ) : null}
    </span>
  );
}

export function LeadsTable({
  leads,
  loading,
  error,
  onRetry,
  pageSize = 10,
  onBulk,
  noLists,
  listNames = {},
  emptyState,
}: {
  leads: Lead[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  pageSize?: number;
  onBulk?: (action: "list" | "export" | "tag" | "delete", ids: string[]) => void;
  noLists?: boolean;
  listNames?: Record<string, string>;
  emptyState?: React.ReactNode;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const arr = [...leads];
    arr.sort((a, b) => {
      let d = 0;
      if (sortKey === "name") d = a.name.localeCompare(b.name);
      else if (sortKey === "rating") d = a.rating - b.rating;
      else if (sortKey === "reviews") d = a.reviews - b.reviews;
      else d = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      return d * sortDir;
    });
    return arr;
  }, [leads, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  useEffect(() => setPage(1), [leads.length]);
  useEffect(() => {
    setSelected((s) => new Set([...s].filter((id) => sorted.some((l) => l.id === id))));
  }, [sorted]);

  const allOnPage = pageRows.length > 0 && pageRows.every((l) => selected.has(l.id));
  const togglePage = () => {
    setSelected((s) => {
      const next = new Set(s);
      if (allOnPage) pageRows.forEach((l) => next.delete(l.id));
      else pageRows.forEach((l) => next.add(l.id));
      return next;
    });
  };
  const toggleRow = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sortBtn = (key: SortKey, label: string, className?: string) => (
    <button
      type="button"
      onClick={() => {
        if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
        else {
          setSortKey(key);
          setSortDir(key === "name" ? 1 : -1);
        }
      }}
      className={cn(
        "group inline-flex select-none items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors",
        sortKey === key ? "text-ink" : "text-neutral-400 hover:text-ink-soft",
        className
      )}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {sortKey === key ? (
        sortDir === 1 ? (
          <ArrowUp className="size-3" aria-hidden="true" />
        ) : (
          <ArrowDown className="size-3" aria-hidden="true" />
        )
      ) : (
        <ArrowUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" />
      )}
    </button>
  );

  if (error) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-red-50 text-red-600">
            <SearchX className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[13px] font-medium text-ink">We couldn't load these leads</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-mute">{error}</p>
            {onRetry ? (
              <Btn variant="outline" size="sm" className="mt-3" onClick={onRetry}>
                Try again
              </Btn>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* bulk toolbar */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] bg-brand-50/60 px-3 py-2">
          <span className="inline-flex h-5 items-center gap-1 rounded bg-brand-600 px-1.5 text-[11px] font-semibold text-white">
            <Check className="size-3" aria-hidden="true" />
            {selected.size} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Btn
              variant="outline"
              size="sm"
              onClick={() => {
                onBulk?.("list", [...selected]);
                toast(`${selected.size} ${selected.size === 1 ? "lead" : "leads"} added to list`);
              }}
            >
              <ListPlus className="size-3.5" aria-hidden="true" />
              Add to list
            </Btn>
            <Btn
              variant="outline"
              size="sm"
              onClick={() => {
                onBulk?.("export", [...selected]);
                toast("Export started — find it in Exports", "info");
              }}
            >
              <Download className="size-3.5" aria-hidden="true" />
              Export
            </Btn>
            <Btn
              variant="outline"
              size="sm"
              onClick={() => {
                onBulk?.("tag", [...selected]);
                toast("Tags updated");
              }}
            >
              <Tag className="size-3.5" aria-hidden="true" />
              Tag
            </Btn>
            <Btn
              variant="outline"
              size="sm"
              onClick={() => {
                onBulk?.("delete", [...selected]);
                setSelected(new Set());
                toast("Leads removed");
              }}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Delete
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Btn>
          </div>
        </div>
      ) : null}

      {loading ? (
        <LeadsTableSkeleton rows={Math.min(pageSize, 10)} noLists={noLists} />
      ) : leads.length === 0 ? (
        <div className="p-4">
          {emptyState ?? (
            <EmptyState
              icon={<SearchX className="size-4" aria-hidden="true" />}
              title="No leads match"
              description="Adjust your search or filters — or run a new search to find more businesses."
              action={<Btn variant="primary" href="/find">Find leads</Btn>}
            />
          )}
        </div>
      ) : (
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[860px] text-left" role="grid" aria-label="Leads">
            <thead>
              <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                <th scope="col" className="w-9 py-2 pl-3 pr-2">
                  <input
                    type="checkbox"
                    aria-label="Select all leads on this page"
                    checked={allOnPage}
                    onChange={togglePage}
                    className="size-3.5 cursor-pointer accent-brand-600"
                  />
                </th>
                <th scope="col" className="py-2 pr-3" aria-sort={sortKey === "name" ? (sortDir === 1 ? "ascending" : "descending") : undefined}>
                  {sortBtn("name", "Business")}
                </th>
                <th scope="col" className="hidden py-2 pr-3 lg:table-cell">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400">Category</span>
                </th>
                <th scope="col" className="py-2 pr-3" aria-sort={sortKey === "rating" ? (sortDir === 1 ? "ascending" : "descending") : undefined}>
                  {sortBtn("rating", "Rating")}
                </th>
                <th scope="col" className="hidden py-2 pr-3 xl:table-cell">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400">Phone</span>
                </th>
                <th scope="col" className="hidden py-2 pr-3 md:table-cell">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400">Website</span>
                </th>
                <th scope="col" className="hidden py-2 pr-3 sm:table-cell">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400">Location</span>
                </th>
                <th scope="col" className="py-2 pr-3">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400">Status</span>
                </th>
                <th scope="col" className={cn("py-2 pr-3", noLists && "hidden")}>
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400">List</span>
                </th>
                <th scope="col" className="w-10 py-2 pr-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((lead) => {
                const isSelected = selected.has(lead.id);
                return (
                  <tr
                    key={lead.id}
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    className={cn(
                      "cursor-pointer border-b border-black/[0.04] transition-colors last:border-0 hover:bg-neutral-50/70",
                      isSelected && "bg-brand-50/40 hover:bg-brand-50/60"
                    )}
                    aria-selected={isSelected}
                  >
                    <td className="py-2 pl-3 pr-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${lead.name}`}
                        checked={isSelected}
                        onChange={() => toggleRow(lead.id)}
                        className="size-3.5 cursor-pointer accent-brand-600"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <LeadAvatar lead={lead} />
                        <span className="min-w-0">
                          <span className="block max-w-[220px] truncate text-xs font-medium text-ink">
                            {lead.name}
                          </span>
                          <span className="block max-w-[220px] truncate text-[11px] text-ink-mute">
                            {lead.email ?? lead.website_domain ?? "—"}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden py-2 pr-3 lg:table-cell">
                      <span className="text-xs text-ink-soft">{lead.category}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                        <span className="text-xs font-medium text-ink">{lead.rating.toFixed(1)}</span>
                        <span className="hidden text-[11px] text-neutral-400 min-[480px]:inline">({lead.reviews})</span>
                      </span>
                    </td>
                    <td className="hidden py-2 pr-3 xl:table-cell">
                      <span className="whitespace-nowrap text-xs text-ink-soft">{lead.phone}</span>
                    </td>
                    <td className="hidden py-2 pr-3 md:table-cell">
                      {lead.website_domain ? (
                        <a
                          href={`https://${lead.website_domain}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex max-w-[150px] items-center gap-1 truncate text-xs text-ink-soft transition-colors hover:text-brand-700"
                        >
                          <Globe className="size-3 shrink-0 text-neutral-300" aria-hidden="true" />
                          <span className="truncate">{lead.website_domain}</span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="hidden py-2 pr-3 text-xs text-ink-soft sm:table-cell">
                      {lead.city}, {lead.state}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={STATUS_TONE[lead.status].tone}>{STATUS_TONE[lead.status].label}</Badge>
                    </td>
                    <td className={cn("py-2 pr-3", noLists && "hidden")}>{listBadge(lead, listNames)}</td>
                    <td className="py-2 pr-2" onClick={(e) => e.stopPropagation()}>
                      <Popover
                        align="end"
                        width="w-48"
                        trigger={(_, toggle) => (
                          <IconBtn variant="ghost" label={`Actions for ${lead.name}`} onClick={toggle}>
                            <MoreHorizontal className="size-3.5" aria-hidden="true" />
                          </IconBtn>
                        )}
                      >
                        <MenuItem icon={<ExternalLink className="size-3.5" aria-hidden="true" />} onClick={() => navigate(`/leads/${lead.id}`)}>
                          View lead
                        </MenuItem>
                        <MenuItem
                          icon={<ListPlus className="size-3.5" aria-hidden="true" />}
                          onClick={() => toast(`“${lead.name}” added to a list`)}
                        >
                          Add to list
                        </MenuItem>
                        <MenuItem icon={<Sparkles className="size-3.5" aria-hidden="true" />} onClick={() => toast("Zybble AI analysis started", "info")}>
                          Analyze with AI
                        </MenuItem>
                        <MenuItem
                          icon={<Copy className="size-3.5" aria-hidden="true" />}
                          onClick={() => toast("Phone number copied")}
                        >
                          Copy phone
                        </MenuItem>
                        <PopSep />
                        <MenuItem danger onClick={() => toast("Lead removed")}>
                          Delete
                        </MenuItem>
                      </Popover>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* footer */}
      {!loading && leads.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] px-3 py-2">
          <p className="text-[11px] text-ink-mute">
            {(clampedPage - 1) * pageSize + 1}–{Math.min(clampedPage * pageSize, sorted.length)} of{" "}
            {sorted.length.toLocaleString()} leads
          </p>
          <Pagination page={clampedPage} totalPages={totalPages} total={sorted.length} onPage={setPage} />
        </div>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- */
/* Skeleton that mirrors the real table exactly (no layout shift)    */
/* ---------------------------------------------------------------- */
export function LeadsTableSkeleton({
  rows = 10,
  noLists,
}: {
  rows?: number;
  noLists?: boolean;
}) {
  const widths = ["w-40", "w-52", "w-36", "w-48", "w-44", "w-56", "w-40", "w-44", "w-36", "w-52"];
  return (
    <div className="thin-scroll overflow-x-auto" aria-hidden="true">
      <table className="w-full min-w-[860px] text-left">
        <thead>
          <tr className="border-b border-black/[0.06] bg-neutral-50/50">
            <th className="w-9 py-2 pl-3 pr-2">
              <span className="block size-3.5 rounded-sm bg-black/[0.07]" />
            </th>
            <th className="py-2 pr-3">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-300">Business</span>
            </th>
            <th className="hidden py-2 pr-3 lg:table-cell">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-300">Category</span>
            </th>
            <th className="py-2 pr-3">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-300">Rating</span>
            </th>
            <th className="hidden py-2 pr-3 xl:table-cell">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-300">Phone</span>
            </th>
            <th className="hidden py-2 pr-3 md:table-cell">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-300">Website</span>
            </th>
            <th className="hidden py-2 pr-3 sm:table-cell">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-300">Location</span>
            </th>
            <th className="py-2 pr-3">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-300">Status</span>
            </th>
            <th className={cn("py-2 pr-3", noLists && "hidden")}>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-300">List</span>
            </th>
            <th className="w-10 py-2 pr-3" />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i} className="border-b border-black/[0.04] last:border-0">
              <td className="py-2 pl-3 pr-2">
                <Skel className="size-3.5 rounded-sm" />
              </td>
              {/* business: avatar + two lines, matching real row height */}
              <td className="py-2 pr-3">
                <span className="flex items-center gap-2.5">
                  <Skel className="size-6 rounded-md" />
                  <span className="min-w-0 space-y-1">
                    <Skel className={cn("block h-2.5 rounded", widths[i % widths.length])} />
                    <Skel className="block h-2 w-24 rounded" />
                  </span>
                </span>
              </td>
              <td className="hidden py-2 pr-3 lg:table-cell">
                <Skel className="h-2.5 w-20 rounded" />
              </td>
              <td className="py-2 pr-3">
                <span className="inline-flex items-center gap-1">
                  <Skel className="size-3 rounded-sm" />
                  <Skel className="h-2.5 w-6 rounded" />
                </span>
              </td>
              <td className="hidden py-2 pr-3 xl:table-cell">
                <Skel className="h-2.5 w-24 rounded" />
              </td>
              <td className="hidden py-2 pr-3 md:table-cell">
                <Skel className="h-2.5 w-28 rounded" />
              </td>
              <td className="hidden py-2 pr-3 sm:table-cell">
                <Skel className="h-2.5 w-20 rounded" />
              </td>
              <td className="py-2 pr-3">
                <Skel className="h-5 w-14 rounded" />
              </td>
              <td className={cn("py-2 pr-3", noLists && "hidden")}>
                <Skel className="h-5 w-16 rounded" />
              </td>
              <td className="py-2 pr-2">
                <Skel className="size-4 rounded" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* footer placeholder keeps total height stable */}
      <div className="flex items-center justify-between border-t border-black/[0.06] px-3 py-2">
        <Skel className="h-2.5 w-36 rounded" />
        <Skel className="h-6 w-40 rounded" />
      </div>
    </div>
  );
}

/* Small deterministic business avatar */
export function LeadAvatar({ lead, className }: { lead: Lead; className?: string }) {
  const initials = lead.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  const tints = [
    "bg-sky-50 text-sky-700",
    "bg-emerald-50 text-emerald-700",
    "bg-amber-50 text-amber-700",
    "bg-violet-50 text-violet-700",
    "bg-rose-50 text-rose-700",
    "bg-stone-100 text-stone-600",
  ];
  let h = 0;
  for (const ch of lead.name) h = (h * 31 + ch.charCodeAt(0)) % 977;
  return (
    <span
      className={cn("grid size-6 shrink-0 place-items-center rounded-md text-[8.5px] font-bold", tints[h % tints.length], className)}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export { STATUS_TONE };
