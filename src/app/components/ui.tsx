/* ------------------------------------------------------------------ */
/* Zybble app — shared UI primitives (quiet, dense, MultiFeed-family)  */
/* ------------------------------------------------------------------ */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "../../utils/cn";
import { formatAppDate, relativeAppTime } from "../lib/datetime";

/* ------------------------------------------------------------------ */
/* Kbd                                                                 */
/* ------------------------------------------------------------------ */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4.5 items-center rounded border border-black/[0.08] bg-neutral-50 px-1 font-sans text-[9.5px] font-medium text-neutral-400",
        className
      )}
    >
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */
type BtnProps = {
  children: ReactNode;
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
  className?: string;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  label?: string;
};

export function Btn({
  children,
  variant = "outline",
  size = "md",
  className,
  href,
  onClick,
  disabled,
  type = "button",
  title,
  label,
}: BtnProps) {
  const classes = cn(
    "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-brand-600/25 focus-visible:ring-offset-1 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    size === "sm" && "h-7 px-2.5 text-xs",
    size === "md" && "h-8 px-3 text-xs",
    size === "icon" && "size-7",
    variant === "primary" &&
      "bg-brand-600 text-white shadow-[0_1px_2px_rgba(11,99,67,0.22),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-brand-700",
    variant === "outline" &&
      "border border-black/[0.09] bg-white text-ink hover:border-black/[0.16] hover:bg-neutral-50",
    variant === "ghost" && "text-ink-soft hover:bg-black/[0.045] hover:text-ink",
    variant === "danger" && "text-red-600 hover:bg-red-50",
    className
  );
  if (href) {
    return (
      <a href={href} className={classes} title={title} aria-label={label}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={classes} title={title} aria-label={label}>
      {children}
    </button>
  );
}

export function IconBtn(props: Omit<BtnProps, "size"> & { label: string }) {
  return <Btn {...props} size="icon" label={props.label} className={cn("text-ink-mute", props.className)} />;
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "sky" | "violet";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium leading-none",
        tone === "neutral" && "bg-neutral-100 text-ink-soft",
        tone === "green" && "bg-brand-50 text-brand-700",
        tone === "amber" && "bg-amber-50 text-amber-700",
        tone === "red" && "bg-red-50 text-red-650 text-red-700",
        tone === "sky" && "bg-sky-50 text-sky-700",
        tone === "violet" && "bg-violet-50 text-violet-700",
        className
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Avatar                                                              */
/* ------------------------------------------------------------------ */
export function Avatar({
  name,
  tint,
  src,
  size = "md",
  className,
}: {
  name: string;
  tint: string;
  src?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  const sizeClass =
    size === "xs" ? "size-4.5 text-[7px]" : size === "sm" ? "size-6 text-[9px]" : size === "lg" ? "size-9 text-xs" : "size-7 text-[10px]";
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold tracking-wide",
        tint,
        sizeClass,
        className
      )}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Card / surfaces                                                     */
/* ------------------------------------------------------------------ */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-black/[0.06] bg-white", className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */
export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-medium text-ink"
    >
      {children}
    </label>
  );
}

export const inputCls =
  "h-8 w-full rounded border border-black/[0.09] bg-white px-2.5 text-xs text-ink placeholder:text-neutral-400 outline-none transition-colors focus:border-brand-600/50 focus:ring-2 focus:ring-brand-600/15";

export function Input({
  error,
  className,
  id,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return <input id={id} {...rest} className={cn(inputCls, error && "border-red-300 focus:border-red-500 focus:ring-red-500/10", className)} />;
}

export function Textarea({
  error,
  className,
  id,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }) {
  return (
    <textarea
      id={id}
      {...rest}
      className={cn(inputCls, "h-auto min-h-[92px] py-2 resize-y", error && "border-red-300", className)}
    />
  );
}

export function SearchInput({
  className,
  icon,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400">{icon}</span>
      <Input {...rest} className={cn("pl-8", className && "w-full")} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle switch                                                       */
/* ------------------------------------------------------------------ */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-200",
        checked ? "bg-brand-600" : "bg-black/[0.14]"
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] size-3.5 rounded-full bg-white shadow transition-all duration-200",
          checked ? "left-[14px]" : "left-[2px]"
        )}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Popover — anchor: relative wrapper, children menu                   */
