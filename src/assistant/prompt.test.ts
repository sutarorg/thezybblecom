import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MARKER,
  SUGGESTED_PROMPTS,
  SUGGESTION_POOL,
  assistantSystemPrompt,
} from "./prompt";
import { INTENTS } from "./knowledge";

/**
 * Zybble AI grounding rules: every suggested question (starter or rotated
 * replacement) is unique and under six words, and the persona the model
 * receives always introduces itself as Zybble AI — never another model.
 */

/** "Under six words" = at most five whitespace-separated words. */
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

describe("suggested questions", () => {
  it("starts with exactly three starter chips, each under six words", () => {
    expect(SUGGESTED_PROMPTS).toHaveLength(3);
    for (const prompt of SUGGESTED_PROMPTS) {
      expect(wordCount(prompt)).toBeLessThan(6);
      expect(prompt.trim()).toBe(prompt);
      expect(prompt.endsWith("?")).toBe(true);
    }
  });

  it("keeps every replacement question unique and under six words", () => {
    const all = [...SUGGESTED_PROMPTS, ...SUGGESTION_POOL];
    // No prompt is ever repeated, so a rotated-in chip is always new.
    expect(new Set(all).size).toBe(all.length);
    for (const prompt of SUGGESTION_POOL) {
      expect(wordCount(prompt)).toBeLessThan(6);
      expect(prompt.trim()).toBe(prompt);
      expect(prompt.endsWith("?")).toBe(true);
    }
  });

  it("holds enough replacements for a long conversation", () => {
    expect(SUGGESTION_POOL.length).toBeGreaterThanOrEqual(12);
  });
});

describe("Zybble AI persona", () => {
  it("introduces the assistant as Zybble AI and forbids other identities", () => {
    const prompt = assistantSystemPrompt();
    expect(prompt.startsWith(ASSISTANT_MARKER)).toBe(true);
    expect(prompt).toContain("Your name is **Zybble AI**");
    expect(prompt).toContain("Never say or imply that you are DeepSeek");
  });

  it("grounds identity answers in the fact sheet", () => {
    const questions = Object.values(INTENTS).map((intent) => intent.question.toLowerCase());
    expect(questions).toContain("who are you?");
    expect(questions).toContain("which ai model are you?");
  });

  it("never brands the assistant as another model in the fact sheet", () => {
    const sheet = Object.values(INTENTS)
      .flatMap((intent) => intent.answer.map((block) => JSON.stringify(block)))
      .join("\n")
      .toLowerCase();
    expect(sheet).not.toContain("deepseek");
    expect(sheet).not.toContain("chatgpt");
    expect(sheet).not.toContain("openai");
  });
});
