/* ------------------------------------------------------------------ */
/* Zybble app — realistic mock data (replace with API responses later) */
/* ------------------------------------------------------------------ */
import type {
  ActivityItem,
  ExportRecord,
  Invoice,
  Lead,
  LeadList,
  LeadStatus,
  SearchRecord,
  TeamMember,
  Workspace,
} from "./types";

/* Deterministic pseudo-random helper so data is stable across renders. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length)];
}

const TINTS = [
  "bg-sky-50 text-sky-700",
  "bg-emerald-50 text-emerald-700",
  "bg-amber-50 text-amber-700",
  "bg-violet-50 text-violet-700",
  "bg-rose-50 text-rose-700",
  "bg-stone-100 text-stone-600",
];

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
export function tintFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return TINTS[h % TINTS.length];
}

/* ------------------------------------------------------------------ */
/* Current user                                                        */
/* ------------------------------------------------------------------ */
export const CURRENT_USER = {
  name: "Avery Chen",
  email: "avery@northsidegrowth.co",
  initials: "AC",
  tint: "bg-brand-50 text-brand-700",
  avatar: "https://i.pravatar.cc/64?img=47",
};

/* ------------------------------------------------------------------ */
/* Lead generation                                                     */
/* ------------------------------------------------------------------ */
type Vertical = {
  category: string;
  prefixes: string[];
  suffixes: string[];
  services: string[];
  amenities: string[];
  priceMin: number;
  priceMax: number;
};

const VERTICALS: Vertical[] = [
  {
    category: "Dentist",
    prefixes: ["Bluebonnet", "Hillcrest", "Zilker Park", "Red River", "Mesa Verde", "Pecan Grove", "South Congress", "Lakeshore"],
    suffixes: ["Dental Studio", "Family Dental", "Dental Co.", "Orthodontics", "Dental Care", "Smile Design"],
    services: ["General dentistry", "Cleanings", "Whitening", "Orthodontics"],
    amenities: ["Wheelchair accessible", "Parking on site", "Accepts insurance"],
    priceMin: 2,
    priceMax: 3,
  },
  {
    category: "Coffee shop",
    prefixes: ["Cardinal", "Morning Ember", "Fox & Fern", "Copper Kettle", "Analog", "Golden Hour", "Driftwood"],
    suffixes: ["Coffee", "Coffee Roasters", "Espresso", "Coffee House", "Roastery"],
    services: ["Espresso bar", "Pastries", "Single-origin beans", "Catering"],
    amenities: ["Free Wi-Fi", "Outdoor seating", "Pet friendly"],
    priceMin: 1,
    priceMax: 2,
  },
  {
    category: "Restaurant",
    prefixes: ["Casa Verde", "Juniper & Ash", "Wildflower", "Mesa", "Ochre", "The Briar", "Sage Table"],
    suffixes: ["Kitchen", "Bistro", "Trattoria", "Taqueria", "Eatery", "Dining Room"],
    services: ["Dine-in", "Takeout", "Catering", "Private events"],
    amenities: ["Outdoor seating", "Reservation required", "Wheelchair accessible"],
    priceMin: 2,
    priceMax: 4,
  },
  {
    category: "Marketing agency",
    prefixes: ["Northside", "Prairie Signal", "Fieldstone", "Vantage Row", "Meridian West", "Solid State", "Basin & Pine"],
    suffixes: ["Growth", "Media", "Studios", "Digital", "Partners", ":creative"],
    services: ["Paid media", "SEO", "Brand strategy", "Content studio"],
    amenities: ["Remote-first", "Client portal"],
    priceMin: 2,
    priceMax: 3,
  },
  {
    category: "Gym",
    prefixes: ["Ironwood", "Ascent", "Peak & Canyon", "Formline", "Hudson Strength"],
    suffixes: ["Athletics", "Training Co.", "Strength Club", "Fitness", "Performance"],
    services: ["Personal training", "Group classes", "Open gym", "Nutrition coaching"],
    amenities: ["Lockers & showers", "24/7 access", "Sauna"],
    priceMin: 1,
    priceMax: 3,
  },
  {
    category: "Law firm",
    prefixes: ["Harwick", "Cannady", "Mercer", "Delgado", "Whitemarsh", "Kessler"],
    suffixes: ["& Associates", "LLP", "Law Group", "Legal"],
    services: ["Family law", "Estate planning", "Employment law", "Mediation"],
    amenities: ["Free consultation", "Virtual meetings"],
    priceMin: 2,
    priceMax: 4,
  },
  {
    category: "Landscaping service",
    prefixes: ["Canyon Ridge", "Verdant", "Bluegrass", "Stonebrook", "Golden Meadow"],
    suffixes: ["Landscaping", "Lawn Co.", "Outdoor Services", "Grounds"],
    services: ["Lawn care", "Irrigation", "Tree service", "Seasonal cleanup"],
    amenities: ["Free estimates", "Licensed & insured"],
    priceMin: 1,
    priceMax: 3,
  },
  {
    category: "Hair salon",
    prefixes: ["Fig & Bloom", "The Copper Chair", "Muse", "Halo", "Juniper"],
    suffixes: ["Salon", "Hair Studio", "Parlor", "Atelier"],
    services: ["Cuts", "Color", "Blowouts", "Treatments"],
    amenities: ["Online booking", "Wheelchair accessible"],
    priceMin: 2,
    priceMax: 3,
  },
];

