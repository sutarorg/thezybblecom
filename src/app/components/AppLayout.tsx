/* ------------------------------------------------------------------ */
/* Zybble app — authenticated shell (sidebar, topbar, content)         */
/* ------------------------------------------------------------------ */
import { useEffect, useState, type ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CreditCard,
  Download,
  FileSearch,
  Gauge,
  History,
  Home,
  ListChecks,
  LogOut,
  PanelLeft,
  Search,
  Settings,
  User,
  Users,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { ZybbleMark } from "../../components/primitives";
import { navigate, useAppRoute } from "../hooks";
import { useAuthUser } from "../services/hooks";
import {
  getSelectedWorkspaceId,
  getUsage,
  listWorkspacesWithRecovery,
  setSelectedWorkspaceId,
  signOut,
} from "../services/api";
import { planFromId } from "../data/plans";
import type { Workspace } from "../data/types";
import { Avatar, Badge, Btn, Kbd, PopItem, PopLabel, PopSep, Popover } from "./ui";

type NavItem = { label: string; href: string; icon: React.ElementType; match: string };
const MAIN_NAV: NavItem[] = [
  { label: "Overview", href: "/overview", icon: Home, match: "/overview" },
  { label: "Find Leads", href: "/find", icon: Search, match: "/find" },
  { label: "Search History", href: "/search-history", icon: History, match: "/search-history" },
  { label: "Leads", href: "/leads", icon: FileSearch, match: "/leads" },
  { label: "Lists", href: "/lists", icon: ListChecks, match: "/lists" },
  { label: "Exports", href: "/exports", icon: Download, match: "/exports" },
];
const WORKSPACE_NAV: NavItem[] = [
  { label: "Team", href: "/team", icon: Users, match: "/team" },
  { label: "Workspaces", href: "/workspaces", icon: Building2, match: "/workspaces" },
];
const BOTTOM_NAV: NavItem[] = [
  { label: "Billing", href: "/billing", icon: CreditCard, match: "/billing" },
  { label: "Usage", href: "/usage", icon: Gauge, match: "/usage" },
  { label: "Settings", href: "/settings", icon: Settings, match: "/settings" },
];

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void }) {
  const { path } = useAppRoute();
  const active = path === item.match || path.startsWith(item.match + "/");
  const Icon = item.icon;
  return (
    <li>
      <a
        href={`#${item.href}`}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-2.5 rounded px-2 py-[7px] text-[13px] transition-colors",
          collapsed && "justify-center px-0",
          active
            ? "bg-black/[0.05] font-medium text-ink"
            : "text-ink-soft hover:bg-black/[0.035] hover:text-ink"
        )}
      >
        <Icon className={cn("size-4 shrink-0", active ? "text-brand-700" : "text-neutral-400 group-hover:text-ink-soft")} aria-hidden="true" />
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
      </a>
    </li>
  );
}

