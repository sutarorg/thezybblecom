/* ------------------------------------------------------------------ */
/* Admin console — shared presentation primitives                      */
/*                                                                     */
/* Built on the customer app's design language (same tokens, spacing,  */
/* radii and brand accent) so the console reads as the same product,   */
/* while the admin shell itself stays visually distinct.               */
/*                                                                     */
/* Nothing in here invents data: every component renders what the API  */
/* returned, and says so plainly when there is nothing to render.      */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Copy, Inbox, RefreshCw } from "lucide-react";
import { cn } from "../../utils/cn";
import { Badge, Btn, Card, Dialog, DialogHeader, EmptyState, Input, Skel, Textarea } from "../components/ui";

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */
export function formatNumber(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString() : "0";
}

/** Plan prices and payments are stored in the minor unit (paise). */
export function formatMoney(minor: unknown, currency = "INR"): string {
  const value = Number(minor ?? 0) / 100;
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

export function formatDateTime(iso: unknown): string {
  if (!iso) return "—";
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(iso: unknown): string {
  if (!iso) return "—";
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function timeAgo(iso: unknown): string {
  if (!iso) return "Never";
  const then = new Date(String(iso)).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  return formatDay(iso);
}

export const titleCase = (value: unknown) =>
  String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/* ------------------------------------------------------------------ */
/* Status vocabulary — exactly the values the database uses            */
/* ------------------------------------------------------------------ */
const STATUS_TONES: Record<string, "neutral" | "green" | "amber" | "red" | "sky" | "violet"> = {
  // subscriptions
  active: "green",
  trialing: "sky",
  authenticated: "sky",
  created: "neutral",
  pending: "amber",
  past_due: "amber",
  halted: "red",
  paused: "amber",
  cancelled: "neutral",
  expired: "neutral",
  completed: "neutral",
  failed: "red",
  // payments / invoices
  captured: "green",
  refunded: "violet",
  paid: "green",
  upcoming: "sky",
  // searches / jobs / exports / ai
  queued: "neutral",
  processing: "sky",
  fetching: "sky",
  normalizing: "sky",
  deduplicating: "sky",
  saving: "sky",
  partial: "amber",
  preparing: "neutral",
  // webhooks
  received: "amber",
  processed: "green",
  // health
  healthy: "green",
  degraded: "amber",
  failing: "red",
  unknown: "neutral",
  // audit
  success: "green",
  // accounts
  admin: "violet",
  user: "neutral",
  none: "neutral",
};

export function StatusBadge({ value, className }: { value: unknown; className?: string }) {
  const raw = String(value ?? "").trim();
  if (!raw) return <span className="text-xs text-neutral-400">—</span>;
  return (
    <Badge tone={STATUS_TONES[raw] ?? "neutral"} className={className}>
      {titleCase(raw)}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Layout atoms                                                        */
/* ------------------------------------------------------------------ */
export function Panel({
  title,
  description,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.05] px-4 py-3">
          <div className="min-w-0">
            <p className="font-display text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</p>
            {description ? <p className="mt-0.5 text-[11px] leading-4 text-ink-mute">{description}</p> : null}
          </div>
          {aside ? <div className="flex flex-wrap items-center gap-1.5">{aside}</div> : null}
        </div>
      ) : null}
      <div className={cn("px-4 py-3.5", bodyClassName)}>{children}</div>
    </Card>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "warn" | "danger" | "brand";
  loading?: boolean;
}) {
  return (
    <Card className="px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-400">{label}</p>
      {loading ? (
        <Skel className="mt-2 h-6 w-20" />
      ) : (
        <p
          className={cn(
            "font-display mt-1 text-[19px] font-semibold tracking-[-0.02em] tabular-nums",
            tone === "warn" && "text-amber-700",
            tone === "danger" && "text-red-600",
            tone === "brand" && "text-brand-700",
            (!tone || tone === "default") && "text-ink",
          )}
        >
          {value}
        </p>
      )}
      {hint ? <p className="mt-0.5 text-[11px] leading-4 text-ink-mute">{hint}</p> : null}
    </Card>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-2.5 lg:grid-cols-4", className)}>{children}</div>;
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] text-ink-mute">{item.label}</dt>
          <dd className="mt-0.5 truncate text-xs font-medium text-ink">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CopyValue({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!value) return <span className="text-xs text-neutral-400">—</span>;
  return (
    <button
      type="button"
      title={`Copy ${label ?? "value"}`}
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
      className="group inline-flex max-w-full items-center gap-1 rounded text-left font-mono text-[11px] text-ink-soft transition-colors hover:text-ink"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="size-3 shrink-0 text-brand-600" aria-hidden="true" />
      ) : (
        <Copy className="size-3 shrink-0 text-neutral-300 group-hover:text-neutral-500" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * A router-aware button. `Btn href` renders a plain anchor, which would make
 * in-console navigation reload the whole bundle; inside /admin we always want
 * a client-side transition.
 */
export function LinkBtn({
  to,
  children,
  variant = "outline",
  className,
}: {
  to: string;
  children: ReactNode;
  variant?: "outline" | "ghost" | "primary";
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex h-7 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded px-2.5 text-xs font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-brand-600/25 active:scale-[0.98]",
        variant === "outline" && "border border-black/[0.09] bg-white text-ink hover:border-black/[0.16] hover:bg-neutral-50",
        variant === "ghost" && "text-ink-soft hover:bg-black/[0.045] hover:text-ink",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-red-200 bg-red-50/40 px-6 py-10 text-center">
      <AlertTriangle className="size-4 text-red-500" aria-hidden="true" />
      <p className="mt-2 text-[13px] font-medium text-ink">Couldn't load this data</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-ink-mute">{message}</p>
      {onRetry ? (
        <Btn variant="outline" size="sm" className="mt-3.5" onClick={onRetry}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Try again
        </Btn>
      ) : null}
    </div>
  );
}

export function Nothing({ title, description }: { title: string; description?: string }) {
  return <EmptyState icon={<Inbox className="size-4" aria-hidden="true" />} title={title} description={description} />;
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */
export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Right-aligned numeric column. */
  numeric?: boolean;
  className?: string;
  render: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  loading,
  rowKey,
  onRowClick,
  empty,
  minWidth = "min-w-[720px]",
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  empty: ReactNode;
  minWidth?: string;
}) {
  if (!loading && rows.length === 0) return <>{empty}</>;

  return (
    /* Inner scroll container: the page itself never scrolls sideways. */
    <div className="-mx-4 overflow-x-auto px-4 thin-scroll">
      <table className={cn("w-full border-collapse text-left", minWidth)}>
        <thead>
          <tr className="border-b border-black/[0.07]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-2 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-400 first:pl-0 last:pr-0",
                  column.numeric && "text-right",
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0
            ? Array.from({ length: 6 }).map((_, index) => (
                <tr key={`skeleton-${index}`} className="border-b border-black/[0.04]">
                  {columns.map((column) => (
                    <td key={column.key} className="px-2 py-2.5 first:pl-0 last:pr-0">
                      <Skel className="h-3.5 w-full max-w-[140px]" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-black/[0.04] last:border-0",
                    onRowClick && "cursor-pointer transition-colors hover:bg-black/[0.02]",
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-2 py-2.5 align-middle text-xs text-ink-soft first:pl-0 last:pr-0",
                        column.numeric && "text-right tabular-nums",
                      )}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

export function PagerBar({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.05] pt-3">
      <p className="text-[11px] text-ink-mute">
        {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
      </p>
      <div className="flex items-center gap-1">
        <Btn variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Btn>
        <span className="px-1 text-[11px] text-ink-mute">
          {page} / {totalPages}
        </span>
        <Btn variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Btn>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filters (URL-backed, so a refresh or a shared link keeps the view)  */
/* ------------------------------------------------------------------ */
export function useFilters() {
  const [params, setParams] = useSearchParams();

  const get = (key: string, fallback = "") => params.get(key) ?? fallback;

  const set = (patch: Record<string, string | number | null | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    if (resetPage && !("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  return { params, get, set, page, setPage: (value: number) => set({ page: value }, false) };
}

export const RANGE_OPTIONS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "all", label: "All time" },
] as const;

export function RangeFilter({
  value,
  from,
  to,
  onChange,
}: {
  value: string;
  from: string;
  to: string;
  onChange: (patch: { range?: string; from?: string | null; to?: string | null }) => void;
}) {
  const custom = value === "custom";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="inline-flex rounded border border-black/[0.09] bg-white p-0.5">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange({ range: option.id, from: null, to: null })}
            aria-pressed={value === option.id}
            className={cn(
              "h-6 rounded px-2 text-[11px] font-medium transition-colors",
              value === option.id ? "bg-ink text-white" : "text-ink-soft hover:bg-black/[0.04]",
            )}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ range: "custom" })}
          aria-pressed={custom}
          className={cn(
            "h-6 rounded px-2 text-[11px] font-medium transition-colors",
            custom ? "bg-ink text-white" : "text-ink-soft hover:bg-black/[0.04]",
          )}
        >
          Custom
        </button>
      </div>
      {custom ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="From date"
            value={from.slice(0, 10)}
            max={to.slice(0, 10) || undefined}
            onChange={(event) => onChange({ range: "custom", from: event.target.value })}
            className="h-7 w-[138px]"
          />
          <span className="text-[11px] text-ink-mute">to</span>
          <Input
            type="date"
            aria-label="To date"
            value={to.slice(0, 10)}
            min={from.slice(0, 10) || undefined}
            onChange={(event) => onChange({ range: "custom", to: event.target.value })}
            className="h-7 w-[138px]"
          />
        </div>
      ) : null}
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  width = "w-[150px]",
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  width?: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-7 rounded border border-black/[0.09] bg-white px-2 text-[11px] text-ink outline-none transition-colors focus:border-brand-600/50 focus:ring-2 focus:ring-brand-600/15",
          width,
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Search box that only pushes a change once typing settles. */
export function DebouncedSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => onChange(draft.trim()), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <Input
      type="search"
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      className={cn("h-7 w-full sm:w-[240px]", className)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Charts — plotted from API rows only, never from constants           */
/* ------------------------------------------------------------------ */
export type SeriesPoint = { date: string; value: number };

export function BarSeries({
  points,
  label,
  valueFormat = formatNumber,
  height = 96,
}: {
  points: SeriesPoint[];
  label: string;
  valueFormat?: (value: number) => string;
  height?: number;
}) {
  const max = useMemo(() => points.reduce((peak, point) => Math.max(peak, point.value), 0), [points]);

  if (!points.length) {
    return (
      <p className="py-6 text-center text-[11px] text-ink-mute">No {label.toLowerCase()} recorded in this range.</p>
    );
  }
  if (max === 0) {
    return (
      <div className="flex items-end gap-px" style={{ height }} aria-hidden="true">
        {points.map((point) => (
          <div key={point.date} className="h-px flex-1 bg-black/[0.08]" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end gap-px" style={{ height }} role="img" aria-label={`${label} by day`}>
        {points.map((point) => (
          <div
            key={point.date}
            title={`${point.date}: ${valueFormat(point.value)}`}
            className="flex-1 rounded-t-[2px] bg-brand-600/80 transition-colors hover:bg-brand-700"
            style={{ height: `${Math.max((point.value / max) * 100, point.value > 0 ? 3 : 0.5)}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-neutral-400">
        <span>{points[0]?.date}</span>
        <span>
          peak {valueFormat(max)} · {label}
        </span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export function DistributionBar({
  items,
  total,
}: {
  items: { label: string; value: number; tone?: string }[];
  total?: number;
}) {
  const sum = total ?? items.reduce((acc, item) => acc + item.value, 0);
  if (!sum) return <p className="text-[11px] text-ink-mute">Nothing recorded yet.</p>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-ink-soft">{item.label}</span>
            <span className="tabular-nums text-ink-mute">
              {formatNumber(item.value)} · {Math.round((item.value / sum) * 100)}%
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
            <div
              className={cn("h-full rounded-full", item.tone ?? "bg-brand-600")}
              style={{ width: `${Math.min(100, (item.value / sum) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Renders a `{status: count}` map from the API as badges. */
export function CountChips({ counts }: { counts: Record<string, unknown> | null | undefined }) {
  const entries = Object.entries(counts ?? {}).filter(([, value]) => Number(value) > 0);
  if (!entries.length) return <span className="text-[11px] text-ink-mute">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([key, value]) => (
          <span key={key} className="inline-flex items-center gap-1">
            <StatusBadge value={key} />
            <span className="text-[11px] tabular-nums text-ink-mute">{formatNumber(value)}</span>
          </span>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Privileged action dialog                                            */
/*                                                                     */
/* Every mutation in the console goes through this: an explicit        */
/* confirmation plus a reason, both of which the server requires and   */
/* records in the audit log. No silent privileged writes.              */
/* ------------------------------------------------------------------ */
export function ActionDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  danger,
  children,
  busy,
  error,
  reasonLabel = "Reason (recorded in the audit log)",
  reasonPlaceholder = "e.g. support ticket #1423 — customer confirmed by email",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  children?: ReactNode;
  busy?: boolean;
  error?: string | null;
  reasonLabel?: string;
  reasonPlaceholder?: string;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} label={title} maxWidth="max-w-md">
      <DialogHeader title={title} description={description} onClose={onClose} />
      <div className="space-y-3 px-4 py-3.5">
        {children}
        <div>
          <label htmlFor="admin-action-reason" className="mb-1.5 block text-xs font-medium text-ink">
            {reasonLabel}
          </label>
          <Textarea
            id="admin-action-reason"
            value={reason}
            data-dialog-autofocus
            onChange={(event) => setReason(event.target.value)}
            placeholder={reasonPlaceholder}
            className="min-h-[72px] text-xs"
          />
        </div>
        {error ? (
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-4 text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-1.5 pt-0.5">
          <Btn variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            disabled={busy || reason.trim().length < 5}
            onClick={() => void onConfirm(reason.trim())}
            className={cn(danger && "bg-red-600 shadow-none hover:bg-red-700")}
          >
            {busy ? "Working…" : confirmLabel}
          </Btn>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Honest "this isn't tracked" note                                    */
/* ------------------------------------------------------------------ */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="rounded border border-black/[0.07] bg-neutral-50 px-2.5 py-2 text-[11px] leading-4 text-ink-mute">
      {children}
    </p>
  );
}

export function LoadingPanel({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skel key={index} className="h-4 w-full" />
      ))}
    </div>
  );
}
