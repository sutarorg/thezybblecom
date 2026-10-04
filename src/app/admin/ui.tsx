/* ------------------------------------------------------------------ */
/* Admin-console primitives.                                           */
/*                                                                     */
/* These compose the existing Zybble design system (Btn, Badge, Card,  */
/* EmptyState, Skel, Pagination from ../components/ui) into the dense  */
/* operator patterns the panel needs. No new visual language, no new   */
/* colour palette, no new dependency.                                  */
/* ------------------------------------------------------------------ */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Inbox, RotateCw, Search as SearchIcon, X } from "lucide-react";
import { cn } from "../../utils/cn";
import { Badge, Btn, Card, EmptyState, Pagination, Skel } from "../components/ui";

/* ------------------------------------------------------------------ */
/* Numbers + dates                                                     */
/* ------------------------------------------------------------------ */
export const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const compact = (value: unknown) =>
  new Intl.NumberFormat("en-US", { notation: num(value) >= 10_000 ? "compact" : "standard" }).format(num(value));

export const full = (value: unknown) => num(value).toLocaleString("en-US");

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dateOnly(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export function ago(iso: string | null | undefined) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  return dateOnly(iso);
}

/** Minor currency units (paise/cents) → a localised amount. */
export function money(minor: unknown, currency = "INR") {
  const amount = num(minor) / 100;
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/* ------------------------------------------------------------------ */
/* Page header                                                         */
/* ------------------------------------------------------------------ */
export function PageHead({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-lg font-semibold tracking-[-0.02em] text-ink sm:text-xl">{title}</h1>
        {description ? <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-mute">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */
export function Metric({
  label,
  value,
  hint,
  tone = "neutral",
  loading,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  loading?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="truncate text-[10.5px] font-medium uppercase tracking-[0.08em] text-neutral-400">{label}</p>
      {loading ? (
        <Skel className="mt-2 h-6 w-16" />
      ) : (
        <p
          className={cn(
            "font-display mt-1 text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums",
            tone === "good" && "text-brand-700",
            tone === "warn" && "text-amber-600",
            tone === "bad" && "text-red-600",
            tone === "neutral" && "text-ink",
          )}
        >
          {value}
        </p>
      )}
      {hint ? <p className="mt-0.5 truncate text-[11px] leading-4 text-ink-mute">{hint}</p> : null}
    </>
  );

  const className = "min-w-0 rounded-lg border border-black/[0.06] bg-white px-3.5 py-3 text-left";
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(className, "transition-colors hover:border-black/[0.14] hover:bg-neutral-50")}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

export function MetricGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 | 5 }) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-2 gap-2 sm:gap-2.5",
        cols === 3 && "lg:grid-cols-3",
        cols === 4 && "md:grid-cols-3 xl:grid-cols-4",
        cols === 5 && "md:grid-cols-3 xl:grid-cols-5",
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */
export function Section({
  title,
  description,
  aside,
  children,
  className,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-[11.5px] leading-5 text-ink-mute">{description}</p> : null}
        </div>
        {aside ? <div className="flex flex-wrap items-center gap-1.5">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Status badges — tones are derived from the REAL status vocabularies */
/* enforced by the database CHECK constraints.                         */
/* ------------------------------------------------------------------ */
type Tone = "neutral" | "green" | "amber" | "red" | "sky" | "violet";

const STATUS_TONES: Record<string, Tone> = {
  // subscriptions
  active: "green", trialing: "sky", authenticated: "sky", created: "neutral",
  pending: "amber", past_due: "amber", paused: "amber", halted: "red",
  cancelled: "neutral", expired: "neutral", completed: "neutral", failed: "red",
  // searches / jobs / exports
  queued: "neutral", processing: "sky", fetching: "sky", normalizing: "sky",
  deduplicating: "sky", saving: "sky", partial: "amber", preparing: "neutral",
  // invoices
  paid: "green", refunded: "violet", upcoming: "neutral",
  // webhooks
  received: "amber", processed: "green",
  // accounts / leads
  suspended: "red", new: "sky", contacted: "green", admin: "violet", user: "neutral",
  // health
  healthy: "green", degraded: "amber", failing: "red", unknown: "neutral",
};

export function StatusBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  const key = String(value ?? "").toLowerCase();
  if (!key) return <span className="text-xs text-neutral-300">—</span>;
  return (
    <Badge tone={STATUS_TONES[key] ?? "neutral"} className={className}>
      {key.replace(/_/g, " ")}
    </Badge>
  );
}

export function PlanBadge({ plan }: { plan: string | null | undefined }) {
  const key = String(plan ?? "free").toLowerCase();
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return <Badge tone={key === "free" ? "neutral" : key === "scale" ? "violet" : "green"}>{label}</Badge>;
}

/* ------------------------------------------------------------------ */
/* Filter bar                                                          */
/* ------------------------------------------------------------------ */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 flex min-w-0 flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar">{children}</div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-0 flex-1 sm:max-w-xs", className)}>
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-full rounded border border-black/[0.09] bg-white pl-8 pr-2.5 text-xs text-ink outline-none transition-colors placeholder:text-neutral-400 focus:border-black/[0.2] focus-visible:ring-2 focus-visible:ring-brand-600/20"
      />
    </div>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={cn(
        "h-8 shrink-0 rounded border border-black/[0.09] bg-white px-2 text-xs text-ink outline-none transition-colors focus:border-black/[0.2] focus-visible:ring-2 focus-visible:ring-brand-600/20",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Active-filter chip the operator can dismiss. */
export function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-black/[0.09] bg-neutral-50 pl-2 pr-1 text-[11px] text-ink-soft">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label}`}
        className="grid size-4 place-items-center rounded text-neutral-400 transition-colors hover:bg-black/[0.06] hover:text-ink"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}

export const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "custom", label: "Custom" },
];

export type PeriodState = { period: string; from: string; to: string };

export function PeriodPicker({ value, onChange }: { value: PeriodState; onChange: (v: PeriodState) => void }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <div className="inline-flex shrink-0 overflow-hidden rounded border border-black/[0.09] bg-white">
        {PERIOD_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange({ ...value, period: o.value })}
            aria-pressed={value.period === o.value}
            className={cn(
              "h-8 whitespace-nowrap px-2.5 text-[11.5px] font-medium transition-colors",
              value.period === o.value ? "bg-ink text-white" : "text-ink-soft hover:bg-neutral-50",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {value.period === "custom" ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <input
            type="date"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            aria-label="From date"
            className="h-8 rounded border border-black/[0.09] bg-white px-2 text-xs text-ink outline-none focus:border-black/[0.2]"
          />
          <span className="text-xs text-neutral-400">→</span>
          <input
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            aria-label="To date"
            className="h-8 rounded border border-black/[0.09] bg-white px-2 text-xs text-ink outline-none focus:border-black/[0.2]"
          />
        </div>
      ) : null}
    </div>
  );
}

/** Translate PeriodState into the query params the admin API expects. */
export function periodParams(p: PeriodState) {
  if (p.period !== "custom") return { period: p.period };
  if (!p.from || !p.to) return { period: "30d" };
  return { period: "custom", from: new Date(p.from).toISOString(), to: new Date(`${p.to}T23:59:59`).toISOString() };
}

export const defaultPeriod: PeriodState = { period: "30d", from: "", to: "" };

/* ------------------------------------------------------------------ */
/* Data table                                                          */
/* ------------------------------------------------------------------ */
export type Column<T> = {
  key: string;
  header: string;
  sortable?: boolean;
  align?: "left" | "right";
  /** Hide below the given breakpoint so mobile never scrolls sideways. */
  hide?: "sm" | "md" | "lg";
  width?: string;
  render: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  loading,
  error,
  empty,
  rowKey,
  onRowClick,
  sort,
  onSort,
  skeletonRows = 8,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  error?: string | null;
  empty?: { title: string; description?: string; action?: ReactNode };
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
  skeletonRows?: number;
}) {
  if (error) {
    return (
      <Card className="flex flex-col items-center px-6 py-10 text-center">
        <span className="grid size-9 place-items-center rounded-md bg-red-50 text-red-600">
          <AlertTriangle className="size-4" aria-hidden="true" />
        </span>
        <p className="mt-3 text-[13px] font-medium text-ink">That data couldn't be loaded</p>
        <p className="mt-1 max-w-md text-xs leading-5 text-ink-mute">{error}</p>
      </Card>
    );
  }

  const hideClass = (hide?: "sm" | "md" | "lg") =>
    hide === "sm" ? "hidden sm:table-cell" : hide === "md" ? "hidden md:table-cell" : hide === "lg" ? "hidden lg:table-cell" : "";

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="min-w-0 overflow-x-auto thin-scroll">
        <table className="w-full min-w-0 border-collapse text-left">
          <thead>
            <tr className="border-b border-black/[0.06] bg-neutral-50/60">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-neutral-500",
                      c.align === "right" && "text-right",
                      hideClass(c.hide),
                    )}
                  >
                    {c.sortable && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        aria-label={`Sort by ${c.header}`}
                        className={cn(
                          "inline-flex items-center gap-1 rounded transition-colors hover:text-ink",
                          active && "text-ink",
                          c.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {c.header}
                        {active ? (
                          sort!.dir === "asc" ? (
                            <ArrowUp className="size-3" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="size-3" aria-hidden="true" />
                          )
                        ) : null}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }).map((_, i) => (
                  <tr key={`s-${i}`} className="border-b border-black/[0.04] last:border-0">
                    {columns.map((c) => (
                      <td key={c.key} className={cn("px-3 py-2.5", hideClass(c.hide))}>
                        <Skel className="h-3.5 w-full max-w-[120px]" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                    className={cn(
                      "border-b border-black/[0.04] text-[12.5px] text-ink-soft last:border-0",
                      onRowClick &&
                        "cursor-pointer outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand-600/30",
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn("px-3 py-2.5 align-middle", c.align === "right" && "text-right tabular-nums", hideClass(c.hide))}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-4" aria-hidden="true" />}
          title={empty?.title ?? "Nothing here yet"}
          description={empty?.description}
          action={empty?.action}
          className="border-0 bg-transparent"
        />
      ) : null}
    </Card>
  );
}

export function TableFooter({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11.5px] text-ink-mute">
        {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
      </p>
      <Pagination page={page} totalPages={totalPages} total={total} onPage={onPage} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Key/value description list                                         */
/* ------------------------------------------------------------------ */
export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-neutral-400">{item.label}</dt>
          <dd className="mt-0.5 break-words text-[12.5px] text-ink">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Monospace identifier with click-to-copy — essential for support work. */
export function Mono({ value, truncate = true }: { value: string | null | undefined; truncate?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!value) return <span className="text-neutral-300">—</span>;
  return (
    <button
      type="button"
      title={`${value} — click to copy`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            timer.current = window.setTimeout(() => setCopied(false), 1200);
          },
          () => undefined,
        );
      }}
      className={cn(
        "inline-block max-w-full rounded bg-neutral-100 px-1.5 py-0.5 text-left font-mono text-[10.5px] text-ink-soft transition-colors hover:bg-neutral-200",
        truncate && "truncate align-middle",
      )}
    >
      {copied ? "copied" : value}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Charts — plain SVG over REAL series. No chart dependency, and no    */
/* hardcoded arrays: an empty dataset renders an empty state.          */
/* ------------------------------------------------------------------ */
export function BarSeries({
  points,
  keys,
  height = 120,
  emptyLabel = "No activity in this period.",
}: {
  points: Record<string, string | number>[];
  keys: { key: string; label: string; className: string }[];
  height?: number;
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...points.flatMap((p) => keys.map((k) => num(p[k.key]))));
  const hasData = points.some((p) => keys.some((k) => num(p[k.key]) > 0));

  if (!points.length || !hasData) {
    return (
      <div className="flex items-center justify-center rounded border border-dashed border-black/[0.08] px-4 py-8 text-center" style={{ minHeight: height }}>
        <p className="text-[11.5px] text-ink-mute">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end gap-px overflow-hidden" style={{ height }} role="img" aria-label={keys.map((k) => k.label).join(", ")}>
        {points.map((p) => (
          <div key={String(p.day)} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-px" title={`${p.day}: ${keys.map((k) => `${k.label} ${num(p[k.key])}`).join(", ")}`}>
            {keys.map((k) => {
              const value = num(p[k.key]);
              return (
                <div
                  key={k.key}
                  className={cn("w-full rounded-t-[2px]", k.className)}
                  style={{ height: `${(value / max) * 100}%`, minHeight: value > 0 ? 2 : 0 }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {keys.map((k) => (
            <span key={k.key} className="inline-flex items-center gap-1.5 text-[10.5px] text-ink-mute">
              <span className={cn("size-2 rounded-[2px]", k.className)} aria-hidden="true" />
              {k.label}
            </span>
          ))}
        </div>
        <span className="text-[10.5px] text-neutral-400">peak {full(max)}</span>
      </div>
    </div>
  );
}

/** Horizontal distribution bars for a `{ label: count }` map. */
export function Distribution({
  data,
  total,
  emptyLabel = "No data yet.",
  limit = 8,
  renderLabel,
}: {
  data: Record<string, number> | undefined | null;
  total?: number;
  emptyLabel?: string;
  limit?: number;
  renderLabel?: (key: string) => ReactNode;
}) {
  const entries = Object.entries(data ?? {})
    .map(([k, v]) => [k, num(v)] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (!entries.length) return <p className="py-3 text-[11.5px] text-ink-mute">{emptyLabel}</p>;
  const sum = total ?? entries.reduce((acc, [, v]) => acc + v, 0);

  return (
    <ul className="space-y-2">
      {entries.map(([key, value]) => (
        <li key={key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[11.5px] text-ink-soft">{renderLabel ? renderLabel(key) : key.replace(/_/g, " ")}</span>
            <span className="shrink-0 text-[11.5px] tabular-nums text-ink">{full(value)}</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${sum > 0 ? (value / sum) * 100 : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */
export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-center px-6 py-10 text-center">
      <span className="grid size-9 place-items-center rounded-md bg-red-50 text-red-600">
        <AlertTriangle className="size-4" aria-hidden="true" />
      </span>
      <p className="mt-3 text-[13px] font-medium text-ink">Couldn't load this page</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-ink-mute">{message}</p>
      {onRetry ? (
        <Btn variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw className="size-3.5" aria-hidden="true" />
          Try again
        </Btn>
      ) : null}
    </Card>
  );
}

export function LoadingMetrics({ count = 4 }: { count?: number }) {
  return (
    <MetricGrid>
      {Array.from({ length: count }).map((_, i) => (
        <Metric key={i} label="" value="" loading />
      ))}
    </MetricGrid>
  );
}

/** A metric the schema genuinely cannot support — labelled, never faked. */
export function Unavailable({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-dashed border-black/[0.1] bg-white/60 px-3.5 py-3">
      <p className="truncate text-[10.5px] font-medium uppercase tracking-[0.08em] text-neutral-400">{label}</p>
      <p className="font-display mt-1 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-neutral-300">—</p>
      <p className="mt-0.5 text-[11px] leading-4 text-ink-mute">{reason}</p>
    </div>
  );
}
