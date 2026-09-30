/**
 * Central content for the Zybble landing page.
 * All business/lead records below are illustrative demo data
 * used purely for product visualization.
 */

export const LANDSCAPE_URL =
  "https://i.ibb.co/0jFFCfm3/Chat-GPT-Image-Sep-29-2026-07-01-04-PM.png";

export const LANDSCAPE_ALT =
  "A dreamy anime-style illustrated landscape: bright blue sky with soft white clouds above a wide green valley, wildflowers in the grass and warm rocky mesas on the horizon.";

/** Production origin used by canonical and social URLs on every page. */
export const SITE_URL = "https://zybble.com";
export const CONTACT_EMAIL = "tejassutar.business@gmail.com";
export const WEB3FORMS_KEY = "05b0c5ca-dd84-41c9-9611-304238cb58de";

/* ------------------------------------------------------------------ */
/* Demo businesses (fictional, product visualization only)             */
/* ------------------------------------------------------------------ */
export type DemoBusiness = {
  name: string;
  category: string;
  location: string;
  phone: string;
  rating: number;
  reviews: number;
  website: string;
  email?: string;
  initials: string;
  tint: string;
  status?: "New" | "Enriched" | "Contacted";
};

export const DEMO_DENTISTS: DemoBusiness[] = [
  {
    name: "Bluebonnet Dental Studio",
    category: "Dentist",
    location: "South Congress, Austin",
    phone: "(512) 555-0134",
    rating: 4.8,
    reviews: 214,
    website: "bluebonnetdental.co",
    email: "hello@bluebonnetdental.co",
    initials: "BB",
    tint: "bg-sky-50 text-sky-700",
    status: "Enriched",
  },
  {
    name: "Hillcrest Family Dental",
    category: "Dentist",
    location: "West Lake Hills, Austin",
    phone: "(512) 555-0186",
    rating: 4.9,
    reviews: 327,
    website: "hillcrestfamilydental.co",
    initials: "HF",
    tint: "bg-emerald-50 text-emerald-700",
    status: "New",
  },
  {
    name: "Red River Orthodontics",
    category: "Orthodontist",
    location: "Downtown, Austin",
    phone: "(512) 555-0119",
    rating: 4.7,
    reviews: 158,
    website: "redriverortho.co",
    email: "care@redriverortho.co",
    initials: "RR",
    tint: "bg-amber-50 text-amber-700",
    status: "New",
  },
  {
    name: "Zilker Park Dental Co.",
    category: "Dentist",
    location: "Zilker, Austin",
    phone: "(512) 555-0142",
    rating: 4.6,
    reviews: 96,
    website: "zilkerparkdental.co",
    initials: "ZP",
    tint: "bg-violet-50 text-violet-700",
    status: "Contacted",
  },
  {
    name: "Mesa Verde Dental Care",
    category: "Cosmetic dentist",
    location: "North Loop, Austin",
    phone: "(512) 555-0177",
    rating: 4.8,
    reviews: 181,
    website: "mesaverdedental.co",
    initials: "MV",
    tint: "bg-rose-50 text-rose-700",
    status: "New",
  },
];

/* ------------------------------------------------------------------ */
/* Pricing — monthly plans                                             */
/* ------------------------------------------------------------------ */
export type Plan = {
  name: string;
  price: number;
  blurb: string;
  features: string[];
  cta: string;
  popular?: boolean;
};

export const PLANS: Plan[] = [
  {
    name: "Free",
    price: 0,
    blurb: "Try lead discovery on a real search.",
    cta: "Start for free",
    features: [
      "50 leads per month",
      "Phone & email data",
      "CSV export",
      "Zybble AI",
      "1 lead list",
      "1 user",
    ],
  },
  {
    name: "Growth",
    price: 49,
    blurb: "For consistent, everyday prospecting.",
    cta: "Start for free",
    features: [
      "5,000 leads per month",
      "Phone & email data",
      "CSV export",
      "Unlimited lead lists",
      "Zybble AI",
      "1 user",
    ],
  },
  {
    name: "Agency",
    price: 99,
    blurb: "For teams running client campaigns.",
    cta: "Start for free",
    popular: true,
    features: [
      "15,000 leads per month",
      "Phone & email data",
      "CSV export",
      "Unlimited lead lists",
      "Zybble AI",
      "3 team members",
      "Client workspaces",
    ],
  },
  {
    name: "Scale",
    price: 199,
    blurb: "High-volume discovery with priority handling.",
    cta: "Start for free",
    features: [
      "50,000 leads per month",
      "Phone & email data",
      "CSV export",
      "Unlimited lead lists",
      "Zybble AI",
      "5 team members",
      "Client workspaces",
      "Priority lead processing",
    ],
  },
];

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */
export const FAQS: { q: string; a: string }[] = [
  {
    q: "How does Zybble find leads?",
    a: "You describe the businesses you want — a category, a location, and any requirements. Zybble turns that into a structured search across business data and returns organized results you can save, enrich, and export.",
  },
  {
    q: "Can I search using natural language?",
    a: "Yes — it's the core of the product. Type the request the way you'd say it out loud, like “500 dentists in Austin”, and Zybble interprets the business type, place, quantity, and filters for you.",
  },
  {
    q: "What business information can Zybble find?",
    a: "Name, category, address, phone, website, rating, review count, opening hours, and coordinates — plus email when it's publicly available. Exact fields vary per business, depending on the available data.",
  },
  {
    q: "How does Zybble AI work?",
    a: "Zybble AI is included on every plan, including Free. It reads the available business data for a lead and summarizes what it means — local presence, review activity, and how reachable they are. AI output is generated from available data, so verify before you act on it.",
  },
  {
    q: "Can I export my leads?",
    a: "Yes. Every plan, including Free, exports to CSV. Choose the fields you want — business, phone, email, website, address, rating — and move the file into your CRM or spreadsheet.",
  },
  {
    q: "What happens when I reach my monthly limit?",
    a: "New searches pause until your allowance resets at the start of the next monthly cycle, or until you move to a plan with more capacity. Your saved lists and past exports always remain accessible.",
  },
  {
    q: "Can I create lead lists?",
    a: "Yes. Any search can be saved into a list and tagged. The Free plan includes one list; Growth, Agency, and Scale include unlimited lists.",
  },
  {
    q: "Do Agency and Scale include client workspaces?",
    a: "Yes. Client workspaces keep each client's searches, lead lists, and exports separate, while your whole team works from one account.",
  },
];

/* ------------------------------------------------------------------ */
/* Nav                                                                 */
/* ------------------------------------------------------------------ */
export const NAV_LINKS = [
  { label: "Product", href: "/#product" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
];

export const FOOTER_COLS: {
  title: string;
  links: { label: string; href: string }[];
}[] = [
  {
    title: "Product",
    links: [
      { label: "Find Leads", href: "/#product" },
      { label: "Zybble AI", href: "/#product" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "FAQ", href: "/#faq" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];
