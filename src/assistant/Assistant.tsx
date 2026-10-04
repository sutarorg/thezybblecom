import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  CheckCircle2,
  Loader2,
  Mail,
  Minus,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "../utils/cn";
import { ZybbleMark } from "../components/primitives";
import { isValidEmail } from "../lib/web3forms";
import {
  ZybbleAIError,
  streamAIChat,
  type AIChatMessage,
} from "../lib/openrouter-ai";
import {
  SUGGESTED_PROMPTS,
  SUGGESTION_POOL,
  assistantSystemPrompt,
} from "./prompt";
import {
  collectAttribution,
  detectLeadIntent,
  setLeadState,
  shouldOfferLead,
  submitAiLead,
} from "./lead";

const DESKTOP_QUERY = "(min-width: 1024px)";
const GREET_KEY = "zybble.assistant.greeted";
/** Conversation turns sent to the model (system prompt excluded). */
const MAX_HISTORY_TURNS = 10;

/** Fisher–Yates shuffle so every visit rotates suggestions in a fresh order. */
function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

type Message =
  | { kind: "intro" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "error"; text: string }
  /** One-per-session, consent-first email offer. Never sent to the model
      (toChatMessages only forwards user/assistant turns). */
  | { kind: "lead-offer"; intent: string | null; firstQuestion: string };

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

/* Bold-lite renderer: **text** → <strong>. Model output is only ever
   rendered as text nodes — no HTML from the stream is interpreted. */
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
        ),
      )}
    </>
  );
}

/**
 * Safe plain-text renderer: paragraphs, "- " bullet lists, and **bold**.
 *
 * `caret`, when provided, is rendered INLINE at the end of the last block —
 * inside the final paragraph or list item — so the streaming caret sits on
 * the text's baseline (aligned with the words) instead of dropping onto its
 * own line below the block content.
 */