/* ------------------------------------------------------------------ */
const PopCtx = createContext<() => void>(() => {});

export function Popover({
  trigger,
  children,
  align = "start",
  width,
}: {
  trigger: (open: boolean, toggle: () => void, ref: RefObject<HTMLButtonElement | null>) => ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, transformOrigin: "top left" });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const place = useCallback(() => {
    const anchor = rootRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const widthPx = panel?.width ?? 208;
    const heightPx = panel?.height ?? 220;
    const gap = 6;
    let left = align === "end" ? anchor.right - widthPx : anchor.left;
    left = Math.max(8, Math.min(left, window.innerWidth - widthPx - 8));
    let top = anchor.bottom + gap;
    let origin = align === "end" ? "top right" : "top left";
    if (top + heightPx > window.innerHeight - 8 && anchor.top - heightPx - gap > 8) {
      top = anchor.top - heightPx - gap;
      origin = align === "end" ? "bottom right" : "bottom left";
    } else {
      top = Math.min(top, window.innerHeight - heightPx - 8);
    }
    setPos({ top: Math.max(8, top), left, transformOrigin: origin });
  }, [align]);

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onMove = () => place();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (open) requestAnimationFrame(place);
  }, [open, children, place]);

  const toggle = () => setOpen((v) => !v);

  return (
    <div ref={rootRef} className="inline-block">
      {trigger(open, toggle, btnRef)}
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              className={cn(
                "pop-in fixed z-[90] max-h-[min(420px,calc(100vh-16px))] overflow-y-auto rounded-md border border-black/[0.08] bg-white p-1 shadow-pop thin-scroll",
                width ?? "w-52"
              )}
              style={{ top: pos.top, left: pos.left, transformOrigin: pos.transformOrigin }}
            >
              <PopCtx.Provider value={() => setOpen(false)}>{children}</PopCtx.Provider>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function PopItem({
  icon,
  children,
  onClick,
  danger,
  active,
  chevron,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  active?: boolean;
  chevron?: boolean;
}) {
  const close = useContext(PopCtx);
  return (
    <button
      role="menuitem"
      type="button"
      onClick={() => {
        onClick?.();
        close();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs outline-none transition-colors focus-visible:bg-black/[0.045]",
        danger
          ? "text-red-600 hover:bg-red-50"
          : active
            ? "font-medium text-ink"
            : "text-ink-soft hover:bg-black/[0.045] hover:text-ink"
      )}
    >
      {icon ? <span className="grid size-4 shrink-0 place-items-center text-neutral-400">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active ? <Check className="size-3 shrink-0 text-brand-600" aria-hidden="true" /> : null}
      {chevron ? <ChevronDown className="size-3 shrink-0 -rotate-90 text-neutral-300" aria-hidden="true" /> : null}
    </button>
  );
}

export function PopSep() {
  return <div className="my-1 h-px bg-black/[0.05]" aria-hidden="true" />;
}

export function PopLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Overlay primitives — portal, backdrop, esc                          */
/* ------------------------------------------------------------------ */
function useMountOverlay(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
}

export function Backdrop({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fade-in fixed inset-0 z-[65] bg-ink/30 backdrop-blur-[1.5px]"
      aria-hidden="true"
      onClick={onClose}
    />
  );
}

export function Dialog({
  open,
  onClose,
  children,
  label,
  maxWidth = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  maxWidth?: string;
}) {
  useMountOverlay(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <Backdrop onClose={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={cn("pop-in w-full rounded-xl border border-black/[0.07] bg-white shadow-pop", maxWidth)}
        >
          {children}
        </div>
      </div>
    </>,
    document.body
  );
}

export function DialogHeader({
  title,
  description,
  onClose,
}: {
  title: string;
  description?: string;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-black/[0.05] px-4 py-3.5">
      <div>
        <p className="font-display text-sm font-semibold tracking-[-0.01em] text-ink">{title}</p>
        {description ? <p className="mt-0.5 text-xs leading-5 text-ink-mute">{description}</p> : null}
      </div>
      {onClose ? (
        <IconBtn variant="ghost" label="Close dialog" onClick={onClose} className="-mr-1 -mt-0.5">
          <X className="size-3.5" aria-hidden="true" />
        </IconBtn>
      ) : null}
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  children,
  label,
  width = "w-[480px] max-w-[100vw]",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  width?: string;
}) {
  useMountOverlay(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <Backdrop onClose={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "drawer-in fixed inset-y-0 right-0 z-[70] flex flex-col border-l border-black/[0.07] bg-paper shadow-2xl",
          width
        )}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/* Confirm dialog                                                      */
/* ------------------------------------------------------------------ */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Delete",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} label={title} maxWidth="max-w-sm">
      <div className="px-4 py-4">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-xs leading-5 text-ink-mute">{description}</p>
        <div className="mt-4 flex justify-end gap-1.5">
          <Btn variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 shadow-none"
          >
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                            */
/* ------------------------------------------------------------------ */
export function Skel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={cn("skel inline-block rounded", className)} style={style} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg border border-dashed border-black/[0.1] bg-white/60 px-6 py-12 text-center", className)}>
      <span className="grid size-9 place-items-center rounded-md border border-black/[0.06] bg-white text-neutral-300">
        {icon}
      </span>
      <p className="mt-3 text-[13px] font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-xs text-xs leading-5 text-ink-mute">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */
export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const pages: (number | "…")[] = [];
  const window = 1;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= window) pages.push(p);
    else if (pages[pages.length - 1] !== "…") pages.push("…");
  }
  return (
    <nav aria-label="Pagination" className="flex items-center gap-1">
      <span className="sr-only">{total} results total</span>
      <Btn variant="ghost" size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}>
        Previous
      </Btn>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e-${i}`} className="px-1 text-xs text-neutral-300">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPage(p)}
            className={cn(
              "grid size-7 place-items-center rounded text-xs transition-colors",
              p === page
                ? "bg-ink font-medium text-white"
                : "text-ink-soft hover:bg-black/[0.045] hover:text-ink"
            )}
          >
            {p}
          </button>
        )
      )}
      <Btn variant="ghost" size="sm" disabled={page === totalPages} onClick={() => onPage(page + 1)}>
        Next
      </Btn>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */
type Toast = { id: number; text: string; tone: "success" | "error" | "info" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-1.5 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "toast-in pointer-events-auto flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium shadow-pop",
              t.tone === "success" && "border-brand-600/15 bg-white text-ink",
              t.tone === "info" && "border-black/[0.08] bg-white text-ink",
              t.tone === "error" && "border-red-200 bg-white text-red-700"
            )}
          >
            {t.tone === "success" ? (
              <Check className="size-3.5 text-brand-600" aria-hidden="true" />
            ) : (
              <span className={cn("size-1.5 rounded-full", t.tone === "error" ? "bg-red-500" : "bg-neutral-400")} aria-hidden="true" />
            )}
            {t.text}
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              className="grid size-4 place-items-center rounded text-neutral-400 hover:text-ink"
            >
              <X className="size-2.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Small text helpers                                                  */
/* ------------------------------------------------------------------ */
export function MetaText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[11px] text-ink-mute", className)}>{children}</span>;
}

export function SectionTitle({ title, description, aside, className }: { title: string; description?: string; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-2", className)}>
      <div>
        <h2 className="font-display text-sm font-semibold tracking-[-0.01em] text-ink sm:text-[15px]">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-xs text-ink-mute">{description}</p> : null}
      </div>
      {aside}
    </div>
  );
}

export function formatDate(iso: string) {
  return formatAppDate(iso);
}
export function relative(iso: string) {
  return relativeAppTime(iso);
}
