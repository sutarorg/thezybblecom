import type { BlogPost } from "../types";
import { ZYBBLE_TEAM } from "../author";

export const post: BlogPost = {
  slug: "b2b-lead-generation-guide",
  title: "B2B Lead Generation: A Practical Guide for Small Teams",
  seoTitle: "B2B Lead Generation: A Practical Guide for Small Teams (2026)",
  description:
    "What B2B lead generation involves for a small team: inbound vs outbound, picking channels, defining your ICP, a repeatable process, and the metrics that matter.",
  excerpt:
    "Most lead-generation advice is written for companies with ten-person growth teams. This guide covers what works when it's you and maybe one colleague: channels, process, and honest trade-offs.",
  category: "Lead generation",
  primaryTopic: "B2B lead generation",
  datePublished: "2026-10-04",
  author: ZYBBLE_TEAM,
  thumbnail: "/blog/b2b-lead-generation-guide.webp",
  thumbnailWidth: 1280,
  thumbnailHeight: 720,
  thumbnailAlt:
    "Minimal illustration of scattered blank cards flowing through a funnel and emerging as a neat stack with a green corner mark",
  ogImage: "/blog/og/b2b-lead-generation-guide.jpg",
  intro: [
    "B2B lead generation is the process of finding companies that could buy from you, capturing enough information to reach them, and starting conversations that can become revenue. That's the whole discipline — everything else is tactics.",
    "This guide is written for small teams: founders doing their own sales, freelancers, agencies, and one-or-two-person sales functions. The advice that works at that size is different from what works with a ten-person SDR team, and we've tried to be honest about those differences throughout.",
  ],
  sections: [
    {
      id: "inbound-vs-outbound",
      heading: "Inbound vs. outbound: the real trade-off",
      blocks: [
        {
          type: "p",
          text: "Every lead-generation channel is a variation on two motions. **Inbound** means prospects find you — through content, search, referrals, or community presence — and raise their hand. **Outbound** means you find them: you build a list of companies that fit your offer and reach out directly.",
        },
        {
          type: "p",
          text: "The trade-off is time-to-results versus compounding. Inbound compounds: an article or a reputation keeps producing leads for years, but it typically takes months before it produces anything. Outbound is linear: it produces conversations this week in direct proportion to the work you put in, and stops the moment you stop. Small teams that need revenue soon almost always need an outbound motion first, with inbound built alongside it — not instead of it.",
        },
        {
          type: "table",
          caption: "Inbound vs. outbound at small-team scale",
          head: ["", "Inbound", "Outbound"],
          rows: [
            ["Time to first lead", "Weeks to months", "Days"],
            ["Cost profile", "Time up front, cheap later", "Steady time or tooling cost"],
            ["Volume control", "Low — you get what comes", "High — you choose the list size"],
            ["Targeting control", "Indirect (topics, keywords)", "Direct (you pick the companies)"],
            ["Compounds over time?", "Yes", "No — but the list and skills do"],
          ],
        },
      ],
    },
    {
      id: "define-your-icp",
      heading: "Start with a narrow ideal customer profile",
      blocks: [
        {
          type: "p",
          text: "An ideal customer profile (ICP) is a specific description of the companies most likely to buy, succeed, and stay. For a small team, the single most common lead-generation mistake is defining it too broadly. “Small businesses” is not an ICP. “Independent dental practices in Texas with 1–3 locations and an active Google profile” is — because you can actually build a list of them, write a message that speaks to them, and learn from their responses.",
        },
        {
          type: "p",
          text: "A practical ICP for list building needs at most five criteria, and every criterion must be **observable from the outside**. You can observe a business's category, location, review count, website quality, hiring activity, and tech stack. You cannot observe “values innovation.” Write the ICP from observable traits, and finding leads becomes a filtering problem instead of a guessing game.",
        },
        {
          type: "callout",
          title: "A test worth running",
          text: "If you can't describe your ICP in one sentence a tool or assistant could act on — like “marketing agencies in London with under 20 staff” — it's too vague to prospect against. Tighten it until you can.",
        },
      ],
    },
    {
      id: "choosing-channels",
      heading: "Choosing your channels (and how many)",
      blocks: [
        {
          type: "p",
          text: "Small teams fail at lead generation through fragmentation more than through channel choice. Running five channels at 20% effort produces less than two channels run properly. The realistic menu:",
        },
        {
          type: "list",
          items: [
            "**Cold email** — the default outbound channel for B2B: scalable, measurable, and cheap. Its effectiveness depends almost entirely on list quality and relevance, which is why list building matters more than copywriting.",
            "**Cold calling** — faster feedback than email and dramatically underused for local and traditional industries, where the phone is still how business gets done.",
            "**LinkedIn outreach** — strong where your buyers actually live on LinkedIn (tech, media, professional services); weak for most local and trade businesses.",
            "**Content and SEO** — the main inbound engine; works when you can write genuinely useful material your buyers search for.",
            "**Referrals and partnerships** — the highest-converting channel there is, but hard to schedule; systematize the ask rather than waiting for them.",
            "**Paid ads** — buys speed, costs money; usually the right move only after another channel has proven the message converts.",
          ],
        },
        {
          type: "p",
          text: "A sane starting stack for most small B2B teams: one outbound channel matched to where your buyers answer (email for office-based buyers, phone for trades and local services), plus referrals systematized, plus one long-term inbound bet.",
        },
      ],
    },
    {
      id: "the-outbound-process",
      heading: "A repeatable outbound process",
      blocks: [
        {
          type: "p",
          text: "Outbound that works is a pipeline of five stages, each with its own quality bar. When results disappoint, diagnose the stage — don't rewrite everything.",
        },
        {
          type: "list",
          ordered: true,
          items: [
            "**Source** — build a list of companies matching your ICP. Use maps data and discovery tools for local niches (see [How to Find Local Business Leads](/blog/how-to-find-local-business-leads)), directories and LinkedIn for others.",
            "**Qualify** — remove companies that merely resemble the ICP: closed businesses, wrong size, existing solution, bad fit. A smaller, cleaner list beats a bigger, noisier one every time — our [lead list guide](/blog/how-to-build-a-b2b-lead-list) covers this stage step by step.",
            "**Enrich** — add the details that make contact possible and messages relevant: direct phone, email, review data, anything you'll reference. More on this in [What Is Lead Enrichment?](/blog/what-is-lead-enrichment).",
            "**Reach out** — short, specific, relevant messages. The research you did in enrichment is what separates “relevant” from template spam.",
            "**Follow up and track** — most replies come from follow-ups, not first touches. Track every lead's status so nothing silently dies in a spreadsheet tab.",
          ],
        },
        {
          type: "p",
          text: "Note what this implies about effort allocation: three of the five stages happen before anyone writes an email. Teams that spend 80% of their energy on message copy and 20% on the list usually have it backwards.",
        },
      ],
    },
    {
      id: "metrics",
      heading: "The metrics that matter (and the ones that don't)",
      blocks: [
        {
          type: "p",
          text: "At small-team volume, elaborate funnel analytics mislead more than they inform — the sample sizes are too small. Four numbers are enough to steer by:",
        },
        {
          type: "list",
          items: [
            "**Qualified leads added per week** — the input you control most directly. If this is zero, nothing downstream can happen.",
            "**Reply rate** — replies (positive or negative) ÷ contacts reached. It measures list quality and relevance together. Silence means the list or the message is off; “no thanks” replies mean you're close.",
            "**Conversations started per week** — actual two-way exchanges with a fitting company. This is the real output of lead generation.",
            "**Lead-to-customer rate over time** — slow-moving, but it eventually tells you whether your ICP is right, not just your outreach.",
          ],
        },
        {
          type: "p",
          text: "Resist the pull of vanity volume — contacts scraped, emails sent. A hundred messages to a precise list routinely outperforms a thousand to a sloppy one, and it protects the thing small companies can't buy back: sender reputation and brand goodwill.",
        },
      ],
    },
    {
      id: "common-mistakes",
      heading: "Common mistakes to avoid",
      blocks: [
        {
          type: "list",
          items: [
            "**Buying stale lists.** Purchased lists decay fast and burn your sender reputation on dead addresses. Fresh, self-built lists from live sources outperform them on every metric that matters.",
            "**Scaling before message-market fit.** If ten hand-researched messages can't get a reply, five hundred automated ones won't either. Volume amplifies a working motion; it doesn't create one.",
            "**Ignoring consent and privacy rules.** B2B outreach is regulated — rules differ by country (GDPR and PECR in Europe, CAN-SPAM in the US, CASL in Canada). Know what applies to your market, honor opt-outs instantly, and only use contact data a business has made publicly available.",
            "**No follow-up system.** One-touch outreach wastes the list you worked to build. Decide the cadence before the first message goes out.",
            "**Treating lead generation as a one-off project.** It's a weekly habit. Teams that add leads every week have pipelines; teams that build one giant list per quarter have droughts.",
          ],
        },
      ],
    },
    {
      id: "putting-it-together",
      heading: "Putting it together",
      blocks: [
        {
          type: "p",
          text: "A realistic weekly rhythm for a one-or-two-person team: define one narrow ICP segment; add 50–100 qualified leads to the list; enrich and verify them; send relevant first touches and scheduled follow-ups; track replies; and review the four metrics on Friday. That loop, repeated, is the entire machine.",
        },
        {
          type: "p",
          text: "The sourcing step is the most mechanical part of the loop, and the easiest to compress. Zybble turns a one-sentence description of your ICP — “independent gyms in Manchester”, “roofing companies in Phoenix with 4+ stars” — into an organized, exportable lead list with phone, website, and email where publicly available. [See how it works](/#how-it-works), or [start free](/#pricing) and run your first segment this week.",
        },
      ],
    },
  ],
  related: [
    "how-to-build-a-b2b-lead-list",
    "how-to-find-local-business-leads",
    "what-is-lead-enrichment",
  ],
};
