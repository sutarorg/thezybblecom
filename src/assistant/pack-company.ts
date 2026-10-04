import type { Compact } from "./compact";

/**
 * Pack 5 — Zybble AI's own identity, the in-app product surface, and deeper
 * product facts that round out the fact sheet.
 *
 * Answer line syntax: "# " heading · "- " list item · else paragraph.
 * Content rule: only facts stated elsewhere on the public site or visible in
 * the product itself.
 */
export const PACK_COMPANY: Compact[] = [
  /* ——— Zybble AI identity ——— */
  { id: "me-who", q: "Who are you?", c: "ai", k: "who are you your name called identity chatbot bot assistant",
    a: ["I'm **Zybble AI** — the assistant on the Zybble website, and the same AI that interprets search requests and analyzes leads inside the product.", "Ask me anything about Zybble: lead discovery, lead data, plans, lists, exports, teams, or billing."],
    f: ["me-which-model", "how-ai", "what-is"] },
  { id: "me-which-model", q: "Which AI model are you?", c: "ai", k: "model which gpt chatgpt claude gemini llama llm engine powered built",
    a: ["I'm **Zybble AI** — Zybble's own AI. I run through Zybble's secure backend, so there's no third-party AI account, sign-in, or API key involved for you.", "My job here is answering questions about Zybble from this site's reviewed product guide."],
    f: ["me-who", "ai-limits", "security"] },
  { id: "me-human", q: "Am I talking to a human?", c: "ai", k: "human person real someone live agent people",
    a: ["No — I'm **Zybble AI**, an AI assistant. A person reads every message sent through the contact page and typically replies within one business day."],
    cta: ["Contact us", "/contact"], f: ["contact", "me-who", "sup-response"] },
  { id: "me-topics", q: "What can I ask you?", c: "support", k: "ask topics questions about help what",
    a: ["Anything about Zybble — how lead discovery works, what data leads include, Zybble AI, lists and tags, exports, pricing and plans, limits, teams and client workspaces, billing, and data handling.", "If it's not in my product guide, I'll say so and point you to the contact page."],
    f: ["x-c-assistant", "how-find", "pricing-work"] },

  /* ——— The app ——— */
  { id: "app-pages", q: "What does the Zybble app include?", c: "product", k: "app pages sections navigation areas screens dashboard inside",
    a: ["- **Overview** — recent searches, recent activity, and your lead lists", "- **Find Leads** — describe the businesses you want and run the search", "- **Search History** — every past search with its status", "- **Leads** and **Lists** — your working lead data, organized", "- **Exports** — every CSV you've generated", "- **Team**, **Workspaces**, **Billing**, **Usage**, and **Settings**"],
    f: ["app-find", "app-history", "app-exports"] },
  { id: "app-find", q: "What does the Find page do?", c: "product", k: "find page search screen describe request interpret",
    a: ["It's where discovery starts. Describe the businesses you want in one sentence and **Zybble AI interprets it** into business type, location, quantity, and filters — or set the same criteria by hand.", "The interpreted filters are shown on the search, so you can see and adjust them before anything runs."],
    f: ["ai-discovery", "ex-filters", "how-find"] },
  { id: "app-history", q: "What is Search History?", c: "product", k: "search history page past searches status completed partial failed",
    a: ["Every search you run is listed on the Search History page with its status — **Completed**, **Partial**, or **Failed** — and you can search the list and filter it by status.", "It's your record of what you've run and what came back."],
    f: ["search-history", "app-find", "limits"] },
  { id: "app-leads", q: "How do I browse all my leads?", c: "lists", k: "leads page browse all table search filter database",
    a: ["The Leads page is where every business you've discovered lives — searchable, with filters for city, category, rating, status, tags, and whether a lead has a website or email.", "From there you can open any lead's full record."],
    f: ["app-lead-detail", "l-segment", "lead-info"] },
  { id: "app-lead-detail", q: "What does a lead's page show?", c: "data", k: "lead detail page profile open record information",
    a: ["Open any lead for the essentials — phone, website, rating, hours, and email when available — plus its tags, status, and notes, and the **Zybble AI analysis** of the business."],
    f: ["ai-summary", "lead-info", "tags-notes"] },
  { id: "app-exports", q: "What is the Exports page?", c: "export", k: "exports page csv download history file re-download",
    a: ["Every CSV you generate is tracked from preparing to download, and you can download it again any time from the Exports page.", "Export is included on every plan, including Free."],
    f: ["csv-export", "export-fields", "e-limit"] },
  { id: "app-usage", q: "Can I track my lead usage?", c: "usage", k: "usage page track allowance remaining leads used monitor",
    a: ["Yes — the Usage page shows how many leads you've discovered against your plan's monthly allowance, with a per-cycle chart and a breakdown of your activity.", "Searches pause at the limit until the cycle resets; saved lists and past exports stay accessible."],
    f: ["u-track", "limits", "limit-reset"] },
  { id: "app-team", q: "How do team invitations work?", c: "team", k: "team invite invitation email teammate member add join",
    a: ["Invite teammates by email from the Team page — they receive an invitation and join your workspace once they accept.", "Seats come with the plan: **Agency** includes 3 team members, **Scale** includes 5."],
    f: ["t-add", "team-use", "plan-agency"] },
  { id: "app-palette", q: "Is there a command palette?", c: "product", k: "command palette keyboard shortcut ctrl cmd quick navigate jump",
    a: ["Yes — inside the app, **Ctrl/Cmd + K** opens a command palette for jumping straight to any page and running quick actions."],
    f: ["app-pages", "gs-learning", "how-find"] },

  /* ——— Product & company ——— */
  { id: "c-url", q: "Where can I find Zybble online?", c: "product", k: "website url where online domain zybble.com find",
    a: ["Zybble lives at **zybble.com** — the product tour, pricing, and FAQ are on the landing page, and the app itself opens once you sign up."],
    f: ["gs-start", "what-is", "contact"] },
  { id: "c-steps", q: "How do I use Zybble, step by step?", c: "product", k: "steps how it works three simple start finish",
    a: ["- **Describe** the businesses you need — type, place, quantity", "- **Search** — Zybble interprets the request, scans business data, and deduplicates while you watch the progress", "- **Work the results** — review structured rows, save them into a tagged list, and export to CSV"],
    f: ["gs-workflow", "how-find", "search-process"] },
  { id: "c-search-stages", q: "What happens during a search?", c: "discovery", k: "stages progress during scanning collecting validating scoring running",
    a: ["While a search runs you watch it move through stages — resolving the location, scanning businesses, collecting public data and contact information, validating unique leads, and preparing the results.", "Deduplication is built in, so the rows you review are cleaned rather than raw."],
    f: ["how-find", "search-process", "gs-speed"] },
  { id: "c-ai-stages", q: "How does AI read my request?", c: "ai", k: "ai reads request stages identifying detecting preparing interpreting",
    a: ["When you describe the businesses you want, Zybble AI reads the request, identifies the business type, detects the location and filters, and prepares the structured search — all before anything runs.", "The filters it produces are visible and adjustable, never hidden."],
    f: ["ai-discovery", "app-find", "ex-filters"] },
  { id: "c-capabilities", q: "What capabilities does Zybble have?", c: "product", k: "capabilities features list what you get included",
    a: ["- AI lead discovery from a plain-language request", "- Business data — names, categories, addresses, ratings, hours", "- Phone & email data on every lead", "- Lead lists with tags, unlimited on paid plans", "- CSV export on every plan", "- Lead enrichment, AI insights, and team and client workspaces"],
    f: ["how-find", "lead-info", "pricing-work"] },
  { id: "c-focus", q: "What is Zybble focused on?", c: "product", k: "focus point purpose philosophy plain language simple",
    a: ["One plain-language request in, a structured lead list out — search, processing, deduplication, enrichment, and AI analysis in one place, with CSV export on every plan.", "No query language, no scripts to maintain, no borrowed logos or invented praise — just the product's capabilities, stated plainly."],
    f: ["x-c-what-makes", "how-find", "gs-vs-scraping"] },
];
