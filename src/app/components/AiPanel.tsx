/* ------------------------------------------------------------------ */
/* Zybble app — Zybble AI side panel (search context assistant)        */
/* ------------------------------------------------------------------ */
import type { ReactNode } from "react";
import { ArrowRight, Lightbulb, Loader2, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { Card } from "./ui";

export type AiSuggestion = {
  id: string;
  icon: ReactNode;
  label: string;
  action: () => void;
};

export function AiPanel({
  title = "Zybble AI",
  facts,
  suggestions,
  insights,
  actions,
  busy,
  children,
  onClearContext,
}: {
  title?: string;
  facts?: { label: string; value: string; icon: ReactNode }[];
  suggestions?: AiSuggestion[];
  insights?: string[];
  actions?: { id: string; label: string; hint?: string; icon: ReactNode; onClick: () => void; busy?: boolean }[];
  busy?: boolean;
  children?: ReactNode;
  onClearContext?: () => void;
}) {
  const hasContext = Boolean(facts && facts.length);

  return (
    <Card className="overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-black/[0.05] px-3.5 py-2.5">
        <span className="grid size-6 place-items-center rounded-md bg-brand-600 text-white">
          <Sparkles className="size-3" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink">{title}</p>
          <p className="text-[10px] leading-3.5 text-ink-mute">{busy ? "Working on your search…" : "Your lead-generation assistant"}</p>
        </div>
        {hasContext && onClearContext ? (
          <button
            type="button"
            onClick={onClearContext}
            aria-label="Clear current search context"
            className="grid size-6 place-items-center rounded text-neutral-400 transition-colors hover:bg-black/[0.05] hover:text-ink"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="space-y-4 p-3.5">
        {/* interpretation */}
        {hasContext ? (
          <div>
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
              Your search, interpreted
            </p>
            <ul className="mt-2 space-y-1">
              {facts!.map((fact) => (
                <li key={fact.label} className="flex items-center gap-2 rounded-md border border-black/[0.05] bg-neutral-50/70 px-2 py-1.5">
                  <span className="grid size-4 place-items-center rounded bg-white text-neutral-400 ring-1 ring-black/[0.04]">
                    {fact.icon}
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">{fact.label}</span>
                  <span className="ml-auto max-w-[60%] truncate text-[11.5px] font-medium text-ink">{fact.value}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {children}

        {/* busy indicator */}
        {busy ? (
          <div className="flex items-center gap-2 rounded-md border border-brand-600/15 bg-brand-50/60 px-2.5 py-2">
            <Loader2 className="size-3.5 animate-spin text-brand-600" aria-hidden="true" />
            <p className="text-[11.5px] font-medium text-brand-700">Interpreting and structuring…</p>
          </div>
        ) : null}

        {/* insights */}
        {insights && insights.length > 0 ? (
          <div>
            <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
              <Lightbulb className="size-3" aria-hidden="true" />
              Insights
            </p>
            <ul className="mt-2 space-y-1.5">
              {insights.map((line) => (
                <li key={line} className="flex gap-2 text-[11.5px] leading-4.5 text-ink-soft">
                  <span className="mt-[6px] size-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* suggestions */}
        {suggestions && suggestions.length > 0 ? (
          <div>
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
              Suggested refinements
            </p>
            <div className="mt-2 space-y-1">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={s.action}
                  className="group flex w-full items-center gap-2 rounded-md border border-black/[0.06] bg-white px-2.5 py-2 text-left text-[11.5px] font-medium text-ink-soft transition-all hover:border-brand-600/25 hover:text-ink"
                >
                  <span className="grid size-4.5 shrink-0 place-items-center rounded bg-neutral-50 text-neutral-400 ring-1 ring-black/[0.04] transition-colors group-hover:bg-brand-50 group-hover:text-brand-700">
                    {s.icon}
                  </span>
                  <span className="flex-1">{s.label}</span>
                  <ArrowRight className="size-3 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* actions */}
        {actions && actions.length > 0 ? (
          <div>
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
              Actions
            </p>
            <div className="mt-2 space-y-1">
              {actions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={a.onClick}
                  disabled={a.busy}
                  className="flex w-full items-center gap-2 rounded-md border border-black/[0.06] bg-white px-2.5 py-2 text-left transition-all hover:border-brand-600/25 disabled:opacity-60"
                >
                  <span className="grid size-4.5 shrink-0 place-items-center rounded bg-neutral-50 text-neutral-400 ring-1 ring-black/[0.04]">
                    {a.busy ? <Loader2 className="size-3 animate-spin text-brand-600" aria-hidden="true" /> : a.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-ink">{a.busy ? "Analyzing…" : a.label}</span>
                    {a.hint ? <span className="block truncate text-[10px] text-neutral-400">{a.hint}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* actions with extra icons used elsewhere */}
        {!hasContext && !children && !busy ? (
          <div className="text-center">
            <div className="mx-auto grid size-9 place-items-center rounded-full bg-neutral-50">
              <RotateCcw className="size-4 text-neutral-300" aria-hidden="true" />
            </div>
            <p className="mt-2 text-[11.5px] leading-4.5 text-ink-mute">Run a search and I'll track the context here.</p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-black/[0.05] px-3.5 py-2">
        <p className="text-[9.5px] leading-3.5 text-neutral-400">
          AI output reflects available business data — <span className="font-medium">verify before outreach</span>.
        </p>
      </div>
    </Card>
  );
}

/* Small summary card used on lead detail */
export function AiSummaryCard({ busy, lines }: { busy?: boolean; lines?: string[] }) {
  return (
    <div className="rounded-md border border-brand-600/15 bg-brand-50/50 p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-700">
        <Sparkles className="size-3" aria-hidden="true" />
        AI summary
      </p>
      {busy ? (
        <div className="mt-2.5 space-y-1.5" aria-hidden="true">
          <p className="skel h-2.5 w-full rounded" />
          <p className="skel h-2.5 w-11/12 rounded" />
          <p className="skel h-2.5 w-4/6 rounded" />
        </div>
      ) : lines && lines.length ? (
        <>
          <ul className="mt-2 space-y-1.5">
            {lines.map((line) => (
              <li key={line} className="flex gap-1.5 text-[11.5px] leading-4.5 text-ink-soft">
                <span className="mt-[6px] size-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[9.5px] text-neutral-400">
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="size-2.5" aria-hidden="true" />
              Generated from available business data · AI generated
            </span>
          </p>
        </>
      ) : null}
    </div>
  );
}
