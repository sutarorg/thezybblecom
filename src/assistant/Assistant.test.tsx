// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Assistant } from "./Assistant";
import { SUGGESTED_PROMPTS } from "./prompt";
import type { AIChatMessage } from "../lib/openrouter-ai";

/**
 * The landing-page assistant is Zybble AI, a real chatbot through the shared
 * AI helper (mocked here). These tests pin the chat contract: exactly three
 * suggested prompts that submit into the conversation and rotate out for
 * unique under-six-word replacements once used, a typing bar with
 * Enter-to-send, generation locking, streamed replies with the caret kept
 * inline with the text, and error recovery.
 */

const streamAIChat = vi.hoisted(() => vi.fn());

vi.mock("../lib/openrouter-ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/openrouter-ai")>();
  return { ...original, streamAIChat };
});

let container: HTMLDivElement;
let root: Root | null = null;

/* React 19 ignores plain `.value` assignment on controlled inputs; route it
   through the native setter so the input event is actually processed. */
function typeInto(input: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(input: HTMLTextAreaElement) {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

const flushFrame = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  // Desktop viewport so the assistant renders (it is desktop-only by design).
  const mq = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mq));
  // jsdom has no animation frames or smooth scrolling.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  Element.prototype.scrollTo = vi.fn();
  localStorage.clear();

  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container.remove();
  streamAIChat.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderAssistant() {
  root = createRoot(container);
  await act(async () => {
    root!.render(<Assistant />);
  });
  return container;
}

const suggestionButtons = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button.qa-chip"));

const chipTexts = (el: HTMLElement) =>
  suggestionButtons(el).map((b) => (b.textContent ?? "").trim());

/** "Under six words" = at most five whitespace-separated words. */
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

