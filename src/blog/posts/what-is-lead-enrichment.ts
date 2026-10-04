import type { BlogPost } from "../types";
import { ZYBBLE_TEAM } from "../author";

export const post: BlogPost = {
  slug: "what-is-lead-enrichment",
  title: "What Is Lead Enrichment? Definition, Data Types, and How It Works",
  seoTitle: "What Is Lead Enrichment? Definition, Data Types & How It Works",
  description:
    "Lead enrichment adds missing, verified information to a basic lead record. Learn what data gets added, how it works, and when automating it is worth it.",
  excerpt:
    "A clear explanation of lead enrichment: what it adds to a bare-bones lead record, where the data comes from, the difference manual and automated enrichment makes, and the pitfalls to watch.",
  category: "Business data",
  primaryTopic: "lead enrichment",
  datePublished: "2026-10-04",
  author: ZYBBLE_TEAM,
  thumbnail: "/blog/what-is-lead-enrichment.webp",
  thumbnailWidth: 1280,
  thumbnailHeight: 720,
  thumbnailAlt:
    "Minimal illustration of a business record card with phone, email, globe and star badges attaching to it by dotted lines",
  ogImage: "/blog/og/what-is-lead-enrichment.jpg",
  intro: [
    "**Lead enrichment** is the process of taking a basic lead record — often just a business name and a location — and adding the missing information that makes it usable: contact details, firmographic facts, and context signals. The input is a name; the output is a record you can qualify, prioritize, and contact.",
    "This article explains what enrichment actually adds, where the data comes from, how manual and automated enrichment differ, and the quality pitfalls that quietly ruin enriched lists.",
  ],
  sections: [
    {
      id: "why-enrichment-matters",
      heading: "Why enrichment matters",
      blocks: [
        {
          type: "p",
          text: "Raw lead lists are mostly holes. A list sourced from a registry has no phone numbers. A list copied from a map search has no emails. A list of form-fill signups has whatever the prospect felt like typing. Every hole has a downstream cost: records you can't contact, messages you can't personalize, and qualification decisions made on guesswork.",
        },
        {
          type: "p",
          text: "Enrichment fixes the holes before the list reaches outreach. The practical effects are direct: more records become reachable at all, qualification gets made on facts instead of vibes, and first messages can reference something real about the business — which is most of the difference between relevant outreach and template spam.",
        },
      ],
    },
    {
      id: "what-data-gets-added",
      heading: "What data gets added to a lead",
      blocks: [
        {
          type: "p",
          text: "Enrichment data falls into three buckets, each answering a different question:",
        },
        {
          type: "table",
          caption: "The three categories of enrichment data",
          head: ["Category", "Typical fields", "Question it answers"],
          rows: [
            [
              "Contact data",
              "Phone, email, website, physical address, social profiles",
              "Can we reach them?",
            ],
            [
              "Firmographic data",
              "Category/industry, locations, size signals, years operating",
              "Do they fit our ICP?",
            ],
            [
              "Context signals",
              "Rating, review count, opening hours, website quality, recent activity",
              "Are they healthy, active, and worth prioritizing?",
            ],
          ],
        },
        {
          type: "p",
          text: "For local business leads specifically, the highest-value fields in practice are the phone number, the website, the email where one is publicly listed, and the review profile. Review count and rating are underrated qualification signals: they approximate how established a business is and how much it cares about its public presence — without requiring any inside information.",
        },
      ],
    },
    {
      id: "where-the-data-comes-from",
      heading: "Where enrichment data comes from",
      blocks: [
        {
          type: "p",
          text: "Legitimate enrichment draws on information businesses publish about themselves: their map and directory listings, their own websites (contact pages, footers, legal notices), official registries, and public social profiles. A business's listing data — hours, phone, address, category — exists because the business wants customers to find it.",
        },
        {
          type: "p",
          text: "This is also where the ethical line sits. Enriching a business record with the phone number that business publishes on its own listing is ordinary commerce. Harvesting personal data from private sources, or contacting people through channels they never made public, is neither ethical nor — under regimes like GDPR — legal. Good enrichment stays on the public side of that line and keeps track of where each field came from.",
        },
      ],
    },
    {
      id: "manual-vs-automated",
      heading: "Manual vs. automated enrichment",
      blocks: [
        {
          type: "p",
          text: "**Manual enrichment** is research: open the business's listing, website, and social profiles, and copy what you find into the record. Done carefully it produces excellent data — and it costs roughly five to ten minutes per lead. That's fine for a ten-account target list and absurd for a five-hundred-row one.",
        },
        {
          type: "p",
          text: "**Automated enrichment** does the same lookups programmatically across the whole list at once. Tools match each record against live public sources and fill the gaps in minutes. The quality depends on two things: match accuracy (is the data being attached to the *right* business?) and source freshness (is it today's listing or a years-old snapshot?).",
        },
        {
          type: "p",
          text: "The sensible division of labor: automate the structured fields (contacts, categories, ratings, hours), and spend human minutes only on the judgment calls — fit assessment and personalization research for the leads that survive qualification.",
        },
        {
          type: "callout",
          title: "How Zybble handles this",
          text: "Zybble enriches at discovery time rather than as a separate step: every lead arrives with name, category, address, phone, website, rating, review count, and hours — plus email where it's publicly available — already structured. [Zybble AI](/#product) then reads that data and summarizes what it means for reachability and fit.",
        },
      ],
    },
    {
      id: "enrichment-workflow",
      heading: "A simple enrichment workflow",
      blocks: [
        {
          type: "list",
          ordered: true,
          items: [
            "**Standardize first.** Before adding data, normalize what you have — consistent name casing, one address format, deduplicated rows. Enriching duplicates doubles your cost and your confusion. (Our [lead list guide](/blog/how-to-build-a-b2b-lead-list) covers dedupe keys.)",
            "**Enrich contacts.** Fill phone, website, and email from live public listings. Flag records where nothing can be found — a business with no findable contact route may not be worth a row.",
            "**Enrich context.** Add ratings, review counts, and activity signals; these drive prioritization.",
            "**Verify a sample.** Spot-check 10–20 records by hand against the live source. If the sample has problems, the list has problems.",
            "**Mark freshness.** Record when each lead was enriched. Business data decays — numbers change, businesses close — so a list enriched last year is a list that needs re-enriching.",
          ],
        },
      ],
    },
    {
      id: "pitfalls",
      heading: "Pitfalls that ruin enriched lists",
      blocks: [
        {
          type: "list",
          items: [
            "**Wrong-entity matches.** “Riverside Dental” exists in forty cities. Enrichment keyed on name alone attaches the wrong city's phone number to your lead. Always match on name *plus* location.",
            "**Stale snapshots.** Some data sources sell years-old database dumps. The giveaway: disconnected numbers and bounced emails in your first outreach batch. Prefer sources that read live listings.",
            "**Guessed emails treated as facts.** Pattern-guessing (info@domain) has its uses, but a guessed address is a hypothesis, not data. Keep a field that distinguishes *found* contacts from *guessed* ones.",
            "**Over-enrichment.** Forty columns you'll never read make lists slower to work, not smarter. Enrich the fields your qualification and outreach actually use; skip the rest.",
          ],
        },
      ],
    },
    {
      id: "lead-enrichment-faq",
      heading: "Lead enrichment vs. related terms",
      blocks: [
        {
          type: "p",
          text: "**Enrichment vs. lead generation:** generation finds the lead; enrichment completes it. In practice the line blurs — modern discovery tools return enriched records from the start, which is usually the efficient order. See the full picture in our [B2B Lead Generation Guide](/blog/b2b-lead-generation-guide).",
        },
        {
          type: "p",
          text: "**Enrichment vs. data cleansing:** cleansing fixes what's wrong (typos, formats, duplicates); enrichment adds what's missing. A healthy list pipeline does both, cleansing first.",
        },
        {
          type: "p",
          text: "**Enrichment vs. verification:** verification confirms a specific field is currently valid (the email accepts mail, the phone rings). Enrichment without periodic verification slowly degrades back into guesswork.",
        },
        {
          type: "callout",
          title: "See enriched leads, not raw names",
          text: "Run a search like “100 cafés in Portland” and look at what comes back: structured records with contacts, ratings, and hours, ready to qualify and [export as CSV](/#product). The [free plan](/#pricing) includes 50 leads a month.",
        },
      ],
    },
  ],
  related: [
    "how-to-build-a-b2b-lead-list",
    "b2b-lead-generation-guide",
    "how-to-get-leads-from-google-maps",
  ],
};
