/* ------------------------------------------------------------------ */
/* Zybble admin — operator shell.                                      */
/*                                                                     */
/* A dedicated layout rather than AppLayout: the customer shell is     */
/* built around a workspace switcher and a plan/usage meter, neither   */
/* of which means anything for an operator. The visual language is     */
/* identical (paper/ink/brand, 1px borders, dense type) so the panel   */
/* reads as part of the same product.                                  */
/* ------------------------------------------------------------------ */
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  Bot,
  Building2,
  CreditCard,
  ExternalLink,
  FileClock,
  Gauge,
  LayoutGrid,
  LogOut,
  PanelLeft,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Tags,
  Users,
  Webhook,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { ZybbleMark } from "../../components/primitives";
import { navigate } from "../hooks";
import { signOut } from "../services/api";
import { Avatar, Badge, PopItem, PopSep, Popover } from "../components/ui";
import type { AppUser } from "../services/api";

type Item = { label: string; to: string; icon: React.ElementType; end?: boolean };
type Group = { label: string; items: Item[] };

export const ADMIN_NAV: Group[] = [
  { label: "Overview", items: [{ label: "Dashboard", to: "/admin", icon: LayoutGrid, end: true }] },
  {
    label: "Customers",
    items: [
      { label: "Users", to: "/admin/users", icon: Users },
      { label: "Workspaces", to: "/admin/workspaces", icon: Building2 },
    ],
  },
  {
    label: "Revenue",
    items: [
      { label: "Billing", to: "/admin/billing", icon: CreditCard },
      { label: "Plans", to: "/admin/plans", icon: Tags },
    ],
  },
  {
    label: "Product",
    items: [
      { label: "Searches", to: "/admin/searches", icon: Search },
      { label: "Leads", to: "/admin/leads", icon: FileClock },
      { label: "Usage", to: "/admin/usage", icon: Gauge },
      { label: "AI", to: "/admin/ai", icon: Bot },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Webhooks", to: "/admin/webhooks", icon: Webhook },
      { label: "System health", to: "/admin/system", icon: Activity },
      { label: "Audit logs", to: "/admin/audit-logs", icon: ScrollText },
    ],
  },
  { label: "Administration", items: [{ label: "Settings", to: "/admin/settings", icon: Settings }] },
];