const CITIES: { city: string; state: string; lat: number; lng: number }[] = [
  { city: "Austin", state: "TX", lat: 30.2672, lng: -97.7431 },
  { city: "Denver", state: "CO", lat: 39.7392, lng: -104.9903 },
  { city: "Portland", state: "OR", lat: 45.5152, lng: -122.6784 },
  { city: "Miami", state: "FL", lat: 25.7617, lng: -80.1918 },
  { city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
  { city: "Nashville", state: "TN", lat: 36.1627, lng: -86.7816 },
  { city: "Seattle", state: "WA", lat: 47.6062, lng: -122.3321 },
  { city: "Phoenix", state: "AZ", lat: 33.4484, lng: -112.074 },
];

const STREETS = [
  "Maple Ave", "Congress Pkwy", "Willow Bend Rd", "Canyon Trail", "Riverstone Blvd",
  "Old Market St", "Juniper Ln", "Sunset Terrace", "Mariposa Dr", "Granite Way",
  "Hollow Creek Rd", "Palm Blvd", "Cherrywood Rd", "Meadowlark Dr", "Beacon St",
];

const EMAIL_PREFIXES = ["hello", "info", "care", "team", "contact"];

const STATUSES: LeadStatus[] = ["new", "new", "new", "enriched", "enriched", "contacted"];

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}

