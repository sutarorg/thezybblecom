/**
 * Zybble Assistant — DeepSeek chatbot grounding.
 *
 * The chatbot answers with Puter.js (DeepSeek V3.2), but its knowledge is
 * still the reviewed knowledge base in ./knowledge.ts: every intent is
 * flattened into a fact sheet that becomes the system prompt. That keeps the
 * CONTENT RULE the static assistant had — answers only state facts that
 * appear elsewhere on the public site; nothing is invented.
 */

import { INTENTS, type AnswerBlock } from "./knowledge";

/** Exactly three starter prompts; each submits directly into the chat. */
export const SUGGESTED_PROMPTS = [
  "What is Zybble and who is it for?",
  "How does Zybble find business leads?",
  "Which plan should I choose?",
] as const;

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
    'You are "Ask Zybble", the assistant on the Zybble website. Zybble (zybble.com) is an AI-powered business lead discovery tool: you describe the businesses you need in plain language, and Zybble finds them, structures the data into leads, and helps you work them.',
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
