/* ------------------------------------------------------------------ */
/* Admin console — dedicated shell                                     */
/*                                                                     */
/* Deliberately NOT the customer AppLayout: a different chrome makes   */
/* it obvious at a glance that you are looking at every tenant's data, */
/* not your own workspace. Same design tokens, same typography scale,  */
/* same brand accent.                                                  */
/* ------------------------------------------------------------------ */
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  Bot,
  CreditCard,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Lock,
  PanelLeft,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { ZybbleMark } from "../../components/primitives";
import { Btn } from "../components/ui";
import { useAdminAccess, type AdminIdentity } from "./client";

export type { AdminIdentity };

type NavItem = { label: string; to: string; icon: React.ElementType; exact?: boolean };
type NavGroup = { label: string; items: NavItem[] };

export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", to: "/admin", icon: LayoutDashboard, exact: true }],
  },
  {
    label: "Customers",
    items: [
      { label: "Users", to: "/admin/users", icon: Users },
      { label: "Workspaces", to: "/admin/workspaces", icon: ListChecks },
    ],
  },
  {
    label: "Revenue",
    items: [
      { label: "Billing", to: "/admin/billing", icon: CreditCard },
      { label: "Plans", to: "/admin/plans", icon: ShieldCheck },
    ],
  },
  {
    label: "Product",
    items: [
      { label: "Searches", to: "/admin/searches", icon: Search },
      { label: "Leads", to: "/admin/leads", icon: Activity },
      { label: "Usage", to: "/admin/usage", icon: Gauge },
      { label: "AI", to: "/admin/ai", icon: Bot },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Webhooks", to: "/admin/webhooks", icon: Webhook },
      { label: "Audit logs", to: "/admin/audit-logs", icon: ScrollText },
      { label: "System", to: "/admin/system", icon: Server },
    ],
  },
  {
    label: "Administration",
    items: [{ label: "Settings", to: "/admin/settings", icon: Settings }],
  },
];

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.to || pathname === `${item.to}/`;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function SidebarBody({ onNavigate, identity }: { onNavigate?: () => void; identity: AdminIdentity }) {
  const { pathname } = useLocation();
  return (
    <div className="flex h-full flex-col bg-ink text-white/80">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-4">
        <ZybbleMark className="size-5 text-white" />
        <span className="font-display text-sm font-semibold tracking-[-0.02em] text-white">Zybble</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-white/70">
          Admin
        </span>
      </div>

      <nav aria-label="Admin navigation" className="thin-scroll flex-1 overflow-y-auto px-3 py-3">
        {ADMIN_NAV.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/35">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded px-2 py-[7px] text-[13px] transition-colors",
                        active
                          ? "bg-white/[0.12] font-medium text-white"
                          : "text-white/65 hover:bg-white/[0.07] hover:text-white",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/10 px-3 py-3">
        <div className="px-2">
          <p className="truncate text-[11px] font-medium text-white">{identity.name || "Administrator"}</p>
          <p className="truncate text-[10.5px] text-white/50">{identity.email}</p>
        </div>
        <Link
          to="/overview"
          onClick={onNavigate}
          className="mt-2.5 flex items-center gap-2 rounded px-2 py-[7px] text-[12px] text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to the app
        </Link>
      </div>
    </div>
  );
}

/**
 * Access gate. The decision is made by the server (`GET /api/admin/me`);
 * this component only renders the outcome. Nothing privileged is fetched
 * until that call has succeeded.
 */
export function AdminGate({ children }: { children: (identity: AdminIdentity) => ReactNode }) {
  const access = useAdminAccess();
  const location = useLocation();

  if (access.state === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <span
            className="size-6 animate-spin rounded-full border-2 border-black/[0.08] border-t-brand-600"
            aria-hidden="true"
          />
          <p className="text-xs text-ink-mute">Checking your admin access…</p>
        </div>
      </div>
    );
  }

  if (access.state === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (access.state === "forbidden") {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-5">
        <div className="w-full max-w-sm text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-lg bg-neutral-100 text-ink-mute">
            <Lock className="size-4" aria-hidden="true" />
          </span>
          <h1 className="font-display mt-4 text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Admin access required
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-ink-mute">
            Your account doesn't have the admin role, so the console is closed to it. If you think that's wrong, ask an
            existing administrator to grant it from Admin → Settings.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link
              to="/overview"
              className="inline-flex h-8 items-center rounded bg-brand-600 px-3 text-xs font-medium text-white transition-colors hover:bg-brand-700"
            >
              Back to the app
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (access.state === "error") {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-5">
        <div className="w-full max-w-sm text-center">
          <h1 className="font-display text-[18px] font-semibold tracking-[-0.02em] text-ink">
            The admin service isn't responding
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-ink-mute">{access.message}</p>
          <Btn variant="outline" size="md" className="mt-4" onClick={() => window.location.reload()}>
            Reload
          </Btn>
        </div>
      </div>
    );
  }

  return <>{children(access.identity)}</>;
}

export function AdminLayout({
  identity,
  title,
  description,
  aside,
  children,
}: {
  identity: AdminIdentity;
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.title = `${title} · Zybble Admin`;
    document.head
      .querySelector<HTMLMetaElement>('meta[name="robots"]')
      ?.setAttribute("content", "noindex, nofollow");
  }, [title]);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] lg:block">
        <SidebarBody identity={identity} />
      </aside>

      {mobileOpen ? (
        <>
          <div
            className="fade-in fixed inset-0 z-[75] bg-ink/40 backdrop-blur-[1.5px]"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
          <div className="drawer-in-left fixed inset-y-0 left-0 z-[76] w-[248px] shadow-2xl">
            <SidebarBody identity={identity} onNavigate={() => setMobileOpen(false)} />
          </div>
        </>
      ) : null}

      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex h-12 w-full shrink-0 items-center gap-2 border-b border-black/[0.06] bg-paper/90 px-3 backdrop-blur-md sm:px-5">
          <button
            type="button"
            aria-label="Open admin navigation"
            onClick={() => setMobileOpen(true)}
            className="grid size-7 place-items-center rounded text-ink-mute transition-colors hover:bg-black/[0.045] hover:text-ink lg:hidden"
          >
            <PanelLeft className="size-4" aria-hidden="true" />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="hidden text-ink-mute sm:inline">Admin</span>
            <span className="hidden text-neutral-300 sm:inline" aria-hidden="true">
              /
            </span>
            <span className="truncate font-medium text-ink">{title}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[11px] text-ink-mute sm:inline">{identity.email}</span>
            <Link
              to="/overview"
              className="rounded border border-black/[0.09] bg-white px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-neutral-50"
            >
              Exit admin
            </Link>
          </div>
        </header>

        <div className="mx-auto w-full min-w-0 max-w-[1380px] px-3 sm:px-5 lg:px-7">
          <div className="flex flex-wrap items-end justify-between gap-3 pt-5 sm:pt-6">
            <div className="min-w-0">
              <h1 className="font-display text-lg font-semibold tracking-[-0.02em] text-ink sm:text-xl">{title}</h1>
              {description ? (
                <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-mute sm:text-[13px]">{description}</p>
              ) : null}
            </div>
            {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
          </div>
          <main className="min-w-0 pb-16 pt-5">{children}</main>
        </div>
      </div>
    </div>
  );
}