function makeHours(vertical: Vertical, r: () => number) {
  const isShop = vertical.priceMin === 1;
  const open = isShop ? "7:00" : "8:00";
  const close = vertical.priceMax >= 3 && vertical.category === "Restaurant" ? "22:00" : isShop ? "17:00" : "18:00";
  const weekday = `${open}–${close}`;
  const closedAllDay = r() < 0.35;
  return {
    Monday: weekday,
    Tuesday: weekday,
    Wednesday: weekday,
    Thursday: weekday,
    Friday: `${open}–${close}`,
    Saturday: closedAllDay ? "Closed" : r() < 0.5 ? "9:00–14:00" : "9:00–16:00",
    Sunday: "Closed",
  };
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

const SEARCH_QUERIES: { q: string; loc: string; v: number }[] = [
  { q: "Find 500 dentists in Austin", loc: "Austin, TX", v: 0 },
  { q: "Coffee shops in Portland with websites", loc: "Portland, OR", v: 1 },
  { q: "Restaurants in Miami rated 4.0+", loc: "Miami, FL", v: 2 },
  { q: "Marketing agencies in Chicago", loc: "Chicago, IL", v: 3 },
  { q: "Gyms in Nashville with phone numbers", loc: "Nashville, TN", v: 4 },
  { q: "Family law firms in Denver", loc: "Denver, CO", v: 5 },
  { q: "Landscaping services in Phoenix", loc: "Phoenix, AZ", v: 6 },
  { q: "Hair salons in Seattle rated 4.5+", loc: "Seattle, WA", v: 7 },
];

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */
export const LISTS: LeadList[] = [
  { id: "list-austin-dentists", name: "Austin Dentists", description: "Dental practices across the Austin metro — Q1 outreach batch.", color: "text-emerald-700 bg-emerald-50", lead_count: 214, owner: "Avery Chen", created_at: daysAgo(40), updated_at: daysAgo(1), workspace_id: "ws-main" },
  { id: "list-coffee-portland", name: "Portland Coffee Shops", description: "Independent coffee shops in Portland with websites.", color: "text-amber-700 bg-amber-50", lead_count: 96, owner: "Avery Chen", created_at: daysAgo(27), updated_at: daysAgo(3), workspace_id: "ws-main" },
  { id: "list-miami-restaurants", name: "Miami Restaurants", description: "Restaurants in Miami rated 4.0 and above.", color: "text-sky-700 bg-sky-50", lead_count: 412, owner: "Jordan Lee", created_at: daysAgo(19), updated_at: daysAgo(2), workspace_id: "ws-main" },
  { id: "list-chicago-agencies", name: "Chicago Marketing Agencies", description: "Agencies from the Chicago market search, first pass.", color: "text-violet-700 bg-violet-50", lead_count: 158, owner: "Avery Chen", created_at: daysAgo(11), updated_at: daysAgo(1), workspace_id: "ws-native" },
  { id: "list-q1-targets", name: "Q1 High-Intent Targets", description: "Cross-market shortlist — high rating, has website and phone.", color: "text-rose-700 bg-rose-50", lead_count: 74, owner: "Avery Chen", created_at: daysAgo(8), updated_at: daysAgo(0), workspace_id: "ws-main" },
  { id: "list-nashville-gyms", name: "Nashville Gyms", description: "Gyms and training studios across Nashville.", color: "text-stone-600 bg-stone-100", lead_count: 63, owner: "Sam Ortiz", created_at: daysAgo(5), updated_at: daysAgo(0), workspace_id: "ws-main" },
];

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */
export function generateLeads(count = 96): Lead[] {
  const r = rng(7214);
  const leads: Lead[] = [];
  for (let i = 0; i < count; i++) {
    const meta = SEARCH_QUERIES[i % SEARCH_QUERIES.length];
    const v = VERTICALS[meta.v];
    const name = `${pick(r, v.prefixes)} ${pick(r, v.suffixes)}`;
    const place = CITIES.find((c) => meta.loc.startsWith(c.city)) ?? CITIES[i % CITIES.length];
    const domain = slugify(name) + ".com";
    const hasWebsite = r() > 0.18;
    const hasEmail = hasWebsite && r() > 0.35;
    const rating = Math.round((3.4 + r() * 2.1) * 10) / 10;
    const reviews = Math.floor(8 + r() * 580);
    const price = v.priceMin === v.priceMax ? "$".repeat(v.priceMin) : r() < 0.5 ? "$".repeat(v.priceMin) : "$".repeat(v.priceMax);
    const status = pick(r, STATUSES);
    const categories = [v.category, ...(r() > 0.6 ? [pick(r, VERTICALS[0].services)] : [])];
    const street = `${Math.floor(100 + r() * 9800)} ${pick(r, STREETS)}`;
    const lat = place.lat + (r() - 0.5) * 0.12;
    const lng = place.lng + (r() - 0.5) * 0.12;
    const collected = daysAgo(Math.floor(r() * 35));
    const listPool = r();
    const list_ids =
      listPool < 0.3
        ? [LISTS[meta.v % 6 === 0 ? 4 : (meta.v + 1) % 6].id, LISTS[meta.v % 6].id]
        : listPool < 0.72
          ? [LISTS[meta.v % 6].id]
          : [];
    const tags = [
      ...(rating >= 4.5 ? ["High rating"] : []),
      ...(hasWebsite ? ["Website"] : []),
      ...(hasEmail ? ["Has email"] : []),
      ...(status === "contacted" ? ["Outreach sent"] : []),
    ];
    const email = hasEmail ? `${pick(r, EMAIL_PREFIXES)}@${domain}` : null;
    const hours = makeHours(v, r);
    const plusLat = lat.toFixed(4).replace(".", "");
    leads.push({
      id: `lead-${String(i + 1).padStart(3, "0")}`,
      business_id: `biz_${(i * 7919 + 104729).toString(36)}`,
      place_id: `ChIJ${(i * 15485863 + 32452843).toString(36).toUpperCase().slice(0, 18)}`,
      name,
      title: `${name} · ${v.category} in ${place.city}`,
      category: v.category,
      categories,
      types: categories.map((c) => c.toLowerCase().replace(/\s+/g, "_")),
      description: `${name} is a ${v.category.toLowerCase()} in ${place.city}, ${place.state}, rated ${rating} across ${reviews} reviews.`,
      rating,
      reviews,
      price,
      price_level: price.length,
      phone: `(${String(Math.floor(200 + r() * 780))}) 555-${String(Math.floor(100 + r() * 9899)).padStart(4, "0")}`,
      phone_normalized: `+1${String(Math.floor(2000000000 + r() * 790000000))}`,
      email,
      emails: email ? [email] : [],
      website: hasWebsite ? domain : null,
      website_domain: hasWebsite ? domain : null,
      address: `${street}, ${place.city}, ${place.state} ${String(10000 + Math.floor(r() * 89999))}`,
      street,
      city: place.city,
      state: place.state,
      postal_code: String(10000 + Math.floor(r() * 89999)),
      country: "United States",
      country_code: "US",
      latitude: Math.round(lat * 1e6) / 1e6,
      longitude: Math.round(lng * 1e6) / 1e6,
      plus_code: `${plusLat.slice(0, 4)}${(i * 31) % 99}+${(i * 17) % 99} ${place.city}`,
      hours,
      open_state: r() < 0.62 ? "open" : r() < 0.85 ? "closed" : "unknown",
      hours_display: `Today · ${hours.Monday}`,
      services: v.services,
      service_options: v.services.slice(0, 3),
      amenities: v.amenities,
      attributes: [...v.amenities, `Accepts ${r() < 0.5 ? "credit cards" : "mobile payments"}`],
      photos: Math.floor(5 + r() * 40),
      thumbnail: null,
      logo: null,
      maps_url: `https://maps.google.com/?q=${encodeURIComponent(name)}`,
      google_maps_url: `https://maps.google.com/?cid=${i * 4096 + 1000}`,
      source: pick(r, ["Google Maps", "Public business listing", "Business website"]),
      source_url: `https://maps.google.com/?cid=${i * 4096 + 1000}`,
      data_id: `0x${(i * 286293355577794).toString(16)}`,
      data_cid: String(2840000000000 + i * 7919),
      kgmid: `/g/11${(i + 100).toString(36)}${(i * 3 + 40).toString(36)}`,
      owner: null,
      owner_name: null,
      owner_link: null,
      booking_links: r() < 0.25 ? [`https://booking.example.com/${slugify(name)}`] : [],
      menu_links: v.category === "Restaurant" && r() < 0.6 ? [`https://menus.example.com/${slugify(name)}`] : [],
      social_links: hasWebsite && r() < 0.4 ? [`instagram.com/${slugify(name)}`] : [],
      search_query: meta.q,
      search_location: meta.loc,
      collected_at: collected,
      updated_at: daysAgo(Math.floor(r() * 6)),
      status,
      tags,
      notes:
        r() < 0.22
          ? [{ id: `note-${i}`, author: "Avery Chen", body: pick(r, ["Strong candidate for spring outreach.", "Ask about multi-location interest.", "Website looks recent — reference it.", "Follow up after quarter end."]), at: daysAgo(Math.floor(r() * 4)) }]
          : [],
      list_ids,
    });
  }
  return leads;
}
export const LEADS: Lead[] = generateLeads(96);

/* ------------------------------------------------------------------ */
/* Search history                                                      */
/* ------------------------------------------------------------------ */
export const SEARCH_HISTORY: SearchRecord[] = [
  { id: "srch-01", query: "Find 500 dentists in Austin", location: "Austin, TX", results: 487, status: "completed", list_id: "list-austin-dentists", saved: true, at: daysAgo(1) },
  { id: "srch-02", query: "Coffee shops in Portland with websites", location: "Portland, OR", results: 172, status: "completed", list_id: "list-coffee-portland", saved: true, at: daysAgo(3) },
  { id: "srch-03", query: "Restaurants in Miami rated 4.0+", location: "Miami, FL", results: 618, status: "completed", list_id: "list-miami-restaurants", saved: true, at: daysAgo(4) },
  { id: "srch-04", query: "Marketing agencies in Chicago", location: "Chicago, IL", results: 205, status: "completed", list_id: "list-chicago-agencies", saved: true, at: daysAgo(6) },
  { id: "srch-05", query: "Gyms in Nashville with phone numbers", location: "Nashville, TN", results: 94, status: "completed", list_id: "list-nashville-gyms", saved: true, at: daysAgo(7) },
  { id: "srch-06", query: "Family law firms in Denver", location: "Denver, CO", results: 121, status: "completed", list_id: null, saved: false, at: daysAgo(9) },
  { id: "srch-07", query: "Boutique hotels in Oregon", location: "Oregon", results: 41, status: "partial", list_id: null, saved: false, at: daysAgo(12) },
  { id: "srch-08", query: "Landscaping services in Phoenix", location: "Phoenix, AZ", results: 238, status: "completed", list_id: null, saved: false, at: daysAgo(14) },
  { id: "srch-09", query: "Wedding photographers in Austin", location: "Austin, TX", results: 0, status: "failed", list_id: null, saved: false, at: daysAgo(16) },
  { id: "srch-10", query: "Hair salons in Seattle rated 4.5+", location: "Seattle, WA", results: 189, status: "completed", list_id: "list-q1-targets", saved: true, at: daysAgo(18) },
  { id: "srch-11", query: "Auto repair shops in Houston", location: "Houston, TX", results: 342, status: "completed", list_id: null, saved: false, at: daysAgo(21) },
  { id: "srch-12", query: "Accounting firms in Boston", location: "Boston, MA", results: 156, status: "completed", list_id: null, saved: false, at: daysAgo(24) },
];

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */
export const EXPORTS: ExportRecord[] = [
  { id: "exp-01", file_name: "austin-dentists-full.csv", source: "Austin Dentists", leads: 214, format: "CSV", status: "completed", created_at: daysAgo(1), completed_at: daysAgo(1) },
  { id: "exp-02", file_name: "q1-high-intent-batch-2.csv", source: "Q1 High-Intent Targets", leads: 74, format: "CSV", status: "completed", created_at: daysAgo(2), completed_at: daysAgo(2) },
  { id: "exp-03", file_name: "miami-restaurants-selection.csv", source: "Miami Restaurants", leads: 96, format: "CSV", status: "completed", created_at: daysAgo(4), completed_at: daysAgo(4) },
  { id: "exp-04", file_name: "portland-coffee-with-emails.csv", source: "Portland Coffee Shops", leads: 58, format: "CSV", status: "completed", created_at: daysAgo(6), completed_at: daysAgo(6) },
  { id: "exp-05", file_name: "chicago-agencies-full.csv", source: "Chicago Marketing Agencies", leads: 158, format: "CSV", status: "processing", created_at: daysAgo(0), completed_at: null },
  { id: "exp-06", file_name: "nashville-gyms-new.csv", source: "Nashville Gyms", leads: 63, format: "CSV", status: "preparing", created_at: daysAgo(0), completed_at: null },
  { id: "exp-07", file_name: "denver-family-law.csv", source: "Search · Family law firms in Denver", leads: 121, format: "CSV", status: "failed", created_at: daysAgo(9), completed_at: null },
  { id: "exp-08", file_name: "austin-dentists-phones-only.csv", source: "Austin Dentists", leads: 198, format: "CSV", status: "completed", created_at: daysAgo(11), completed_at: daysAgo(11) },
];

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */
export const TEAM: TeamMember[] = [
  { id: "tm-1", name: "Avery Chen", email: "avery@northsidegrowth.co", role: "owner", workspace: "Northside Growth", status: "active", joined_at: daysAgo(64), initials: "AC", tint: "bg-brand-50 text-brand-700" },
  { id: "tm-2", name: "Jordan Lee", email: "jordan@northsidegrowth.co", role: "admin", workspace: "Northside Growth", status: "active", joined_at: daysAgo(51), initials: "JL", tint: "bg-sky-50 text-sky-700" },
  { id: "tm-3", name: "Sam Ortiz", email: "sam@northsidegrowth.co", role: "member", workspace: "Northside Growth", status: "active", joined_at: daysAgo(22), initials: "SO", tint: "bg-amber-50 text-amber-700" },
  { id: "tm-4", name: "Priya Raman", email: "priya@clientlive.co", role: "member", workspace: "Client · LiveWell Clinics", status: "invited", joined_at: daysAgo(2), initials: "PR", tint: "bg-violet-50 text-violet-700" },
];

/* ------------------------------------------------------------------ */
/* Workspaces                                                          */
/* ------------------------------------------------------------------ */
export const WORKSPACES: Workspace[] = [
  { id: "ws-main", name: "Northside Growth", owner: "Avery Chen", plan: "Agency", members: 3, leads_used: 7830, leads_limit: 15000, searches: 96, lists: 5, created_at: daysAgo(64) },
  { id: "ws-client", name: "Client · LiveWell Clinics", owner: "Avery Chen", plan: "Agency workspace", members: 2, leads_used: 1240, leads_limit: 5000, searches: 21, lists: 3, created_at: daysAgo(30) },
  { id: "ws-native", name: "Client · Native Coffee Co.", owner: "Jordan Lee", plan: "Agency workspace", members: 2, leads_used: 620, leads_limit: 5000, searches: 9, lists: 2, created_at: daysAgo(18) },
];

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */
export const INVOICES: Invoice[] = [
  { id: "inv-2026-002", date: daysAgo(1), description: "Agency plan · February", amount: "$99.00", status: "paid" },
  { id: "inv-2026-001", date: daysAgo(32), description: "Agency plan · January", amount: "$99.00", status: "paid" },
  { id: "inv-2025-112", date: daysAgo(63), description: "Growth plan · December", amount: "$49.00", status: "paid" },
  { id: "inv-2025-111", date: daysAgo(94), description: "Growth plan · November", amount: "$49.00", status: "paid" },
];

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */
export const ACTIVITY: ActivityItem[] = [
  { id: "act-1", kind: "search", text: "Ran search “Find 500 dentists in Austin” — 487 results", at: daysAgo(1) },
  { id: "act-2", kind: "export", text: "Exported austin-dentists-full.csv (214 leads)", at: daysAgo(1) },
  { id: "act-3", kind: "save", text: "Added 96 leads to “Portland Coffee Shops”", at: daysAgo(3) },
  { id: "act-4", kind: "ai", text: "Zybble AI analyzed 12 leads in “Q1 High-Intent Targets”", at: daysAgo(3) },
  { id: "act-5", kind: "search", text: "Ran search “Restaurants in Miami rated 4.0+” — 618 results", at: daysAgo(4) },
  { id: "act-6", kind: "list", text: "Created list “Q1 High-Intent Targets”", at: daysAgo(8) },
  { id: "act-7", kind: "workspace", text: "Created workspace “Client · Native Coffee Co.”", at: daysAgo(18) },
  { id: "act-8", kind: "invite", text: "Invited priya@clientlive.co to LiveWell Clinics", at: daysAgo(2) },
];

/* ------------------------------------------------------------------ */
/* KPIs / usage                                                        */
/* ------------------------------------------------------------------ */
export const KPI = {
  leadsFound: 12480,
  leadsSaved: 3842,
  searches: 128,
  exported: 2410,
  remaining: 7170,
  allowance: 15000,
  used: 7830,
  aiRuns: 342,
  resetDate: "Mar 1, 2026",
  renewalDate: "Mar 12, 2026",
};

export const PLAN = "Agency";
export const PLAN_FEATURES: Record<string, { leads: number; ai: boolean; lists: string; seats: number; workspaces: boolean; priority: boolean }> = {
  Free: { leads: 50, ai: false, lists: "1 list", seats: 1, workspaces: false, priority: false },
  Growth: { leads: 5000, ai: true, lists: "Unlimited", seats: 1, workspaces: false, priority: false },
  Agency: { leads: 15000, ai: true, lists: "Unlimited", seats: 3, workspaces: true, priority: false },
  Scale: { leads: 50000, ai: true, lists: "Unlimited", seats: 5, workspaces: true, priority: true },
};

export const WHOAMI = { plan: PLAN, workspace: WORKSPACES[0] };

/* Usage weekly series (last 12 ISO weeks) — leads discovered per week */
export const WEEKLY_USAGE = [420, 560, 385, 610, 520, 480, 702, 640, 580, 735, 690, 770];
export const WEEK_LABELS = ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12"];

export { daysAgo };
