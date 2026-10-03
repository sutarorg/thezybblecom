/**
 * Zybble Assistant — DeepSeek chatbot grounding.
 *
 * The chatbot answers through the Zybble backend (/api/ai-chat — DeepSeek
 * V3.2 on OpenRouter's server-side API; no AI credential in the browser, no
 * third-party sign-in), but its knowledge is still the reviewed knowledge base in
 * ./knowledge.ts: every intent is flattened into a fact sheet that becomes
 * the system prompt. That keeps the CONTENT RULE the static assistant had —
 * answers only state facts that appear elsewhere on the public site; nothing
 * is invented. The backend pins the conversation shape to this assistant via
 * ASSISTANT_MARKER below (kept in sync with api/ai-chat.ts).
 */

import { INTENTS, type AnswerBlock } from "./knowledge";

/** Exactly three starter prompts; each submits directly into the chat. */
export const SUGGESTED_PROMPTS = [
  "What is Zybble and who is it for?",
  "How does Zybble find business leads?",
  "Which plan should I choose?",
] as const;

/**
 * Opening line of the assistant system prompt. The /api/ai-chat route pins
 * the proxy to this product assistant by requiring this exact marker in the
 * first (system) message — keep it byte-identical to ASSISTANT_MARKER in
 * api/ai-chat.ts (a test in api/_tests/ai-chat.test.ts enforces the sync).
 */
export const ASSISTANT_MARKER = 'You are "Ask Zybble", the assistant on the Zybble website';

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
 * System prompt for the assistant chat: persona, strict grounding rules, and
 * the full fact sheet derived from the knowledge base. Built once per page
 * load and reused for every turn.
 */
export function assistantSystemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;

  const entries = Object.values(INTENTS).map(
    (intent) => `Q: ${intent.question}\nA: ${flattenAnswer(intent.answer).join("\n")}`,
  );

  cachedPrompt = [
    `${ASSISTANT_MARKER}. Zybble (zybble.com) is an AI-powered business lead discovery tool: you describe the businesses you need in plain language, and Zybble finds them, structures the data into leads, and helps you work them.`,
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
