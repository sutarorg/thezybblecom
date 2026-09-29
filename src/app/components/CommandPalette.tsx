/* ------------------------------------------------------------------ */
/* Zybble app — command palette (Ctrl/Cmd + K)                         */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  CreditCard,
  Download,
  FileSearch,
  Gauge,
  History,
  Home,
  ListChecks,
  ListPlus,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { navigate } from "../hooks";
import { Kbd, useToast } from "./ui";

type Cmd = {
  id: string;
  title: string;
  hint?: string;
  group: "Go to" | "Actions";
  icon: React.ElementType;
  href?: string;
  action?: () => void;
  keywords: string;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const commands = useMemo<Cmd[]>(
    () => [
      { id: "go-overview", title: "Overview", group: "Go to", icon: Home, href: "/overview", keywords: "dashboard home" },
      { id: "go-find", title: "Find Leads", group: "Go to", icon: Search, href: "/find", keywords: "discover search businesses" },
      { id: "go-history", title: "Search History", group: "Go to", icon: History, href: "/search-history", keywords: "past queries" },
      { id: "go-leads", title: "Leads", group: "Go to", icon: FileSearch, href: "/leads", keywords: "database businesses contacts" },
      { id: "go-lists", title: "Lists", group: "Go to", icon: ListChecks, href: "/lists", keywords: "saved groups" },
      { id: "go-exports", title: "Exports", group: "Go to", icon: Download, href: "/exports", keywords: "csv files download" },
      { id: "go-team", title: "Team", group: "Go to", icon: Users, href: "/team", keywords: "members invite" },
      { id: "go-workspaces", title: "Workspaces", group: "Go to", icon: Building2, href: "/workspaces", keywords: "clients organizations" },
      { id: "go-billing", title: "Billing", group: "Go to", icon: CreditCard, href: "/billing", keywords: "plan invoices payment" },
      { id: "go-usage", title: "Usage", group: "Go to", icon: Gauge, href: "/usage", keywords: "limits allowance" },
      { id: "go-settings", title: "Settings", group: "Go to", icon: Settings, href: "/settings", keywords: "preferences account" },
      {
        id: "act-find",
        title: "Find leads",
        group: "Actions",
        icon: Search,
        action: () => navigate("/find"),
        keywords: "new search discover",
      },
      {
        id: "act-list",
        title: "Create list",
        group: "Actions",
        icon: ListPlus,
        action: () => {
          navigate("/lists");
          toast("Use “New list” to create a list", "info");
        },
        keywords: "new list create",
      },
      {
        id: "act-export",
        title: "Export leads",
        group: "Actions",
        icon: Download,
        action: () => {
          navigate("/leads");
          toast("Select leads, then choose Export", "info");
        },
        keywords: "csv download export",
      },
    ],
    [toast]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.title.toLowerCase().includes(q) || c.keywords.includes(q) || c.group.toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useEffect(() => {
    const toggle = () => setOpen((v) => {
      if (v) return v;
      return true;
    });
    window.addEventListener("zybble:command", toggle);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("zybble:command", toggle);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const run = (cmd: Cmd) => {
    setOpen(false);
    if (cmd.href) navigate(cmd.href);
    cmd.action?.();
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[index];
      if (cmd) run(cmd);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  if (!open) return null;

  let runningIndex = -1;
  return (
    <>
      <div
        className="fade-in fixed inset-0 z-[74] bg-ink/30 backdrop-blur-[1.5px]"
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="pop-in fixed left-1/2 top-[16vh] z-[75] w-full max-w-[560px] -translate-x-1/2 px-3"
      >
        <div className="overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-pop">
          <div className="flex items-center gap-2 border-b border-black/[0.06] px-3.5">
            <Search className="size-4 shrink-0 text-neutral-400" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search pages and actions…"
              aria-label="Search pages and actions"
              aria-activedescendant={filtered[index] ? `cmd-${filtered[index].id}` : undefined}
              aria-expanded="true"
              role="combobox"
              aria-controls="cmd-list"
              className="h-11 w-full bg-transparent text-sm text-ink placeholder:text-neutral-400 outline-none"
            />
            <Kbd>Esc</Kbd>
          </div>

          <div ref={listRef} id="cmd-list" role="listbox" className="thin-scroll max-h-[320px] overflow-y-auto p-2" aria-label="Commands">
            {["Go to", "Actions"].map((group) => {
              const items = filtered.filter((c) => c.group === group);
              if (!items.length) return null;
              return (
                <div key={group}>
                  <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                    {group}
                  </p>
                  {items.map((cmd) => {
                    runningIndex++;
                    const idx = runningIndex;
                    const Icon = cmd.icon;
                    const active = idx === index;
                    return (
                      <button
                        key={cmd.id}
                        id={`cmd-${cmd.id}`}
                        role="option"
                        aria-selected={active}
                        data-index={idx}
                        type="button"
                        onClick={() => run(cmd)}
                        onMouseEnter={() => setIndex(idx)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
                          active ? "bg-neutral-100" : "hover:bg-neutral-50"
                        )}
                      >
                        <span className={cn("grid size-6 shrink-0 place-items-center rounded-md border", active ? "border-black/[0.08] bg-white text-brand-700" : "border-black/[0.06] bg-neutral-50 text-neutral-400")}>
                          <Icon className="size-3" aria-hidden="true" />
                        </span>
                        <span className="flex-1 text-xs font-medium text-ink">{cmd.title}</span>
                        <span className="text-[10px] text-neutral-400">{group === "Go to" ? "Page" : "Action"}</span>
                        {active ? <ArrowRight className="size-3 text-neutral-300" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-ink-mute">No matches for “{query}”</p>
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-t border-black/[0.06] px-3.5 py-2 text-[10px] text-neutral-400">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd>
              close
            </span>
            <span className="ml-auto hidden min-[420px]:block">Zybble Command</span>
          </div>
        </div>
      </div>
    </>
  );
}
