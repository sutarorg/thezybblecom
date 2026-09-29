import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ArrowRight, ArrowUpRight, Minus, Sparkles, X } from "lucide-react";
import { cn } from "../utils/cn";
import { SmartLink, ZybbleMark } from "../components/primitives";
import {
  FALLBACK_TEXT,
  INITIAL_SUGGESTIONS,
  INTENTS,
  TOPIC_ORDER,
  getByCategory,
  getSuggestions,
  type AnswerBlock,
  type Intent,
} from "./knowledge";

const DESKTOP_QUERY = "(min-width: 1024px)";
const GREET_KEY = "zybble.assistant.greeted";

const TOPIC_LABELS: Record<string, string> = {
  product: "Product",
  discovery: "Lead discovery",
  data: "Lead data",
  ai: "Zybble AI",
  lists: "Lead lists",
  export: "Exports",
  pricing: "Pricing",
  usage: "Limits",
  team: "Teams",
  workspaces: "Workspaces",
  billing: "Billing",
  security: "Data handling",
  support: "Support",
};

type Message =
  | { kind: "intro" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; intent: Intent }
  | { kind: "fallback" };

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function isDesktopViewport() {
  return (
    typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches
  );
}

/* Bold-lite renderer: **text** → <strong> */
function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-ink">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function AnswerBlocks({ blocks }: { blocks: AnswerBlock[] }) {
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          return (
            <p
              key={i}
              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400"
            >
              {block.text}
            </p>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={i} className="space-y-1.5">
              {block.items.map((item) => (
                <li key={item} className="flex gap-2 text-[12.5px] leading-5.5">
                  <span
                    className="mt-[8px] size-1 shrink-0 rounded-full bg-brand-500"
                    aria-hidden="true"
                  />
                  <span className="text-ink-soft">
                    <RichText text={item} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-[12.5px] leading-5.5 text-ink-soft">
            <RichText text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

function MessageShell({
  children,
  user,
}: {
  children: ReactNode;
  user?: boolean;
}) {
  return (
    <div
      className={cn(
        "qa-msg flex",
        user ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[86%] rounded-2xl px-3.5 py-2.5",
          user
            ? "rounded-br-md bg-ink text-white"
            : "rounded-bl-md border border-black/[0.05] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
        )}
      >
        {user ? (
          <p className="text-[12.5px] leading-5 font-medium">{children}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function Assistant() {
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const reduced = usePrefersReducedMotion();

  const [messages, setMessages] = useState<Message[]>([{ kind: "intro" }]);
  const [thinking, setThinking] = useState(false);
  const [currentTopic, setCurrentTopic] = useState<string | null>(null);
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  /** null = normal suggestions · "" = topic picker · "id" = category list */
  const [browseCat, setBrowseCat] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  const suggestions = useMemo(() => {
    if (browseCat) return getByCategory(browseCat, asked);
    if (!lastIntent && asked.size === 0) return INITIAL_SUGGESTIONS;
    return getSuggestions(lastIntent, asked);
  }, [lastIntent, asked, browseCat]);

  /* Desktop-only, defensive: JS + CSS both hide on mobile */
  useEffect(() => {
    const update = () => setDesktop(isDesktopViewport());
    update();
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => update();
    mq.addEventListener("change", on);
    window.addEventListener("resize", on);
    return () => {
      mq.removeEventListener("change", on);
      window.removeEventListener("resize", on);
    };
  }, []);

  /* First-visit greeting badge */
  useEffect(() => {
    if (!desktop) return;
    try {
      if (localStorage.getItem(GREET_KEY)) return;
    } catch {
      /* storage unavailable */
    }
    const show = window.setTimeout(() => setShowBadge(true), 1400);
    const hide = window.setTimeout(() => dismissBadge(), 10000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);

  const dismissBadge = () => {
    setShowBadge(false);
    try {
      localStorage.setItem(GREET_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  /* Close on Escape and outside click */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePanel(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(t) &&
        launcherRef.current &&
        !launcherRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Autoscroll conversation */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [messages, thinking, open, reduced]);

  /* Cleanup timer */
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const closePanel = (refocus?: boolean) => {
    setOpen(false);
    if (refocus) launcherRef.current?.focus();
  };

  const toggle = () => {
    if (showBadge) dismissBadge();
    setOpen((v) => !v);
  };

  const ask = (id: string) => {
    const intent = INTENTS[id];
    if (!intent || thinking) return;

    setMessages((m) => [...m, { kind: "user", text: intent.question }]);
    setAsked((s) => new Set(s).add(id));
    setCurrentTopic(intent.category);
    setBrowseCat(null);
    setPicking(false);

    setThinking(true);
    timerRef.current = window.setTimeout(
      () => {
        setThinking(false);
        setMessages((m) => [...m, { kind: "assistant", intent }]);
        setLastIntent(id);
      },
      reduced ? 0 : 420 + Math.random() * 180
    );
  };

  const openTopics = () => {
    if (thinking) return;
    if (picking) {
      setPicking(false);
      setBrowseCat(null);
      return;
    }
    setPicking(true);
    setBrowseCat(null);
  };

  const chooseTopic = (cat: string) => {
    setBrowseCat(cat);
    setPicking(false);
  };

  if (!desktop) return null;

  return (
    <>
      {/* Greeting badge — first desktop visit only */}
      {showBadge && !open ? (
        <div
          className={cn(
            "qa-msg fixed z-[68] hidden lg:flex items-center gap-2 rounded-2xl border border-black/[0.06] bg-white py-2 pl-3.5 pr-2 shadow-ui-sm",
            "right-24 bottom-8"
          )}
          role="status"
        >
          <Sparkles className="size-3.5 text-brand-600" aria-hidden="true" />
          <p className="text-[12.5px] font-medium text-ink">
            Questions about Zybble?
          </p>
          <button
            type="button"
            onClick={dismissBadge}
            aria-label="Dismiss assistant hint"
            className="grid size-5 place-items-center rounded-full text-neutral-400 transition-colors hover:bg-black/[0.04] hover:text-ink"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* Panel */}
      <div
        ref={panelRef}
        id="zybble-assistant-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="zybble-assistant-title"
        aria-hidden={!open}
        className={cn(
          "fixed z-[69] hidden origin-bottom-right flex-col overflow-hidden rounded-[22px] border border-black/[0.07] bg-white shadow-panel",
          "right-6 bottom-[92px] w-[380px] max-w-[calc(100vw-48px)]",
          "h-[min(560px,calc(100vh-148px))]",
          "lg:flex",
          "transition-[opacity,transform] duration-300 ease-out",
          open
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none invisible translate-y-2 scale-[0.97] opacity-0"
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-black/[0.05] px-4 py-3">
          <ZybbleMark className="size-6" />
          <div className="min-w-0 flex-1">
            <p
              id="zybble-assistant-title"
              className="text-[13px] font-semibold tracking-[-0.01em] text-ink"
            >
              Ask Zybble
            </p>
            <p className="text-[10.5px] leading-3.5 text-ink-mute">
              Quick answers about Zybble
            </p>
          </div>
          <button
            type="button"
            onClick={() => closePanel(true)}
            aria-label="Close assistant"
            className="grid size-7 place-items-center rounded-full text-ink-mute transition-colors hover:bg-black/[0.05] hover:text-ink"
          >
            <Minus className="size-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-2.5 overflow-y-auto bg-paper px-4 py-4"
          role="log"
          aria-label="Conversation"
          aria-live="polite"
          aria-atomic={false}
        >
          {messages.map((msg, i) => {
            if (msg.kind === "intro") {
              return (
                <MessageShell key={i}>
                  <p className="text-[12.5px] leading-5.5 text-ink-soft">
                    Hey — what would you like to know about Zybble? Pick a
                    topic below.
                  </p>
                </MessageShell>
              );
            }
            if (msg.kind === "user") {
              return (
                <MessageShell key={i} user>
                  {msg.text}
                </MessageShell>
              );
            }
            if (msg.kind === "fallback") {
              return (
                <MessageShell key={i}>
                  <p className="text-[12.5px] leading-5.5 text-ink-soft">
                    {FALLBACK_TEXT}
                  </p>
                </MessageShell>
              );
            }
            return (
              <MessageShell key={i}>
                <AnswerBlocks blocks={msg.intent.answer} />
                {msg.intent.cta ? (
                  <SmartLink
                    href={msg.intent.cta.href}
                    onClick={() => setOpen(false)}
                    className="group mt-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600"
                  >
                    {msg.intent.cta.label}
                    <ArrowUpRight
                      className="size-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      aria-hidden="true"
                    />
                  </SmartLink>
                ) : null}
              </MessageShell>
            );
          })}

          {thinking ? (
            <div className="qa-msg flex justify-start" aria-label="Zybble is thinking">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-black/[0.05] bg-white px-3.5 py-3">
                {[0, 1, 2].map((n) => (
                  <span
                    key={n}
                    className="qa-dot size-1.5 rounded-full bg-neutral-300"
                    style={{ "--qa-delay": `${n * 150}ms` } as CSSProperties}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Suggestions tray */}
        <div className="border-t border-black/[0.05] bg-white px-3.5 py-3">
          <p className="px-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
            {picking
              ? "Browse topics"
              : browseCat
                ? TOPIC_LABELS[browseCat] ?? "Topic"
                : lastIntent
                  ? `Next${currentTopic ? ` · ${TOPIC_LABELS[currentTopic] ?? currentTopic}` : ""}`
                  : "Suggested"}
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {picking
              ? TOPIC_ORDER.map((topic) => (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() => chooseTopic(topic.id)}
                    className="inline-flex items-center rounded-full border border-black/[0.07] bg-neutral-50 px-3 py-1.5 text-[12px] font-medium text-ink-soft transition-all duration-200 hover:border-brand-600/30 hover:bg-white hover:text-ink"
                  >
                    {topic.label}
                  </button>
                ))
              : suggestions.map((id) => {
                  const intent = INTENTS[id];
                  if (!intent) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => ask(id)}
                      disabled={thinking}
                      className="group inline-flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-white px-3 py-1.5 text-[12px] font-medium text-ink-soft transition-all duration-200 hover:border-brand-600/30 hover:text-ink focus-visible:border-brand-600/40 disabled:opacity-60"
                    >
                      <span
                        className="size-1 rounded-full bg-brand-500/60 transition-colors group-hover:bg-brand-600"
                        aria-hidden="true"
                      />
                      {intent.question}
                    </button>
                  );
                })}
          </div>

          <div className="mt-2 flex items-center justify-between px-1">
            <p className="text-[9.5px] text-neutral-400">
              Answers come from Zybble's product guide
            </p>
            <button
              type="button"
              onClick={openTopics}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-ink-mute transition-colors hover:text-brand-700"
            >
              {picking || browseCat ? "Back to suggestions" : "Browse all topics"}
              <ArrowRight className="size-2.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Floating launcher */}
      <button
        ref={launcherRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="zybble-assistant-panel"
        aria-label={open ? "Close Zybble assistant" : "Ask Zybble — open assistant"}
        className={cn(
          "fixed z-[70] hidden grid place-items-center rounded-full border transition-all duration-200",
          "right-6 bottom-6 size-12",
          "bg-white hover:bg-neutral-50 active:scale-[0.96]",
          open
            ? "border-brand-600/30 shadow-[0_0_0_4px_rgba(14,122,82,0.08),0_8px_20px_-10px_rgba(23,43,33,0.18)]"
            : "border-black/[0.08] shadow-ui-sm hover:border-black/[0.14]"
        )}
      >
        <span className="relative">
          {open ? (
            <X className="size-4.5 text-ink" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4.5 text-ink" aria-hidden="true" />
          )}
          {!open ? (
            <span
              className="absolute -right-1 -top-1 size-2 rounded-full bg-brand-500 ring-2 ring-white"
              aria-hidden="true"
            />
          ) : null}
        </span>
      </button>
    </>
  );
}