describe("Assistant chat", () => {
  it("shows exactly three suggested prompts and a typing bar", async () => {
    const el = await renderAssistant();

    const suggestions = suggestionButtons(el);
    expect(suggestions).toHaveLength(3);

    const input = el.querySelector("textarea");
    expect(input).not.toBeNull();
    expect(input!.getAttribute("placeholder")).toBe("Ask about Zybble…");

    const send = el.querySelector<HTMLButtonElement>("button[aria-label='Send message']");
    expect(send).not.toBeNull();
    expect(send!.disabled).toBe(true); // empty input
  });

  it("presents itself as Zybble AI", async () => {
    const el = await renderAssistant();

    expect(el.querySelector("#zybble-assistant-title")?.textContent).toBe("Zybble AI");
    expect(el.textContent).toContain("I'm Zybble AI");
    // The old provider label is gone — the assistant is branded Zybble AI.
    expect(el.textContent).not.toContain("DeepSeek");
  });

  it("retires a used suggestion and rotates in a unique short replacement", async () => {
    streamAIChat.mockResolvedValue("Answer.");
    const el = await renderAssistant();

    const initial = chipTexts(el);
    expect(initial).toHaveLength(3);
    const seen = new Set(initial);

    const useOneChip = async () => {
      const before = chipTexts(el);
      await act(async () => {
        suggestionButtons(el)[0]!.click();
      });
      await act(async () => {
        await flushFrame();
      });

      const after = chipTexts(el);
      // Still exactly three chips…
      expect(after).toHaveLength(3);
      // …the used one disappeared…
      expect(after).not.toContain(before[0]);
      // …replaced by exactly one new question under six words.
      const fresh = after.filter((c) => !seen.has(c));
      expect(fresh).toHaveLength(1);
      expect(wordCount(fresh[0]!)).toBeLessThan(6);
      after.forEach((c) => seen.add(c));
      return fresh[0]!;
    };

    const replacements = [await useOneChip(), await useOneChip(), await useOneChip()];
    // Every replacement is a different, never-before-shown question.
    expect(new Set(replacements).size).toBe(3);
  });

  it("also retires a chip when its exact text is typed and sent", async () => {
    streamAIChat.mockResolvedValue("Answer.");
    const el = await renderAssistant();
    const input = el.querySelector<HTMLTextAreaElement>("textarea")!;
    const before = chipTexts(el);

    await act(async () => {
      typeInto(input, before[1]!);
    });
    await act(async () => {
      pressEnter(input);
    });
    await act(async () => {
      await flushFrame();
    });

    const after = chipTexts(el);
    expect(after).toHaveLength(3);
    expect(after).not.toContain(before[1]);
  });

  it("submits a suggested prompt directly into the chat", async () => {
    streamAIChat.mockResolvedValue("Zybble finds businesses and turns them into leads.");
    const el = await renderAssistant();

    await act(async () => {
      suggestionButtons(el)[0]!.click();
    });
    await act(async () => {
      await flushFrame();
    });

    // The prompt became a user message…
    expect(el.textContent).toContain(SUGGESTED_PROMPTS[0]);
    // …the shared AI helper ran with system + user messages…
    expect(streamAIChat).toHaveBeenCalledTimes(1);
    const messages = streamAIChat.mock.calls[0]![0] as AIChatMessage[];
    expect(messages[0]!.role).toBe("system");
    expect(messages.at(-1)).toMatchObject({ role: "user", content: SUGGESTED_PROMPTS[0] });
    // …and the reply rendered.
    expect(el.textContent).toContain("turns them into leads");
  });

  it("sends typed input with Enter and keeps history across turns", async () => {
    streamAIChat.mockResolvedValue("First answer.");
    const el = await renderAssistant();
    const input = el.querySelector<HTMLTextAreaElement>("textarea")!;

    await act(async () => {
      typeInto(input, "What is Zybble?");
    });
    await act(async () => {
      pressEnter(input);
    });

    expect(streamAIChat).toHaveBeenCalledTimes(1);
    expect((streamAIChat.mock.calls[0]![0] as AIChatMessage[]).at(-1)).toMatchObject({
      role: "user",
      content: "What is Zybble?",
    });

    // Second turn carries the conversation history.
    streamAIChat.mockResolvedValue("Second answer.");
    await act(async () => {
      typeInto(input, "Who is it for?");
    });
    await act(async () => {
      pressEnter(input);
    });

    const messages = streamAIChat.mock.calls[1]![0] as AIChatMessage[];
    expect(messages.map((m) => `${m.role}:${m.content}`)).toContain("user:What is Zybble?");
    expect(messages.map((m) => `${m.role}:${m.content}`)).toContain("assistant:First answer.");
    expect(messages.at(-1)).toMatchObject({ role: "user", content: "Who is it for?" });
  });

  it("streams the reply as it arrives and clears the input", async () => {
    const el = await renderAssistant();
    const input = el.querySelector<HTMLTextAreaElement>("textarea")!;

    let release: ((value: string) => void) | undefined;
    streamAIChat.mockImplementation(
      (_messages: AIChatMessage[], options?: { onDelta?: (d: string) => void }) =>
        new Promise<string>((resolve) => {
          options?.onDelta?.("Zybble ");
          release = resolve;
        }),
    );

    await act(async () => {
      typeInto(input, "How does it work?");
    });
    await act(async () => {
      pressEnter(input);
    });
    await act(async () => {
      await flushFrame();
    });

    // Streaming text is visible before the stream completes…
    expect(el.textContent).toContain("Zybble ");
    // …the input was cleared… (React controlled input resets value)
    // …and sending is locked while generating.
    const send = el.querySelector<HTMLButtonElement>("button[aria-label='Send message']")!;
    expect(send.disabled).toBe(true);

    await act(async () => {
      release!("…it works end to end.");
    });
    await act(async () => {
      await flushFrame();
    });

    expect(el.textContent).toContain("it works end to end");
    // The input was cleared by the send, so the button rests disabled…
    const sendAfter = el.querySelector<HTMLButtonElement>("button[aria-label='Send message']")!;
    expect(sendAfter.disabled).toBe(true);
    // …and re-enables once the user types again.
    await act(async () => {
      typeInto(el.querySelector<HTMLTextAreaElement>("textarea")!, "Next question?");
    });
    expect(sendAfter.disabled).toBe(false);
  });

  it("keeps the streaming caret inline with the last line of text", async () => {
    const el = await renderAssistant();
    const input = el.querySelector<HTMLTextAreaElement>("textarea")!;

    let release: ((value: string) => void) | undefined;
    streamAIChat.mockImplementation(
      (_messages: AIChatMessage[], options?: { onDelta?: (d: string) => void }) =>
        new Promise<string>((resolve) => {
          options?.onDelta?.("Zybble finds businesses");
          release = resolve;
        }),
    );

    await act(async () => {
      typeInto(input, "How does it work?");
    });
    await act(async () => {
      pressEnter(input);
    });
    await act(async () => {
      await flushFrame();
    });

    const caret = el.querySelector(".qa-caret");
    expect(caret).not.toBeNull();
    // The caret lives inside the streamed text block (a paragraph or list
    // item) so it renders on the text's own line — not as a sibling dropped
    // below the block content.
    expect(caret!.closest("p, li")).not.toBeNull();
    expect(caret!.parentElement?.tagName).not.toBe("DIV");
    // It follows the streamed words in the same text node chain.
    expect(caret!.parentElement?.textContent).toContain("Zybble finds businesses");

    await act(async () => {
      release!(" and turns them into leads.");
    });
    await act(async () => {
      await flushFrame();
    });

    // The caret disappears once the reply is committed as a message.
    expect(el.querySelector(".qa-caret")).toBeNull();
    expect(el.textContent).toContain("turns them into leads");
  });

  it("shows an error with a retry that re-runs the last turn", async () => {
    const el = await renderAssistant();
    const input = el.querySelector<HTMLTextAreaElement>("textarea")!;

    streamAIChat.mockRejectedValueOnce(new Error("boom"));
    streamAIChat.mockResolvedValue("Recovered answer.");

    await act(async () => {
      typeInto(input, "Tell me about pricing");
    });
    await act(async () => {
      pressEnter(input);
    });

    expect(el.textContent).toContain("Something went wrong reaching Zybble AI");

    const retry = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Try again"));
    expect(retry).toBeDefined();

    await act(async () => {
      retry!.click();
    });

    expect(streamAIChat).toHaveBeenCalledTimes(2);
    // Retry reuses the conversation so far — the user turn is not duplicated.
    const messages = streamAIChat.mock.calls[1]![0] as AIChatMessage[];
    expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(el.textContent).toContain("Recovered answer.");
  });

  it("renders model output safely as text, never as HTML", async () => {
    streamAIChat.mockResolvedValue('**Bold** <img src=x onerror=alert(1)> plain');
    const el = await renderAssistant();

    await act(async () => {
      suggestionButtons(el)[1]!.click();
    });
    await act(async () => {
      await flushFrame();
    });

    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<img src=x onerror=alert(1)> plain");
  });
});
