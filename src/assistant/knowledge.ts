/**
 * Zybble Assistant — reviewed expert knowledge base.
 *
 * The chatbot runs on DeepSeek V3.2 through the Zybble backend (see
 * ./prompt.ts and ../lib/openrouter-ai.ts — the browser talks to
 * /api/ai-chat, never to the AI provider directly); this module is its
 * single source of truth. Every
 * entry is flattened into the assistant's system prompt so answers stay
 * grounded in reviewed content.
 *
 * CONTENT RULE: answers only state facts that appear elsewhere on the
 * public site. No invented features, numbers, or guarantees.
 */

import { expand } from "./compact";
import { PACK_PRODUCT } from "./pack-product";
import { PACK_DATA_AI } from "./pack-data-ai";
import { PACK_PLANS } from "./pack-plans";
import { PACK_EXTRA } from "./pack-extra";

export type AnswerBlock =
  | { type: "p"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] };

export type Cta = { label: string; href: string };

export type Intent = {
  id: string;
  /** The suggestion button label */
  question: string;
  /** Semantic topic — used as conversation context */
  category: string;
  /** Terms the engine associates with this intent (use-case routing) */
  keywords: string[];
  answer: AnswerBlock[];
  cta?: Cta;
  /** Contextual follow-up intents (prioritized as next suggestions) */
  follow: string[];
};

