/**
 * Zybble AI — landing-page assistant grounding.
 *
 * The chatbot answers through the Zybble backend (/api/ai-chat — Zybble AI
 * answering server-side via OpenRouter; no AI credential in the browser, no
 * third-party sign-in), but its knowledge is still the reviewed knowledge
 * base in ./knowledge.ts: every intent is flattened into a fact sheet that
 * becomes the system prompt. That keeps the CONTENT RULE the static
 * assistant had — answers only state facts that appear elsewhere on the
 * public site; nothing is invented. The backend pins the conversation shape
 * to this assistant via ASSISTANT_MARKER below (kept in sync with
 * api/ai-chat.ts).
 */

import { INTENTS, type AnswerBlock } from "./knowledge";

/**
 * The starter chips shown when the panel opens. Every label — these and the
 * SUGGESTION_POOL replacements below — stays under six words so the chips
 * stay compact. Each submits directly into the chat; once used, the chip is
 * replaced by a never-before-shown question from the pool.
 */
export const SUGGESTED_PROMPTS = [
  "What is Zybble?",
  "How does Zybble find leads?",
  "Which plan should I choose?",
] as const;

/**
 * Replacement suggestions. When a visitor uses a suggested question, the chip
 * disappears and the next unused entry from this pool (shuffled per visit)
 * rotates in — so every replacement is unique and under six words.
 */
export const SUGGESTION_POOL = [
  "Who is Zybble for?",
  "What does Zybble AI do?",
  "What data comes with leads?",
  "Do leads include emails?",
  "Where does data come from?",
  "Can I export leads?",
  "How does pricing work?",
  "Is there a free plan?",
  "Can I cancel anytime?",
  "Can my team use Zybble?",
  "How do lead lists work?",
  "Can I filter by rating?",
  "Does Zybble remove duplicates?",
  "Can agencies use Zybble?",
  "What are client workspaces?",
  "Can I re-run a search?",
  "How is my data handled?",
  "What makes Zybble different?",
  "Can I tag my leads?",
  "Is Zybble AI really free?",
  "How do I get started?",
  "Can I search any city?",
  "What are lead statuses?",
  "How fast are results?",
] as const;

/**
 * Opening line of the assistant system prompt. The /api/ai-chat route pins
 * the proxy to this product assistant by requiring this exact marker in the
 * first (system) message — keep it byte-identical to ASSISTANT_MARKER in
 * api/ai-chat.ts (a test in api/_tests/ai-chat.test.ts enforces the sync).
 */
export const ASSISTANT_MARKER = 'You are "Zybble AI", the assistant on the Zybble website';

/** Flatten answer blocks into compact plain-text lines for the fact sheet. */
function flattenAnswer(blocks: AnswerBlock[]): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      lines.push(`${block.text}:`);
    } else if (block.type === "list") {
      for (const item of block.items) lines.push(`- ${item}`);
    } else {
      lines.push(block.text);
    }
  }
  return lines;
}

let cachedPrompt: string | null = null;

/**
 * System prompt for the assistant chat: persona (Zybble AI — never any other
 * model), strict grounding rules, and the full fact sheet derived from the
 * knowledge base. Built once per page load and reused for every turn.
 */
export function assistantSystemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;

  const entries = Object.values(INTENTS).map(
    (intent) => `Q: ${intent.question}\nA: ${flattenAnswer(intent.answer).join("\n")}`,
  );

  cachedPrompt = [
    `${ASSISTANT_MARKER}. Zybble (zybble.com) is an AI-powered business lead discovery tool: you describe the businesses you need in plain language, and Zybble finds them, structures the data into leads, and helps you work them.`,
    "",
    "IDENTITY: Your name is **Zybble AI**. You are Zybble's own AI assistant — the same Zybble AI that interprets search requests and analyzes leads inside the product. If anyone asks who you are, what you're called, or which AI, model, or company powers you, say you are Zybble AI. Never say or imply that you are DeepSeek, ChatGPT, GPT, Claude, Gemini, Grok, Llama, or any other model or company, and never mention underlying models, providers, or infrastructure — you are Zybble AI, full stop.",
    "",
    "Answer questions about Zybble using ONLY the fact sheet below. If the answer is not in the fact sheet, say you're not sure and point the visitor to the contact page (/contact). Never invent features, prices, limits, or guarantees.",
    "",
    "Answer style: friendly, concise, and conversational — usually 2-4 short sentences or a brief list. Plain text only: no headings, no code blocks, no links. You may use **bold** sparingly to highlight key terms.",
    "",
    "FACT SHEET — verified Zybble product information:",
    ...entries.map((entry) => `\n${entry}`),
  ].join("\n");

  return cachedPrompt;
}