function SidebarBody({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 shrink-0 items-center border-b border-black/[0.05]", collapsed ? "justify-center" : "px-4")}>
        <NavLink to="/admin" className="flex min-w-0 items-center gap-2" aria-label="Zybble admin">
          <ZybbleMark className="size-5.5 shrink-0" />
          {!collapsed ? (
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="font-display text-sm font-semibold tracking-[-0.02em] text-ink">Zybble</span>
              <Badge tone="violet" className="h-[17px]">
                Admin
              </Badge>
            </span>
          ) : null}
        </NavLink>
      </div>

      <nav aria-label="Admin navigation" className={cn("thin-scroll mt-3 flex-1 overflow-y-auto pb-4", collapsed ? "px-2" : "px-3")}>
        {ADMIN_NAV.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            {!collapsed ? (
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">{group.label}</p>
            ) : (
              <div className="my-3 h-px bg-black/[0.06]" aria-hidden="true" />
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex items-center gap-2.5 rounded px-2 py-[7px] text-[13px] transition-colors",
                          collapsed && "justify-center px-0",
                          isActive
                            ? "bg-black/[0.05] font-medium text-ink"
                            : "text-ink-soft hover:bg-black/[0.035] hover:text-ink",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            className={cn("size-4 shrink-0", isActive ? "text-brand-700" : "text-neutral-400 group-hover:text-ink-soft")}
                            aria-hidden="true"
                          />
                          {!collapsed ? <span className="truncate">{item.label}</span> : null}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("shrink-0 border-t border-black/[0.05] py-2", collapsed ? "px-2" : "px-3")}>
        <NavLink
          to="/overview"
          className={cn(
            "flex items-center gap-2.5 rounded px-2 py-[7px] text-[13px] text-ink-soft transition-colors hover:bg-black/[0.035] hover:text-ink",
            collapsed && "justify-center px-0",
          )}
          title={collapsed ? "Back to the app" : undefined}
        >
          <ExternalLink className="size-4 shrink-0 text-neutral-400" aria-hidden="true" />
          {!collapsed ? <span className="truncate">Back to the app</span> : null}
        </NavLink>
      </div>
    </div>
  );
}

export function AdminLayout({ children, user }: { children: ReactNode; user: AppUser }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();

  /* Close the mobile drawer on navigation and on Escape. */
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const crumb =
    ADMIN_NAV.flatMap((g) => g.items).find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)))?.label ?? "Admin";

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-black/[0.06] bg-paper transition-[width] duration-200 lg:block",
          collapsed ? "w-16" : "w-[248px]",
        )}
      >
        <SidebarBody collapsed={collapsed} />
      </aside>

      {mobileOpen ? (
        <>
          <div className="fade-in fixed inset-0 z-[75] bg-ink/30 backdrop-blur-[1.5px]" aria-hidden="true" onClick={() => setMobileOpen(false)} />
          <div className="drawer-in-left fixed inset-y-0 left-0 z-[76] w-[248px] max-w-[85vw] border-r border-black/[0.08] bg-paper shadow-2xl">
            <SidebarBody onNavigate={() => setMobileOpen(false)} />
          </div>
        </>
      ) : null}

      <div className={cn("flex min-h-dvh min-w-0 flex-col transition-[padding] duration-200", collapsed ? "lg:pl-16" : "lg:pl-[248px]")}>
        <header className="sticky top-0 z-30 flex h-12 w-full shrink-0 items-center gap-2 border-b border-black/[0.06] bg-paper/90 px-3 backdrop-blur-md sm:px-4">
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((v) => !v)}
            className="hidden size-7 place-items-center rounded text-ink-mute transition-colors hover:bg-black/[0.045] hover:text-ink lg:grid"
          >
            <PanelLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Open admin navigation"
            onClick={() => setMobileOpen(true)}
            className="grid size-7 place-items-center rounded text-ink-mute transition-colors hover:bg-black/[0.045] hover:text-ink lg:hidden"
          >
            <PanelLeft className="size-4" aria-hidden="true" />
          </button>

          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <ShieldCheck className="size-3.5 shrink-0 text-brand-700" aria-hidden="true" />
            <span className="hidden text-ink-mute min-[420px]:inline">Admin</span>
            <span className="hidden text-neutral-300 min-[420px]:inline" aria-hidden="true">
              /
            </span>
            <span className="truncate font-medium text-ink">{crumb}</span>
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <Popover
              align="end"
              width="w-56"
              trigger={(_, toggle) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Admin account menu"
                  className="rounded-full ring-brand-600/25 transition-shadow hover:ring-2 focus-visible:ring-2"
                >
                  <Avatar name={user.name} tint="bg-violet-50 text-violet-700" src={user.avatarUrl} />
                </button>
              )}
            >
              <div className="flex items-center gap-2.5 px-2 py-2">
                <Avatar name={user.name} tint="bg-violet-50 text-violet-700" src={user.avatarUrl} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink">{user.name}</p>
                  <p className="truncate text-[11px] text-ink-mute">{user.email}</p>
                </div>
              </div>
              <PopSep />
              <PopItem icon={<ExternalLink className="size-3.5" aria-hidden="true" />} onClick={() => navigate("/overview")}>
                Back to the app
              </PopItem>
              <PopItem icon={<Settings className="size-3.5" aria-hidden="true" />} onClick={() => navigate("/admin/settings")}>
                Admin settings
              </PopItem>
              <PopSep />
              <PopItem
                danger
                icon={<LogOut className="size-3.5" aria-hidden="true" />}
                onClick={async () => {
                  await signOut();
                  navigate("/login", { replace: true });
                }}
              >
                Log out
              </PopItem>
            </Popover>
          </div>
        </header>

        <main className="mx-auto w-full min-w-0 max-w-[1440px] px-3 pb-16 pt-5 sm:px-5 sm:pt-6 lg:px-7">{children}</main>
      </div>
    </div>
  );
}