/* ------------------------------------------------------------------ */
/* Knowledge entries                                                   */
/* ------------------------------------------------------------------ */
const CORE_INTENTS: Record<string, Intent> = {
  /* ——— Product ——— */
  "what-is": {
    id: "what-is",
    question: "What is Zybble?",
    category: "product",
    keywords: ["what", "about", "overview", "intro"],
    answer: [
      {
        type: "p",
        text: "Zybble is an AI-powered **business lead discovery** tool. Tell it which businesses you need — it finds them, organizes them into lead lists, enriches the details, and helps you understand each prospect with AI.",
      },
    ],
    cta: { label: "Start for free", href: "/#pricing" },
    follow: ["how-find", "who-for", "pricing-work", "how-ai"],
  },
  "who-for": {
    id: "who-for",
    question: "Who is Zybble for?",
    category: "product",
    keywords: ["who", "users", "audience", "agencies", "teams", "founders"],
    answer: [
      {
        type: "p",
        text: "Anyone who works targeted lists of businesses: **founders** finding first customers, **sales teams** building pipeline, **marketers** researching a market, and **agencies** running lead discovery for clients.",
      },
      {
        type: "p",
        text: "Plans scale from a free solo tier up to **Scale**, which covers 50,000 leads a month and client workspaces.",
      },
    ],
    follow: ["agency-use", "team-use", "plan-free", "how-find"],
  },

  /* ——— Lead discovery ——— */
  "how-find": {
    id: "how-find",
    question: "How does Zybble find leads?",
    category: "discovery",
    keywords: ["how", "find", "search", "process", "work", "discover"],
    answer: [
      {
        type: "p",
        text: "You describe the businesses you want in **plain language**. Zybble turns that sentence into a structured search across business data, then organizes what it finds into clean, usable leads.",
      },
      {
        type: "list",
        items: [
          "You type the request — type, place, quantity",
          "Zybble interprets it into a structured search",
          "Results are normalized and checked for new unique businesses",
          "Leads arrive as structured rows, ready to work",
        ],
      },
    ],
    cta: { label: "Start finding leads", href: "/#pricing" },
    follow: ["example-search", "lead-info", "csv-export", "how-ai"],
  },
  "find-for-me": {
    id: "find-for-me",
    question: "Can Zybble find leads for me?",
    category: "discovery",
    keywords: ["can", "me", "my", "dentists", "restaurants", "businesses", "leads"],
    answer: [
      {
        type: "p",
        text: "Yes — that's the core of the product. Describe the **business type**, the **location**, and any requirements like a minimum rating or having a website, and Zybble returns structured leads you can keep working.",
      },
      {
        type: "p",
        text: "The Free plan lets you try it on a real search, with **50 leads a month**.",
      },
    ],
    cta: { label: "Start for free", href: "/#pricing" },
    follow: ["example-search", "what-can-search", "lead-info", "limits"],
  },
  "what-can-search": {
    id: "what-can-search",
    question: "What can I search for?",
    category: "discovery",
    keywords: ["search", "categories", "type", "kind", "any", "location"],
    answer: [
      {
        type: "p",
        text: "Any business category and geography you can describe — “dentists in Austin”, “boutique hotels in Oregon”, “marketing agencies in Chicago”.",
      },
      {
        type: "p",
        text: "Add requirements like **minimum rating**, **has a website**, or **has a phone number**, and Zybble applies them as filters.",
      },
    ],
    follow: ["example-search", "how-find", "lead-info", "limits"],
  },
  "example-search": {
    id: "example-search",
    question: "Show me an example",
    category: "discovery",
    keywords: ["example", "show", "demo", "try", "sample"],
    answer: [
      { type: "heading", text: "Try" },
      {
        type: "p",
        text: "“Find 500 dentists in Austin with websites and ratings above 4.”",
      },
      {
        type: "p",
        text: "Zybble interprets the request, searches the relevant business data, removes duplicate results, and presents the leads as structured rows.",
      },
    ],
    follow: ["search-process", "lead-info", "save-results"],
  },
  "search-process": {
    id: "search-process",
    question: "What happens next?",
    category: "discovery",
    keywords: ["next", "then", "after", "happens", "result"],
    answer: [
      {
        type: "p",
        text: "Results land in a reviewable list — business, phone, website, rating, status. From there you can:",
      },
      {
        type: "list",
        items: [
          "**Save** the results into a lead list",
          "**Enrich** leads with contact details",
          "**Analyze** a business with Zybble AI",
          "**Export** the list to CSV on any plan",
        ],
      },
    ],
    follow: ["lead-lists", "lead-info", "csv-export", "how-ai"],
  },
  "save-results": {
    id: "save-results",
    question: "Can I save the results?",
    category: "lists",
    keywords: ["save", "keep", "store", "results"],
    answer: [
      {
        type: "p",
        text: "Yes — any search can be saved into a **lead list** and tagged, so campaigns, markets, and clients stay cleanly separated.",
      },
      {
        type: "p",
        text: "Free includes **1 list**; Growth, Agency, and Scale include **unlimited lists**.",
      },
    ],
    follow: ["lead-lists", "csv-export", "limits"],
  },

  /* ——— Data ——— */
  "lead-info": {
    id: "lead-info",
    question: "What information do I get?",
    category: "data",
    keywords: ["info", "information", "data", "fields", "contain", "details", "emails", "email"],
    answer: [
      {
        type: "p",
        text: "Every lead is a structured business record:",
      },
      {
        type: "list",
        items: [
          "**Identity** — name, category, business types",
          "**Contact** — phone, website, email when publicly available",
          "**Location** — address, country, coordinates",
          "**Reputation** — rating, review count",
          "**Context** — hours, price level, amenities where available",
        ],
      },
      {
        type: "p",
        text: "Exact fields depend on each business's available data.",
      },
    ],
    follow: ["lead-sources", "enrichment-data", "csv-export", "how-ai"],
  },
  "lead-sources": {
    id: "lead-sources",
    question: "Where does the data come from?",
    category: "data",
    keywords: ["source", "from", "maps", "google", "public", "data"],
    answer: [
      {
        type: "p",
        text: "Leads are assembled from **publicly available business information** — business listings, such as Google Maps results, plus the business's own website and public profiles.",
      },
      {
        type: "p",
        text: "Where a detail isn't public — an email address, for example — the field simply stays empty rather than being guessed.",
      },
    ],
    follow: ["lead-info", "how-find", "csv-export"],
  },
  "enrichment-data": {
    id: "enrichment-data",
    question: "Does it find contact details?",
    category: "data",
    keywords: ["email", "phone", "contact", "enrich", "enrichment", "website"],
    answer: [
      {
        type: "p",
        text: "Yes. Beyond the base business record, Zybble enriches leads with **phone numbers**, **websites**, and **email addresses when they're publicly available**.",
      },
      {
        type: "p",
        text: "Phone and email data is included on **every plan** — including Free.",
      },
    ],
    follow: ["lead-info", "pricing-work", "csv-export"],
  },

  /* ——— Zybble AI ——— */
  "how-ai": {
    id: "how-ai",
    question: "How does Zybble AI work?",
    category: "ai",
    keywords: ["ai", "artificial", "intelligence", "analyze", "analysis", "summary"],
    answer: [
      {
        type: "p",
        text: "Zybble AI has two jobs. First, it **interprets your natural-language request** into a structured search. Second, it **analyzes the businesses it finds**.",
      },
      {
        type: "p",
        text: "For a lead, it summarizes what the available data suggests — local presence, review activity, website status, and possible outreach angles.",
      },
      {
        type: "p",
        text: "AI output is generated from available business data, so **verify before you act** on it.",
      },
    ],
    follow: ["ai-discovery", "ai-availability", "lead-info", "example-search"],
  },
  "ai-discovery": {
    id: "ai-discovery",
    question: "Does AI do the searching?",
    category: "ai",
    keywords: ["ai", "find", "search", "automatic", "interpret"],
    answer: [
      {
        type: "p",
        text: "AI interprets the request — it doesn't invent results. You write one sentence; Zybble AI breaks it into **business type, location, quantity, and filters**, and maps that to a structured business search.",
      },
      {
        type: "p",
        text: "The leads themselves come from real business data, deduplicated and organized.",
      },
    ],
    follow: ["example-search", "ai-availability", "how-find"],
  },
  "ai-availability": {
    id: "ai-availability",
    question: "Which plans include Zybble AI?",
    category: "ai",
    keywords: ["ai", "plan", "include", "available", "growth"],
    answer: [
      {
        type: "p",
        text: "Zybble AI is included on **every plan, including Free** — interpretation on /find and per-lead analysis.",
      },
      {
        type: "p",
        text: "Paid plans raise volume, lists, seats, and add client workspaces — AI isn't gated behind an upgrade.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["pricing-work", "plan-growth", "plan-scale"],
  },

  /* ——— Lists ——— */
  "lead-lists": {
    id: "lead-lists",
    question: "How do lead lists work?",
    category: "lists",
    keywords: ["list", "lists", "organize", "save", "tag"],
    answer: [
      {
        type: "p",
        text: "Save any search into a list — “Austin Dentists”, for example — then tag leads like **New**, **High rating**, or **Website** to slice the list the way you work.",
      },
      {
        type: "p",
        text: "The Free plan includes **1 list** with up to 50 leads a month; every paid plan includes **unlimited lists**.",
      },
    ],
    follow: ["tags-notes", "unlimited-lists", "csv-export", "workspaces"],
  },
  "tags-notes": {
    id: "tags-notes",
    question: "Can I tag and note leads?",
    category: "lists",
    keywords: ["tag", "tags", "note", "notes", "organize"],
    answer: [
      {
        type: "p",
        text: "Yes. Leads carry **tags and status** — New, Enriched, Contacted — plus notes, so a list reflects where each prospect actually stands.",
      },
      {
        type: "p",
        text: "Tag counts stay visible at the top of a list, making segments like “High rating” one click away.",
      },
    ],
    follow: ["lead-lists", "workspaces", "csv-export"],
  },
  "unlimited-lists": {
    id: "unlimited-lists",
    question: "Is there a list limit?",
    category: "lists",
    keywords: ["limit", "lists", "unlimited", "how many"],
    answer: [
      {
        type: "list",
        items: [
          "**Free** — 1 lead list",
          "**Growth** — unlimited lists",
          "**Agency** — unlimited lists",
          "**Scale** — unlimited lists",
        ],
      },
      {
        type: "p",
        text: "Monthly lead allowances are separate from list counts, and reset each month.",
      },
    ],
    follow: ["limits", "pricing-work", "plan-growth"],
  },

  /* ——— Export ——— */
  "csv-export": {
    id: "csv-export",
    question: "Can I export leads?",
    category: "export",
    keywords: ["export", "csv", "download", "crm", "spreadsheet"],
    answer: [
      {
        type: "p",
        text: "Yes — **CSV export is on every plan**, including Free. Your leads are never locked in.",
      },
      {
        type: "p",
        text: "Choose the fields, pick the leads, and take the file into your CRM, sequencer, or spreadsheet.",
      },
    ],
    cta: { label: "Start for free", href: "/#pricing" },
    follow: ["export-fields", "lead-lists", "pricing-work"],
  },
  "export-fields": {
    id: "export-fields",
    question: "What goes into the CSV?",
    category: "export",
    keywords: ["csv", "fields", "columns", "inside"],
    answer: [
      {
        type: "p",
        text: "You choose the fields at export time:",
      },
      {
        type: "list",
        items: ["Business name and category", "Phone and email", "Website and address", "Rating and review count"],
      },
      {
        type: "p",
        text: "Export just the visible selection or the whole list.",
      },
    ],
    follow: ["csv-export", "lead-info", "pricing-work"],
  },

  /* ——— Pricing ——— */
  "pricing-work": {
    id: "pricing-work",
    question: "How does pricing work?",
    category: "pricing",
    keywords: ["price", "pricing", "cost", "much", "plans", "pay"],
    answer: [
      {
        type: "p",
        text: "Four monthly plans, built around how many leads you need:",
      },
      {
        type: "list",
        items: [
          "**Free** — $0/mo · 50 leads a month",
          "**Growth** — $49/mo · 5,000 leads a month",
          "**Agency** — $99/mo · 15,000 leads a month",
          "**Scale** — $199/mo · 50,000 leads a month",
        ],
      },
      {
        type: "p",
        text: "All billed monthly. Cancel anytime.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["plan-free", "plan-growth", "plan-agency", "plan-scale", "limits"],
  },
  "which-plan": {
    id: "which-plan",
    question: "Which plan should I start with?",
    category: "pricing",
    keywords: ["which", "plan", "start", "recommend", "choose", "best"],
    answer: [
      {
        type: "p",
        text: "It depends on volume. **Free ($0/mo)** covers a first real search with 50 leads a month — enough to evaluate the product.",
      },
      {
        type: "p",
        text: "For everyday prospecting, **Growth ($49/mo)** raises that to 5,000 leads with unlimited lists. Agencies add team seats and client workspaces on **Agency** and **Scale**.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["plan-free", "plan-growth", "agency-use", "limits"],
  },
  "plan-free": {
    id: "plan-free",
    question: "What's the cheapest way to start?",
    category: "pricing",
    keywords: ["cheap", "cheapest", "free", "start", "zero", "cost"],
    answer: [
      { type: "heading", text: "Free — $0/mo" },
      {
        type: "list",
        items: [
          "50 leads per month",
          "Phone & email data",
          "CSV export",
          "1 lead list",
          "1 user",
        ],
      },
      {
        type: "p",
        text: "Enough for a real search — no card needed to evaluate the product.",
      },
    ],
    cta: { label: "Start for free", href: "/#pricing" },
    follow: ["plan-growth", "limits", "pricing-work"],
  },
  "plan-growth": {
    id: "plan-growth",
    question: "What does Growth include?",
    category: "pricing",
    keywords: ["growth", "49", "5000", "5,000"],
    answer: [
      { type: "heading", text: "Growth — $49/mo" },
      {
        type: "list",
        items: [
          "5,000 leads per month",
          "Phone & email data",
          "CSV export",
          "Unlimited lead lists",
          "Zybble AI",
          "1 user",
        ],
      },
      {
        type: "p",
        text: "Built for consistent, everyday prospecting by one person.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["plan-agency", "how-ai", "limits"],
  },
  "plan-agency": {
    id: "plan-agency",
    question: "What does Agency include?",
    category: "pricing",
    keywords: ["agency", "99", "15000", "15,000", "clients"],
    answer: [
      { type: "heading", text: "Agency — $99/mo" },
      {
        type: "list",
        items: [
          "15,000 leads per month",
          "Everything in Growth",
          "3 team members",
          "Client workspaces",
        ],
      },
      {
        type: "p",
        text: "Made for teams running lead discovery for clients.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["plan-scale", "workspaces", "team-use"],
  },
  "plan-scale": {
    id: "plan-scale",
    question: "What does Scale include?",
    category: "pricing",
    keywords: ["scale", "199", "50000", "50,000", "priority"],
    answer: [
      { type: "heading", text: "Scale — $199/mo" },
      {
        type: "list",
        items: [
          "50,000 leads per month",
          "Everything in Agency",
          "5 team members",
          "Priority lead processing",
        ],
      },
      {
        type: "p",
        text: "High-volume discovery with priority handling.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["priority", "workspaces", "limits"],
  },
  "leads-5000": {
    id: "leads-5000",
    question: "I need about 5,000 leads",
    category: "pricing",
    keywords: ["5000", "5,000", "volume", "need", "leads"],
    answer: [
      {
        type: "p",
        text: "That maps to **Growth — $49/mo**: 5,000 leads a month, unlimited lists, phone and email data, and CSV export.",
      },
      {
        type: "p",
        text: "If you also need teammates or client workspaces, that's **Agency — $99/mo** with 15,000 leads.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["plan-agency", "limits", "how-ai"],
  },
  "leads-50000": {
    id: "leads-50000",
    question: "I need 50,000 leads",
    category: "pricing",
    keywords: ["50000", "50,000", "volume", "scale", "big"],
    answer: [
      {
        type: "p",
        text: "That maps to **Scale — $199/mo**: 50,000 leads a month, 5 team members, client workspaces, and priority lead processing.",
      },
      {
        type: "p",
        text: "Allowances reset at the start of each monthly cycle.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["priority", "team-use", "workspaces"],
  },

  /* ——— Teams & workspaces ——— */
  "agency-use": {
    id: "agency-use",
    question: "Can agencies use Zybble?",
    category: "workspaces",
    keywords: ["agency", "agencies", "clients", "client"],
    answer: [
      {
        type: "p",
        text: "Yes — **Agency ($99/mo)** and **Scale ($199/mo)** are built for it. Both include **client workspaces**, so each client's searches, lists, and exports stay separate.",
      },
      {
        type: "p",
        text: "Agency covers **3 team members** and 15,000 leads; Scale covers **5 team members** and 50,000 leads.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["workspaces", "team-use", "plan-scale"],
  },
  "team-use": {
    id: "team-use",
    question: "Can my team use it?",
    category: "team",
    keywords: ["team", "members", "seats", "users", "colleagues"],
    answer: [
      {
        type: "list",
        items: [
          "**Free & Growth** — 1 user",
          "**Agency** — 3 team members",
          "**Scale** — 5 team members",
        ],
      },
      {
        type: "p",
        text: "Team plans also add client workspaces and unlimited lists — Zybble AI is on every plan.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["plan-agency", "workspaces", "leads-5000"],
  },
  workspaces: {
    id: "workspaces",
    question: "How do client workspaces work?",
    category: "workspaces",
    keywords: ["workspace", "workspaces", "client", "separate"],
    answer: [
      {
        type: "p",
        text: "Client workspaces keep each client's **searches, lead lists, and exports** fully separate, while your whole team works from one account.",
      },
      {
        type: "p",
        text: "Included on **Agency** and **Scale**.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["plan-agency", "team-use", "lead-lists"],
  },
  priority: {
    id: "priority",
    question: "What is priority lead processing?",
    category: "pricing",
    keywords: ["priority", "processing", "faster", "scale"],
    answer: [
      {
        type: "p",
        text: "On **Scale**, large searches are processed ahead of the standard queue, so 50,000-lead months move quickly.",
      },
      {
        type: "p",
        text: "It's the top tier's way of keeping high-volume discovery predictable.",
      },
    ],
    follow: ["plan-scale", "limits", "pricing-work"],
  },

  /* ——— Usage & billing ——— */
  limits: {
    id: "limits",
    question: "How do monthly lead limits work?",
    category: "usage",
    keywords: ["limit", "limits", "monthly", "allowance", "reset"],
    answer: [
      {
        type: "list",
        items: [
          "**Free** — 50 leads a month",
          "**Growth** — 5,000 a month",
          "**Agency** — 15,000 a month",
          "**Scale** — 50,000 a month",
        ],
      },
      {
        type: "p",
        text: "Allowances reset at the start of each monthly cycle.",
      },
    ],
    follow: ["limit-reset", "pricing-work", "plan-growth"],
  },
  "limit-reset": {
    id: "limit-reset",
    question: "What happens at my monthly limit?",
    category: "usage",
    keywords: ["reach", "limit", "run out", "pause", "reset"],
    answer: [
      {
        type: "p",
        text: "New searches pause until your allowance resets at the start of the next monthly cycle — or until you move to a plan with more capacity.",
      },
      {
        type: "p",
        text: "Your **saved lists and past exports always remain accessible**.",
      },
    ],
    follow: ["limits", "pricing-work", "which-plan"],
  },
  billing: {
    id: "billing",
    question: "Can I cancel anytime?",
    category: "billing",
    keywords: ["cancel", "billing", "monthly", "contract", "annual"],
    answer: [
      {
        type: "p",
        text: "Yes. Plans are **billed monthly, in advance**, with no annual commitments or long-term lock-ins.",
      },
      {
        type: "p",
        text: "Cancel anytime — the change takes effect at the end of the current billing period.",
      },
    ],
    cta: { label: "View pricing", href: "/#pricing" },
    follow: ["pricing-work", "limits", "contact"],
  },

  /* ——— Security & humans ——— */
  security: {
    id: "security",
    question: "How is my data handled?",
    category: "security",
    keywords: ["privacy", "data", "secure", "security", "share", "sell"],
    answer: [
      {
        type: "p",
        text: "Your searches, lists, and exports live only while your account does — and are **never shared with other customers**. Payment details are processed by the payment provider, not stored by Zybble.",
      },
      {
        type: "p",
        text: "You can **export everything to CSV anytime** and delete searches, lists, or your whole account.",
      },
      {
        type: "p",
        text: "The full detail is on the Privacy page.",
      },
    ],
    cta: { label: "Read the privacy policy", href: "/privacy" },
    follow: ["lead-sources", "contact", "csv-export"],
  },
  contact: {
    id: "contact",
    question: "How do I talk to a human?",
    category: "support",
    keywords: ["contact", "support", "human", "help", "email"],
    answer: [
      {
        type: "p",
        text: "Write to us — a person reads every message and replies **within one business day**.",
      },
      {
        type: "p",
        text: "Use the contact page for product, pricing, or partnership questions, or email **tejassutar.business@gmail.com** directly.",
      },
    ],
    cta: { label: "Contact us", href: "/contact" },
    follow: ["pricing-work", "how-find", "what-is"],
  },
};

/* ------------------------------------------------------------------ */
/* Suggestion sources                                                  */
/* ------------------------------------------------------------------ */
/* The chat UI surfaces exactly three suggested prompts (see ./prompt.ts);
 * they submit straight into the DeepSeek conversation. */

/* ------------------------------------------------------------------ */
/* Registry — core entries + authored packs                            */
/* ------------------------------------------------------------------ */
export const INTENTS: Record<string, Intent> = { ...CORE_INTENTS };

for (const entry of [
  ...PACK_PRODUCT,
  ...PACK_DATA_AI,
  ...PACK_PLANS,
  ...PACK_EXTRA,
]) {
  if (!INTENTS[entry.id]) INTENTS[entry.id] = expand(entry);
}
