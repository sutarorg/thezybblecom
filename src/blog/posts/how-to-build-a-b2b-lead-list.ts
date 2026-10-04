import type { BlogPost } from "../types";
import { ZYBBLE_TEAM } from "../author";

export const post: BlogPost = {
  slug: "how-to-build-a-b2b-lead-list",
  title: "How to Build a Qualified B2B Lead List, Step by Step",
  seoTitle: "How to Build a Qualified B2B Lead List (Step-by-Step Guide)",
  description:
    "A step-by-step process for a truly qualified B2B lead list: criteria, sources, deduplication, verification, segmentation, and keeping the list alive.",
  excerpt:
    "Anyone can assemble a spreadsheet of company names. This is the process for building a list where every row is reachable, relevant, and worth a salesperson's time — and keeping it that way.",
  category: "Prospecting",
  primaryTopic: "building a qualified lead list",
  datePublished: "2026-10-04",
  author: ZYBBLE_TEAM,
  thumbnail: "/blog/how-to-build-a-b2b-lead-list.webp",
  thumbnailWidth: 1280,
  thumbnailHeight: 720,
  thumbnailAlt:
    "Minimal illustration of a clean lead list table with five rows, green checkmarks on qualified rows and a pencil resting at the corner",
  ogImage: "/blog/og/how-to-build-a-b2b-lead-list.jpg",
  intro: [
    "A qualified lead list is one where every row has passed a test: the business exists, fits your ideal customer profile, and can actually be reached. That test — not the number of rows — is what separates a list that produces conversations from a spreadsheet that produces bounces.",
    "Here's the full process we recommend, in seven steps, with the checks that matter at each one.",
  ],
  sections: [
    {
      id: "step-1-define-qualified",
      heading: "Step 1: Define what “qualified” means — in writing",
      blocks: [
        {
          type: "p",
          text: "Before touching any data source, write down the entry criteria for the list. Unwritten criteria drift: by row 300, “dental practices in Texas” has quietly become “anything healthcare-adjacent in the South.” A good definition has two halves:",
        },
        {
          type: "list",
          items: [
            "**Fit criteria** — observable traits a business must have: category, geography, size signals, review profile, web presence. Three to five criteria is the sweet spot; more than that and nothing will qualify.",
            "**Exclusion criteria** — the disqualifiers people forget to write down: chains and franchises (if you sell to independents), existing customers, competitors, businesses that are permanently closed.",
          ],
        },
        {
          type: "p",
          text: "If you haven't formalized your ideal customer profile yet, do that first — the [B2B Lead Generation Guide](/blog/b2b-lead-generation-guide) walks through building an ICP from observable traits.",
        },
      ],
    },
    {
      id: "step-2-choose-fields",
      heading: "Step 2: Decide the columns before the rows",
      blocks: [
        {
          type: "p",
          text: "Pick the schema up front so every source feeds the same structure. A proven minimal set for business lead lists:",
        },
        {
          type: "table",
          caption: "A minimal lead list schema that holds up",
          head: ["Column", "Why it's there"],
          rows: [
            ["Business name", "Identity; half of your dedupe key"],
            ["Category", "Fit check and segmentation"],
            ["City / area", "Fit check; the other half of the dedupe key"],
            ["Phone", "Primary contact route for most local businesses"],
            ["Email", "Primary route for email outreach, where publicly listed"],
            ["Website", "Qualification signal and research shortcut"],
            ["Rating / review count", "Health and establishment signal"],
            ["Source", "Where the record came from — essential for debugging bad batches"],
            ["Status", "New → qualified → contacted → replied → …"],
            ["Date added", "Drives freshness checks and re-verification"],
            ["Notes", "The human context that doesn't fit anywhere else"],
          ],
        },
        {
          type: "p",
          text: "Resist adding columns speculatively. Every column is a promise to maintain it; twelve well-kept columns beat forty abandoned ones.",
        },
      ],
    },
    {
      id: "step-3-source",
      heading: "Step 3: Pull candidates from sources that fit the niche",
      blocks: [
        {
          type: "p",
          text: "Source selection depends on who you sell to. For local and physical businesses, maps data is the richest starting point; for online-first companies, directories, LinkedIn, and industry lists do more work. We've covered the full menu — registries, review platforms, social, events, hiring signals — in [How to Find Local Business Leads](/blog/how-to-find-local-business-leads) and [How to Get Leads From Google Maps](/blog/how-to-get-leads-from-google-maps).",
        },
        {
          type: "p",
          text: "Two rules at this stage. First, pull **more candidates than you need** — a healthy qualification pass removes 30–50% of raw candidates, so a target list of 100 means sourcing 150–200. Second, capture the source for every record. When one batch turns out to be full of closed businesses, you want to know which source to blame.",
        },
      ],
    },
    {
      id: "step-4-dedupe",
      heading: "Step 4: Deduplicate before you qualify",
      blocks: [
        {
          type: "p",
          text: "Duplicates are inevitable when you pull from multiple sources — and dangerous, because nothing says “mass template” like a business receiving your opener twice. Dedupe on a composite key of **normalized name + location**: lowercase, strip punctuation and suffixes like “LLC”/“Ltd”, and compare within the same city or postcode. Name alone over-merges (“Main Street Bakery” exists everywhere); address alone under-merges (one business, two listings).",
        },
        {
          type: "p",
          text: "When two records conflict, keep the one from the fresher source and merge any fields the other had that it lacks. That's a two-minute rule that saves hours of downstream confusion.",
        },
      ],
    },
    {
      id: "step-5-qualify",
      heading: "Step 5: Qualify every row against the written criteria",
      blocks: [
        {
          type: "p",
          text: "Now apply the step-1 definition row by row. Much of it is mechanical and filterable — wrong category, wrong geography, review count outside bounds, no website when your offer requires one. What's left needs a fast human pass: a 20–30 second look at the listing or website to answer “is this really our buyer?”",
        },
        {
          type: "p",
          text: "Be ruthless here. Every unqualified row that survives costs real money later — in send volume, in reply-rate damage, in salesperson time. The entire economics of outbound improve when the denominator is clean.",
        },
        {
          type: "callout",
          title: "Qualification checklist",
          text: "For each row: business is currently operating · matches category and geography · passes size/health signals · not a chain, customer, or competitor · has at least one working contact route. Five checks, a few seconds each once the data is structured.",
        },
      ],
    },
    {
      id: "step-6-enrich-verify",
      heading: "Step 6: Enrich the gaps, then verify a sample",
      blocks: [
        {
          type: "p",
          text: "Qualified rows with missing contact fields now get enriched — filled in from live public sources like the business's own listing and website. We've written a full explainer on this stage in [What Is Lead Enrichment?](/blog/what-is-lead-enrichment), including the wrong-entity and stale-data pitfalls to avoid.",
        },
        {
          type: "p",
          text: "Then verify a random sample of 10–20 finished rows by hand: does the phone listing still exist, does the website load, does the business look open? Sample verification is cheap insurance — it catches systemic problems (a stale source, a bad dedupe rule) while they're still fixable, before outreach burns the list.",
        },
      ],
    },
    {
      id: "step-7-segment-maintain",
      heading: "Step 7: Segment, then keep the list alive",
      blocks: [
        {
          type: "p",
          text: "Don't work a 500-row list as one block. Segment by whatever changes the message — category, city, review tier, web presence — so each batch of outreach can be specific. Small, specific segments are also how you learn: if “plumbers, 50+ reviews” replies at triple the rate of “plumbers, under 10 reviews,” that's your ICP talking to you.",
        },
        {
          type: "p",
          text: "Finally, treat the list as perishable. Business data decays continuously — businesses close, rebrand, and change numbers all the time, so a list left alone for months will quietly rot. Three habits keep it alive: record dates on everything, re-verify any segment older than a quarter before reusing it, and retire rows that hard-bounce or disconnect rather than letting them haunt the sheet.",
        },
      ],
    },
    {
      id: "doing-this-with-zybble",
      heading: "Doing this in an afternoon instead of a week",
      blocks: [
        {
          type: "p",
          text: "Steps 3 through 6 — sourcing, structuring, deduplicating, enriching — are exactly the mechanical work Zybble automates. You describe the segment in plain language (“150 physiotherapy clinics in Melbourne with 4+ stars”), and Zybble returns deduplicated, structured leads with phone, website, rating, reviews, and email where publicly available. Save them into [lead lists](/#product), tag the segments, and [export to CSV](/#product) for your CRM.",
        },
        {
          type: "p",
          text: "That compresses the mechanical steps to minutes and leaves your time for the two steps that genuinely need judgment: defining “qualified,” and the human pass that enforces it. [Start free — 50 leads a month](/#pricing) is enough to build and test your first segment.",
        },
      ],
    },
  ],
  related: [
    "what-is-lead-enrichment",
    "b2b-lead-generation-guide",
    "how-to-find-local-business-leads",
  ],
};