function RichContent({ text, caret }: { text: string; caret?: ReactNode }) {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const blocks: { type: "p" | "list"; lines: string[] }[] = [];
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.type === "list") last.lines.push(bullet[1]!);
      else blocks.push({ type: "list", lines: [bullet[1]!] });
      continue;
    }
    blocks.push({ type: "p", lines: [line] });
  }
  if (blocks.length === 0) {
    return caret ? (
      <p className="text-[12.5px] leading-5.5 text-ink-soft">{caret}</p>
    ) : null;
  }
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const isLastBlock = i === blocks.length - 1;
        return block.type === "list" ? (
          <ul key={i} className="space-y-1">
            {block.lines.map((item, j) => (
              <li key={j} className="flex gap-2 text-[12.5px] leading-5.5">
                <span
                  className="mt-[8px] size-1 shrink-0 rounded-full bg-brand-500"
                  aria-hidden="true"
                />
                <span className="text-ink-soft">
                  <RichText text={item} />
                  {isLastBlock && j === block.lines.length - 1 ? caret : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="text-[12.5px] leading-5.5 text-ink-soft">
            <RichText text={block.lines[0]!} />
            {isLastBlock ? caret : null}
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

/* ------------------------------------------------------------------ */
/* Lead capture card — rendered as an assistant-side bubble.           */
/* Consent-first: the email input only exists after "Yes". Declining   */
/* is remembered for the session and the assistant never asks again.   */
/* ------------------------------------------------------------------ */
function LeadCaptureCard({
  intent,
  firstQuestion,
}: {
  intent: string | null;
  firstQuestion: string;
}) {
  const [stage, setStage] = useState<
    "offer" | "form" | "sending" | "sent" | "declined" | "error"
  >("offer");
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (stage === "form") emailRef.current?.focus();
  }, [stage]);

  const decline = () => {
    setLeadState("declined");
    setStage("declined");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stage === "sending") return;
    if (!isValidEmail(email)) {
      setFieldError("That doesn't look like a valid email address.");
      return;
    }
    setFieldError("");
    setStage("sending");
    const result = await submitAiLead({
      email: email.trim().toLowerCase(),
      ...collectAttribution(firstQuestion, intent),
    });
    if (result.ok) {
      setLeadState("captured");
      setStage("sent");
    } else {
      setFieldError(result.message ?? "We couldn't save your email right now.");
      setStage("error");
    }
  };

  if (stage === "declined") {
    return (
      <p className="text-[12.5px] leading-5.5 text-ink-soft">
        No problem — I won't ask again. What else would you like to know?
      </p>
    );
  }

  if (stage === "sent") {
    return (
      <p className="flex items-start gap-1.5 text-[12.5px] leading-5.5 text-ink-soft" role="status">
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
        Done — we'll send a short summary and getting-started checklist to your
        inbox. Now, where were we?
      </p>
    );
  }

  if (stage === "offer") {
    return (
      <div>
        <p className="text-[12.5px] leading-5.5 text-ink-soft">
          By the way — want me to send a short recap of this plus a
          getting-started checklist to your inbox? Totally optional.
        </p>
        <div className="mt-2.5 flex gap-1.5">
          <button
            type="button"
            onClick={() => setStage("form")}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <Mail className="size-3" aria-hidden="true" />
            Yes, email it
          </button>
          <button
            type="button"
            onClick={decline}
            className="rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-[11.5px] font-medium text-ink-soft transition-colors hover:bg-neutral-50"
          >
            No thanks
          </button>
        </div>
      </div>
    );
  }

  // form / sending / error
  return (
    <form onSubmit={submit}>
      <label
        htmlFor="zybble-lead-email"
        className="block text-[12.5px] leading-5.5 text-ink-soft"
      >
        Great — where should we send it?
      </label>
      <div className="mt-2 flex gap-1.5">
        <input
          ref={emailRef}
          id="zybble-lead-email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={stage === "sending"}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? "zybble-lead-email-error" : undefined}
          className="h-8.5 min-w-0 flex-1 rounded-full border border-black/[0.08] bg-white px-3 text-[12px] text-ink outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-600/50 focus:ring-2 focus:ring-brand-600/15 disabled:bg-neutral-50"
        />
        <button
          type="submit"
          disabled={stage === "sending"}
          className="inline-flex h-8.5 shrink-0 items-center gap-1 rounded-full bg-brand-600 px-3 text-[11.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {stage === "sending" ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : null}
          {stage === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
      {fieldError ? (
        <p id="zybble-lead-email-error" role="alert" className="mt-1.5 text-[11px] leading-4 text-red-600">
          {fieldError}
        </p>
      ) : null}
      <button
        type="button"
        onClick={decline}
        className="mt-2 text-[11px] font-medium text-neutral-400 underline-offset-2 transition-colors hover:text-ink-mute hover:underline"
      >
        Actually, skip it
      </button>
    </form>
  );
}

/** Map the visible conversation to model messages (system prompt + turns). */
function toChatMessages(messages: Message[]): AIChatMessage[] {
  const turns: AIChatMessage[] = [];
  for (const message of messages) {
    if (message.kind === "user") turns.push({ role: "user", content: message.text });
    else if (message.kind === "assistant") turns.push({ role: "assistant", content: message.text });
  }
  return [
    { role: "system", content: assistantSystemPrompt() },
    ...turns.slice(-MAX_HISTORY_TURNS),
  ];
}

export function Assistant() {
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const reduced = usePrefersReducedMotion();

  const [messages, setMessages] = useState<Message[]>([{ kind: "intro" }]);
  const [input, setInput] = useState("");
  /** null = idle · "" = waiting for the first streamed token · text = streaming. */
  const [streaming, setStreaming] = useState<string | null>(null);
  const generating = streaming !== null;
  /**
   * The suggestion chips: three starters that, once used, are replaced by a
   * never-before-shown question from the pool (each under six words).
   */
  const [suggestions, setSuggestions] = useState<string[]>([...SUGGESTED_PROMPTS]);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Synchronous mirror of `messages` so send/retry build history reliably. */
  const messagesRef = useRef<Message[]>(messages);
  /** Stream deltas are batched into state on animation frames. */
  const pendingDelta = useRef("");
  const frameRef = useRef<number | null>(null);
  /** Every prompt that has ever appeared as a chip — replacements never repeat. */
  const shownSuggestionsRef = useRef<Set<string>>(new Set(SUGGESTED_PROMPTS));
  /** Session-shuffled queue of replacement questions (lazily shuffled once). */
  const suggestionPoolRef = useRef<string[] | null>(null);
  if (suggestionPoolRef.current === null) {
    suggestionPoolRef.current = shuffle(SUGGESTION_POOL);
  }

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

  /* Focus the composer whenever the panel opens */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /* Autoscroll conversation — including while tokens stream in */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [messages, streaming, open, reduced]);

  /* Never leak a pending animation frame */
  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  /* Keep the textarea fitted to its content (max two-ish lines) */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 72)}px`;
  }, [input]);

  const closePanel = (refocus?: boolean) => {
    setOpen(false);
    if (refocus) launcherRef.current?.focus();
  };

  const toggle = () => {
    if (showBadge) dismissBadge();
    setOpen((v) => !v);
  };

  const commit = (updater: (prev: Message[]) => Message[]) => {
    messagesRef.current = updater(messagesRef.current);
    setMessages(messagesRef.current);
  };

  const flushDelta = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setStreaming(pendingDelta.current);
  };

  const queueDelta = (delta: string) => {
    pendingDelta.current += delta;
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(flushDelta);
    }
  };

  const finishStreaming = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingDelta.current = "";
    setStreaming(null);
  };

  /* After a completed answer (never before or during), the assistant may —
     once per session — offer an optional email follow-up. Pure UI: the
     offer is deterministic, consent-first, and invisible to the model. */
  const maybeOfferLead = () => {
    const userMessages = messagesRef.current.filter(
      (m): m is Extract<Message, { kind: "user" }> => m.kind === "user",
    );
    const userTurns = userMessages.length;
    let intent: string | null = null;
    for (let i = userMessages.length - 1; i >= 0 && !intent; i--) {
      intent = detectLeadIntent(userMessages[i]!.text);
    }
    if (!shouldOfferLead(userTurns, intent)) return;
    setLeadState("offered");
    commit((m) => [
      ...m,
      { kind: "lead-offer", intent, firstQuestion: userMessages[0]?.text ?? "" },
    ]);
  };

  /* Run one AI turn over the given (already current) history. */
  const runTurn = async (history: AIChatMessage[]) => {
    setStreaming("");
    try {
      const full = await streamAIChat(history, { onDelta: queueDelta });
      commit((m) => [...m, { kind: "assistant", text: full }]);
      maybeOfferLead();
    } catch (error) {
      const text =
        error instanceof ZybbleAIError
          ? error.message
          : "Something went wrong reaching Zybble AI. Please try again.";
      commit((m) => [...m, { kind: "error", text }]);
    } finally {
      finishStreaming();
      inputRef.current?.focus();
    }
  };

  /* A used suggested question disappears from the chips and a new, unique
     question (under six words, never shown before this visit) rotates in. */
  const retireSuggestion = (prompt: string) => {
    const fresh = suggestionPoolRef.current!.find(
      (candidate) => !shownSuggestionsRef.current.has(candidate),
    );
    if (fresh) shownSuggestionsRef.current.add(fresh);
    setSuggestions((current) => {
      const next = current.filter((p) => p !== prompt);
      if (fresh) next.push(fresh);
      return next;
    });
  };

  /* Typed input and suggested prompts share this exact path. A prompt sent
     from a chip (fromSuggestion) — or typed text that matches a live chip —
     retires that chip so it never lingers after being used. */
  const send = (raw: string, fromSuggestion = false) => {
    const text = raw.trim();
    if (!text || generating) return;
    if (fromSuggestion || suggestions.includes(text)) retireSuggestion(text);
    setInput("");
    commit((m) => [...m, { kind: "user", text }]);
    void runTurn(toChatMessages(messagesRef.current));
  };

  const retryLast = () => {
    if (generating) return;
    const hasUserTurn = messagesRef.current.some((m) => m.kind === "user");
    commit((m) => {
      const next = [...m];
      while (next.length && next[next.length - 1]!.kind === "error") next.pop();
      return next;
    });
    if (!hasUserTurn) return;
    void runTurn(toChatMessages(messagesRef.current));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
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
              Zybble AI
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
                    Hey — I'm Zybble AI. What would you like to know about
                    Zybble? Ask anything below, or start with a suggestion.
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
            if (msg.kind === "lead-offer") {
              return (
                <MessageShell key={i}>
                  <LeadCaptureCard intent={msg.intent} firstQuestion={msg.firstQuestion} />
                </MessageShell>
              );
            }
            if (msg.kind === "error") {
              return (
                <MessageShell key={i}>
                  <p className="flex items-start gap-1.5 text-[12.5px] leading-5.5 text-red-700">
                    <TriangleAlert
                      className="mt-1 size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    {msg.text}
                  </p>
                  <button
                    type="button"
                    onClick={retryLast}
                    className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600"
                  >
                    <RotateCcw className="size-3" aria-hidden="true" />
                    Try again
                  </button>
                </MessageShell>
              );
            }
            return (
              <MessageShell key={i}>
                <RichContent text={msg.text} />
              </MessageShell>
            );
          })}

          {/* Streaming reply: dots until the first token, then live text with an
              inline caret that sits on the text's baseline while typing */}
          {generating ? (
            streaming ? (
              <MessageShell>
                <RichContent
                  text={streaming}
                  caret={<span className="qa-caret" aria-hidden="true" />}
                />
              </MessageShell>
            ) : (
              <div className="qa-msg flex justify-start" aria-label="Zybble AI is thinking">
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
            )
          ) : null}
        </div>

        {/* Composer — three suggested prompts (used ones rotate out) + typing bar */}
        <div className="border-t border-black/[0.05] bg-white px-3.5 py-3">
          <p
            id="zybble-assistant-suggestions"
            className="px-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-neutral-400"
          >
            Suggested
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => send(prompt, true)}
                disabled={generating}
                className="qa-chip group inline-flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-white px-3 py-1.5 text-left text-[12px] font-medium text-ink-soft transition-all duration-200 hover:border-brand-600/30 hover:text-ink focus-visible:border-brand-600/40 disabled:opacity-60"
              >
                <span
                  className="size-1 shrink-0 rounded-full bg-brand-500/60 transition-colors group-hover:bg-brand-600"
                  aria-hidden="true"
                />
                {prompt}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="mt-2.5 flex items-end gap-1.5">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about Zybble…"
              aria-label="Message the Zybble assistant"
              className="max-h-18 min-h-9 flex-1 resize-none overflow-y-auto rounded-2xl border border-black/[0.08] bg-white px-3 py-2 text-[12.5px] leading-5 text-ink outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-600/50 focus:ring-2 focus:ring-brand-600/15 disabled:bg-neutral-50"
            />
            <button
              type="submit"
              disabled={generating || !input.trim()}
              aria-label="Send message"
              title={generating ? "Zybble AI is answering…" : "Send message"}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-[0_1px_2px_rgba(11,99,67,0.22)] transition-all hover:bg-brand-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </button>
          </form>

          <div className="mt-2 flex items-center justify-between px-1">
            <p className="text-[9.5px] text-neutral-400">
              AI-generated answers from Zybble's product guide
            </p>
            <p className="text-[9.5px] text-neutral-400">Zybble AI</p>
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
        aria-label={open ? "Close Zybble AI assistant" : "Ask Zybble AI — open assistant"}
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