function SidebarBody({
  collapsed,
  onNavigate,
  planName,
  leadsUsed = 0,
  leadsLimit = 0,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  planName?: string;
  leadsUsed?: number;
  leadsLimit?: number;
}) {
  const usagePct = leadsLimit > 0 ? Math.min(100, Math.round((leadsUsed / leadsLimit) * 100)) : 0;
  /* Meter thresholds match /find: brand-green normally, amber at 80%,
     orange at 90%, red + "limit reached" copy at 100%. */
  const usageTone =
    usagePct >= 100
      ? { bar: "bg-red-500", text: "text-red-700" }
      : usagePct >= 90
        ? { bar: "bg-orange-500", text: "text-orange-700" }
        : usagePct >= 80
          ? { bar: "bg-amber-500", text: "text-amber-700" }
          : { bar: "bg-brand-600", text: "text-brand-700/80" };
  return (
    <div className="flex h-full flex-col">
      {/* logo */}
      <div className={cn("flex h-14 shrink-0 items-center border-b border-black/[0.05]", collapsed ? "justify-center" : "px-4")}>
        <a href="/overview" aria-label="Zybble home" className="flex items-center gap-2">
          <ZybbleMark className="size-5.5" />
          {!collapsed ? <span className="font-display text-sm font-semibold tracking-[-0.02em] text-ink">Zybble</span> : null}
        </a>
      </div>

      {/* search trigger */}
      <div className={cn("pt-3", collapsed ? "flex justify-center px-2" : "px-3")}>
        {collapsed ? (
          <button
            type="button"
            aria-label="Search — Ctrl K"
            onClick={() => window.dispatchEvent(new CustomEvent("zybble:command"))}
            className="grid size-8 place-items-center rounded border border-black/[0.08] bg-white text-neutral-400 transition-colors hover:border-black/[0.16] hover:text-ink"
          >
            <Search className="size-3.5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("zybble:command"))}
            aria-label="Search — Ctrl K"
            className="flex h-8 w-full items-center gap-2 rounded border border-black/[0.07] bg-white px-2.5 text-xs text-ink-mute transition-colors hover:border-black/[0.14] hover:text-ink"
          >
            <Search className="size-3.5 shrink-0 text-neutral-400" aria-hidden="true" />
            <span className="flex-1 text-left">Search</span>
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </button>
        )}
      </div>

      {/* nav */}
      <nav aria-label="Primary navigation" className={cn("mt-4 flex-1 overflow-y-auto thin-scroll", collapsed ? "px-2" : "px-3")}>
        {!collapsed ? (
          <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Main</p>
        ) : null}
        <ul className="space-y-0.5">
          {MAIN_NAV.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </ul>
        {!collapsed ? (
          <p className="mb-1.5 mt-5 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">Workspace</p>
        ) : (
          <div className="my-4 h-px bg-black/[0.06]" aria-hidden="true" />
        )}
        <ul className="space-y-0.5 pb-4">
          {WORKSPACE_NAV.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </ul>
      </nav>

      {/* bottom */}
      <div className={cn("shrink-0 border-t border-black/[0.05] pb-3 pt-2", collapsed ? "px-2" : "px-3")}>
        <ul className="space-y-0.5">
          {BOTTOM_NAV.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </ul>
        {!collapsed && planName ? (
          <div className="mx-2 mt-3 rounded-md border border-brand-600/15 bg-brand-50/70 px-2.5 py-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-brand-700">{planName} plan</p>
              {planName !== "Free" ? (
                <Badge tone="green" className="h-4 px-1 text-[9.5px]">
                  Pro
                </Badge>
              ) : null}
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/[0.07]">
              <div
                className={cn("h-full rounded-full transition-[width] duration-500", usageTone.bar)}
                style={{ width: `${usagePct}%` }}
              />
            </div>
            <p className={cn("mt-1 text-[10px]", usageTone.text)}>
              {usagePct >= 100
                ? `Monthly lead limit reached — ${leadsUsed.toLocaleString()} of ${leadsLimit.toLocaleString()} leads`
                : `${leadsUsed.toLocaleString()} of ${leadsLimit.toLocaleString()} leads`}
            </p>
            {usagePct >= 100 ? (
              <a
                href="/billing"
                className="mt-1.5 inline-flex h-6 w-full items-center justify-center rounded bg-brand-600 text-[10px] font-medium text-white transition-colors hover:bg-brand-700"
              >
                Upgrade for more leads
              </a>
            ) : usagePct >= 80 ? (
              <a
                href="/billing"
                className="mt-1 block text-center text-[10px] font-medium text-brand-700 underline decoration-brand-600/30 underline-offset-2 hover:text-brand-800"
              >
                See upgrade options
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function pageTitle(path: string) {
  if (path.startsWith("/leads/")) return "Lead detail";
  if (path.startsWith("/lists/")) return "List detail";
  if (path.startsWith("/workspaces/")) return "Workspace";
  const map: Record<string, string> = {
    "/overview": "Overview",
    "/find": "Find Leads",
    "/search-history": "Search History",
    "/leads": "Leads",
    "/lists": "Lists",
    "/exports": "Exports",
    "/team": "Team",
    "/workspaces": "Workspaces",
    "/billing": "Billing",
    "/usage": "Usage",
    "/settings": "Settings",
  };
  return map[path] ?? "Overview";
}

export function AppLayout({
  children,
  title,
  description,
  aside,
  wide,
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  aside?: ReactNode;
  wide?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const authUser = useAuthUser();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(getSelectedWorkspaceId());
  const { path } = useAppRoute();
  /*
   * Explicitly nullable: the list is empty on first render (and stays empty
   * for an account with no workspace yet), so `workspaces[0]` is undefined.
   * Every read below must go through the null check.
   */
  const workspace: Workspace | null =
    workspaces.find((w) => w.id === workspaceId) ?? workspaces[0] ?? null;
  const workspaceLabel = workspace?.name ?? (workspacesLoading ? "Loading…" : "No workspace");
  const heading = title ?? pageTitle(path);
  const plan = planFromId(authUser === "loading" || !authUser ? "free" : authUser.planId);
  const [leadsUsed, setLeadsUsed] = useState(0);

  useEffect(() => {
    if (!workspace) return;
    let mounted = true;
    getUsage(workspace.id, plan.id)
      .then((u) => mounted && setLeadsUsed(u.used))
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [workspace, plan.id]);

  useEffect(() => {
    let mounted = true;

    const load = () => {
      /* Self-healing: if the user has no workspace (failed signup trigger,
         removed workspace), the recovery RPC provisions one server-side
         before we re-list. Never fabricates data. */
      listWorkspacesWithRecovery()
        .then((ws) => {
          if (!mounted) return;
          /* Store the result even when empty — the UI needs the empty state. */
          setWorkspaces(ws);
          setWorkspaceId((current: string | null) =>
            current && ws.some((w) => w.id === current) ? current : (ws[0]?.id ?? null)
          );
        })
        .catch(() => undefined)
        .finally(() => {
          if (mounted) setWorkspacesLoading(false);
        });
    };

    load();
    /* Keep the switcher in sync when a workspace is created or picked elsewhere. */
    window.addEventListener("zybble:workspace", load);
    return () => {
      mounted = false;
      window.removeEventListener("zybble:workspace", load);
    };
  }, []);

  const user = authUser === "loading" || !authUser
    ? { name: "…", email: "", avatarUrl: null, initials: "" }
    : authUser;

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {/* desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-black/[0.06] bg-paper transition-[width] duration-200 lg:block",
          collapsed ? "w-16" : "w-[264px]"
        )}
      >
        <SidebarBody
          collapsed={collapsed}
          planName={plan.label}
          leadsUsed={leadsUsed}
          leadsLimit={plan.leadAllowance}
        />
      </aside>

      {/* mobile drawer */}
      {mobileOpen ? (
        <>
          <div
            className="fade-in fixed inset-0 z-[75] bg-ink/30 backdrop-blur-[1.5px]"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
          <div className="drawer-in-left fixed inset-y-0 left-0 z-[76] w-[264px] border-r border-black/[0.08] bg-paper shadow-2xl">
            <SidebarBody
              onNavigate={() => setMobileOpen(false)}
              planName={plan.label}
              leadsUsed={leadsUsed}
              leadsLimit={plan.leadAllowance}
            />
          </div>
        </>
      ) : null}

      {/* content column */}
      <div className={cn("flex min-h-dvh min-w-0 flex-col transition-[padding] duration-200", collapsed ? "lg:pl-16" : "lg:pl-[264px]")}>
        {/* topbar */}
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
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
            className="grid size-7 place-items-center rounded text-ink-mute transition-colors hover:bg-black/[0.045] hover:text-ink lg:hidden"
          >
            <PanelLeft className="size-4" aria-hidden="true" />
          </button>

          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            {workspace ? (
              <>
                <span className="hidden truncate text-ink-mute min-[420px]:inline">{workspace.name}</span>
                <span className="hidden text-neutral-300 min-[420px]:inline" aria-hidden="true">/</span>
              </>
            ) : null}
            <span className="truncate font-medium text-ink">{heading}</span>
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <Popover
              align="end"
              width="w-64"
              trigger={(_, toggle) => (
                <Btn
                  variant="outline"
                  size="sm"
                  onClick={toggle}
                  className="max-w-[120px] min-[420px]:max-w-[190px]"
                  label={`Workspace: ${workspaceLabel}`}
                >
                  <Building2 className="size-3.5 shrink-0 text-neutral-400" aria-hidden="true" />
                  <span className={cn("truncate", !workspace && "text-ink-mute")}>{workspaceLabel}</span>
                  <ChevronDown className="size-3 shrink-0 text-neutral-400" aria-hidden="true" />
                </Btn>
              )}
            >
              <PopLabel>Workspaces</PopLabel>
              {workspaces.map((w) => (
                <PopItem
                  key={w.id}
                  active={w.id === workspaceId}
                  icon={<Building2 className="size-3.5" aria-hidden="true" />}
                  onClick={() => {
                    setWorkspaceId(w.id);
                    setSelectedWorkspaceId(w.id);
                    window.dispatchEvent(new CustomEvent("zybble:workspace"));
                  }}
                >
                  {w.name}
                </PopItem>
              ))}
              {!workspaces.length ? (
                <p className="px-2 py-1.5 text-xs text-ink-mute">
                  {workspacesLoading ? "Loading workspaces…" : "No workspaces yet."}
                </p>
              ) : null}
              <PopSep />
              <PopItem icon={<Check className="size-3.5 opacity-0" aria-hidden="true" />} onClick={() => navigate("/workspaces")}>
                {workspaces.length ? "Manage workspaces" : "Create a workspace"}
              </PopItem>
            </Popover>

            <button
              type="button"
              aria-label="Search — Ctrl K"
              onClick={() => window.dispatchEvent(new CustomEvent("zybble:command"))}
              className="hidden size-7 place-items-center rounded text-neutral-400 transition-colors hover:bg-black/[0.045] hover:text-ink sm:grid"
            >
              <Search className="size-3.5" aria-hidden="true" />
            </button>

            <Popover
              align="end"
              width="w-56"
              trigger={(_, toggle) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Account menu"
                  className="rounded-full ring-brand-600/25 transition-shadow hover:ring-2 focus-visible:ring-2"
                >
                  <Avatar name={user.name} tint="bg-brand-50 text-brand-700" src={user.avatarUrl} />
                </button>
              )}
            >
              <div className="flex items-center gap-2.5 px-2 py-2">
                <Avatar name={user.name} tint="bg-brand-50 text-brand-700" src={user.avatarUrl} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink">{user.name}</p>
                  <p className="truncate text-[11px] text-ink-mute">{user.email}</p>
                </div>
              </div>
              <PopSep />
              <PopItem icon={<User className="size-3.5" aria-hidden="true" />} onClick={() => navigate("/settings")}>Profile</PopItem>
              <PopItem icon={<Settings className="size-3.5" aria-hidden="true" />} onClick={() => navigate("/settings")}>Settings</PopItem>
              <PopItem icon={<Building2 className="size-3.5" aria-hidden="true" />} onClick={() => navigate("/workspaces")}>Workspace</PopItem>
              <PopItem icon={<CreditCard className="size-3.5" aria-hidden="true" />} onClick={() => navigate("/billing")}>Billing</PopItem>
              <PopItem icon={<Gauge className="size-3.5" aria-hidden="true" />} onClick={() => navigate("/usage")}>Usage</PopItem>
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

        {/* page header */}
        <div className={cn("mx-auto w-full min-w-0 px-3 sm:px-5 lg:px-7", wide ? "max-w-[1380px]" : "max-w-[1120px]")}>
          <div className="flex flex-wrap items-end justify-between gap-3 pt-5 sm:pt-6">
            <div className="min-w-0">
              <h1 className="font-display text-lg font-semibold tracking-[-0.02em] text-ink sm:text-xl">{heading}</h1>
              {description ? <p className="mt-0.5 max-w-xl text-xs leading-5 text-ink-mute sm:text-[13px]">{description}</p> : null}
            </div>
            {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
          </div>
          <main className="min-w-0 pb-16 pt-5 sm:pt-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

/* helper the pages use for the date control */
export function PeriodButton({ label = "Last 30 days" }: { label?: string }) {
  return (
    <Popover
      align="end"
      width="w-44"
      trigger={(_, toggle) => (
        <Btn variant="outline" size="sm" onClick={toggle}>
          <CalendarDays className="size-3.5 text-neutral-400" aria-hidden="true" />
          {label}
          <ChevronDown className="size-3 text-neutral-400" aria-hidden="true" />
        </Btn>
      )}
    >
      {["Last 7 days", "Last 30 days", "This quarter", "All time"].map((opt) => (
        <PopItem key={opt} active={opt === label}>
          {opt}
        </PopItem>
      ))}
    </Popover>
  );
}
